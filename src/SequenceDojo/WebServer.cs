using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using SequenceDojo.Plc;

namespace SequenceDojo;

/// <summary>
/// アプリ内で動く Web サーバー。画面（wwwroot）の配信と、画面⇔PLC 通信の WebSocket（/ws）を担当する。
/// 127.0.0.1 だけで待ち受けるので、PC の外からは接続できない。
/// </summary>
public static class WebServer
{
    /// <summary>既定のポート。localStorage はポートごとに分かれるので、なるべく固定にする。</summary>
    public const int PreferredPort = 5087;

    /// <summary>サーバーを起動して、アクセス先の URL を返す。既定ポートが使用中なら空きポートを使う。</summary>
    public static async Task<(WebApplication App, string Url)> StartAsync(string[] args, int port = PreferredPort)
    {
        try
        {
            return await StartOnAsync(args, port);
        }
        catch (IOException) when (port != 0)
        {
            return await StartOnAsync(args, 0);
        }
    }

    private static async Task<(WebApplication, string)> StartOnAsync(string[] args, int port)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = AppContext.BaseDirectory,
        });
        builder.WebHost.ConfigureKestrel(k => k.Listen(IPAddress.Loopback, port));
        builder.Services.AddSingleton<PlcService>();
        var app = builder.Build();
        Configure(app);
        await app.StartAsync();
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        return (app, address.Replace("127.0.0.1", "localhost") + "/");
    }

    private static void Configure(WebApplication app)
    {
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var plc = app.Services.GetRequiredService<PlcService>();
        var sockets = new ConcurrentDictionary<WebSocket, SemaphoreSlim>();

        async Task SendAsync(WebSocket ws, SemaphoreSlim gate, object msg)
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(msg, json);
            await gate.WaitAsync();
            try
            {
                if (ws.State == WebSocketState.Open)
                    await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch { /* 切断済み */ }
            finally { gate.Release(); }
        }

        plc.StateChanged += state =>
        {
            var msg = new { type = "state", state };
            foreach (var (ws, gate) in sockets) _ = SendAsync(ws, gate, msg);
        };

        app.UseDefaultFiles();
        // 更新したファイルが古いキャッシュで隠れないよう、毎回更新を確認させる（ETag で差分がなければ 304）
        app.UseStaticFiles(new StaticFileOptions
        {
            OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
        });
        app.UseWebSockets();

        // 通信先 PLC の機種選択肢（MELSEC / KEYENCE はライブラリの機種一覧から）
        app.MapGet("/api/profiles", () => Results.Json(PlcLinks.Catalog(), json));

        app.Map("/ws", async ctx =>
        {
            if (!ctx.WebSockets.IsWebSocketRequest) { ctx.Response.StatusCode = 400; return; }
            using var ws = await ctx.WebSockets.AcceptWebSocketAsync();
            var gate = new SemaphoreSlim(1, 1);
            sockets[ws] = gate;
            await SendAsync(ws, gate, new { type = "state", state = plc.Snapshot() });

            var buffer = new byte[16 * 1024];
            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    using var ms = new MemoryStream();
                    WebSocketReceiveResult r;
                    do
                    {
                        r = await ws.ReceiveAsync(buffer, ctx.RequestAborted);
                        if (r.MessageType == WebSocketMessageType.Close) break;
                        ms.Write(buffer, 0, r.Count);
                    } while (!r.EndOfMessage);
                    if (r.MessageType == WebSocketMessageType.Close) break;

                    using var doc = JsonDocument.Parse(ms.ToArray());
                    var root = doc.RootElement;
                    switch (root.GetProperty("type").GetString())
                    {
                        case "inputs":
                            plc.SetInputs(root.GetProperty("bits").EnumerateArray().Select(e => e.GetBoolean()).ToArray());
                            break;
                        case "connect":
                            var cfg = root.GetProperty("config").Deserialize<PlcConfig>(json) ?? new PlcConfig();
                            await plc.ConnectAsync(cfg);
                            break;
                        case "disconnect":
                            await plc.DisconnectAsync();
                            break;
                    }
                }
            }
            catch (Exception ex) when (ex is WebSocketException or OperationCanceledException) { }
            finally { sockets.TryRemove(ws, out _); }
        });
    }
}
