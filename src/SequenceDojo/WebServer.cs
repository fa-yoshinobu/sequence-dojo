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
        builder.Services.AddSingleton<BrowserSession>();
        var app = builder.Build();
        Configure(app);
        try { await app.StartAsync(); }
        catch { await app.DisposeAsync(); throw; }
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        string url = address.Replace("127.0.0.1", "localhost") + "/";
        app.Services.GetRequiredService<BrowserSession>().Origin = new Uri(url).GetLeftPart(UriPartial.Authority);
        return (app, url);
    }

    private static void Configure(WebApplication app)
    {
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var plc = app.Services.GetRequiredService<PlcService>();
        var session = app.Services.GetRequiredService<BrowserSession>();
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

        app.MapPost("/session", async ctx =>
        {
            bool allowed = false;
            if (ctx.Request.HasFormContentType && ctx.Request.ContentLength is > 0 and <= 4096)
            {
                try
                {
                    var form = await ctx.Request.ReadFormAsync(ctx.RequestAborted);
                    allowed = form.TryGetValue("token", out var values) && values.Count == 1 && session.Matches(values[0]);
                }
                catch (Exception error) when (error is InvalidDataException or BadHttpRequestException)
                {
                    app.Logger.LogWarning("認証用フォームを拒否しました");
                }
            }
            if (!allowed)
            {
                app.Logger.LogWarning("認証情報が一致しないブラウザ接続を拒否しました");
                ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
            ctx.Response.Cookies.Append(BrowserSession.CookieName, session.Token,
                new CookieOptions { HttpOnly = true, SameSite = SameSiteMode.Strict, Path = "/", IsEssential = true });
            ctx.Response.Headers.CacheControl = "no-store";
            ctx.Response.StatusCode = StatusCodes.Status303SeeOther;
            ctx.Response.Headers.Location = "/";
        });

        app.Map("/ws", async ctx =>
        {
            if (!session.Allows(ctx))
            {
                app.Logger.LogWarning("Originまたは認証情報が一致しないWebSocket接続を拒否しました");
                ctx.Response.StatusCode = StatusCodes.Status403Forbidden;
                return;
            }
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
