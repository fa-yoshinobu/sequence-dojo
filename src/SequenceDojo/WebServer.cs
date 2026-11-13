using System.Collections.Concurrent;
using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.AspNetCore.Http.Features;
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
    public static async Task<(WebApplication App, string Url)> StartAsync(string[] args, int port = PreferredPort, bool embeddedFiles = false)
    {
        try
        {
            return await StartOnAsync(args, port, embeddedFiles);
        }
        catch (IOException) when (port != 0)
        {
            return await StartOnAsync(args, 0, embeddedFiles);
        }
    }

    private static async Task<(WebApplication, string)> StartOnAsync(string[] args, int port, bool embeddedFiles)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions
        {
            Args = args,
            ContentRootPath = AppContext.BaseDirectory,
        });
        builder.WebHost.ConfigureKestrel(k => k.Listen(IPAddress.Loopback, port));
        builder.Logging.AddProvider(new DiagnosticLoggerProvider());
        builder.Configuration["AllowedHosts"] = "localhost;127.0.0.1";
        builder.Services.AddSingleton<PlcService>();
        builder.Services.AddSingleton<BrowserSession>();
        var app = builder.Build();
        Configure(app, embeddedFiles);
        try { await app.StartAsync(); }
        catch { await app.DisposeAsync(); throw; }
        var address = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses.First();
        string url = address.Replace("127.0.0.1", "localhost") + "/";
        app.Services.GetRequiredService<BrowserSession>().Origin = new Uri(url).GetLeftPart(UriPartial.Authority);
        app.Logger.LogInformation("画面サーバーを起動しました: {Url}", url);
        return (app, url);
    }

    private static void Configure(WebApplication app, bool embeddedFiles)
    {
        var json = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var plc = app.Services.GetRequiredService<PlcService>();
        var session = app.Services.GetRequiredService<BrowserSession>();
        DiagnosticLog.Shared.RegisterSecret(session.Token);
        TaskFiles.MapEndpoints(app, session);
        var sockets = new ConcurrentDictionary<WebSocket, SemaphoreSlim>();
        var projectClients = new ConcurrentDictionary<WebSocket, string>();

        void SendPendingProject()
        {
            foreach (var (socket, clientId) in projectClients)
            {
                if (!sockets.TryGetValue(socket, out var sendGate)) continue;
                var payload = session.ProjectOpens.Claim(clientId);
                if (payload == null) continue;
                _ = SendAsync(socket, sendGate, payload);
                break;
            }
        }
        session.ProjectOpens.Pending += SendPendingProject;
        app.Lifetime.ApplicationStopped.Register(() => session.ProjectOpens.Pending -= SendPendingProject);


        async Task SendAsync(WebSocket ws, SemaphoreSlim gate, object msg)
        {
            var bytes = JsonSerializer.SerializeToUtf8Bytes(msg, json);
            await gate.WaitAsync();
            try
            {
                if (ws.State == WebSocketState.Open)
                    await ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch (Exception error) when (error is WebSocketException or OperationCanceledException or ObjectDisposedException)
            {
                app.Logger.LogDebug(error, "切断した画面への送信を終了しました");
            }
            catch (Exception error)
            {
                app.Logger.LogError(error, "画面への送信に失敗しました");
            }
            finally { gate.Release(); }
        }

        plc.StateChanged += state =>
        {
            var msg = new { type = "state", state };
            foreach (var (ws, gate) in sockets) _ = SendAsync(ws, gate, msg);
        };

        if (!embeddedFiles && EmbeddedWebFiles.HasDevelopmentFiles(Path.Combine(app.Environment.ContentRootPath, "wwwroot")))
        {
            app.UseDefaultFiles();
            app.UseStaticFiles(new StaticFileOptions
            {
                OnPrepareResponse = ctx => ctx.Context.Response.Headers.CacheControl = "no-cache",
            });
        }
        else
        {
            var assets = new EmbeddedWebFiles();
            app.MapMethods("/{**path}", ["GET", "HEAD"], assets.ServeAsync);
        }
        app.UseWebSockets();

        // 通信先 PLC の機種選択肢（MELSEC / KEYENCE はライブラリの機種一覧から）
        app.MapGet("/api/profiles", () => Results.Json(PlcLinks.Catalog(), json));

        app.MapPost("/api/client-errors", async ctx =>
        {
            if (!session.Allows(ctx)) { ctx.Response.StatusCode = 403; return; }
            if (ctx.Request.ContentLength > 16 * 1024) { ctx.Response.StatusCode = 413; return; }
            if (ctx.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit)
                limit.MaxRequestBodySize = 16 * 1024;
            try
            {
                using var document = await JsonDocument.ParseAsync(ctx.Request.Body, cancellationToken: ctx.RequestAborted);
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("message", out var message)
                    || message.ValueKind != JsonValueKind.String)
                {
                    ctx.Response.StatusCode = 400;
                    return;
                }
                string text = message.GetString()!;
                DiagnosticLog.Shared.Write("画面エラー: " + text[..Math.Min(text.Length, 2048)]);
                ctx.Response.StatusCode = 204;
            }
            catch (JsonException) { ctx.Response.StatusCode = 400; }
            catch (BadHttpRequestException error) { ctx.Response.StatusCode = error.StatusCode; }
        });

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
            string projectClientId = Guid.NewGuid().ToString("N");
            var gate = new SemaphoreSlim(1, 1);
            lock (sockets)
            {
                sockets[ws] = gate;
                plc.SetSocketCount(sockets.Count);
            }
            await SendAsync(ws, gate, new { type = "state", state = plc.Snapshot() });

            var buffer = new byte[16 * 1024];
            try
            {
                while (ws.State == WebSocketState.Open)
                {
                    using var ms = new MemoryStream();
                    bool oversized = false;
                    WebSocketReceiveResult r;
                    do
                    {
                        r = await ws.ReceiveAsync(buffer, ctx.RequestAborted);
                        if (r.MessageType == WebSocketMessageType.Close) break;
                        if (ms.Length + r.Count > 16 * 1024) oversized = true;
                        if (!oversized) ms.Write(buffer, 0, r.Count);
                    } while (!r.EndOfMessage);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    if (oversized || r.MessageType != WebSocketMessageType.Text) continue;
                    try
                    {
                        using var doc = JsonDocument.Parse(ms.ToArray());
                        var root = doc.RootElement;
                        if (root.ValueKind != JsonValueKind.Object
                            || !root.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String) continue;
                        switch (type.GetString())
                        {
                            case "project-ready":
                                session.ProjectOpens.Register(projectClientId);
                                projectClients[ws] = projectClientId;
                                SendPendingProject();
                                break;
                            case "file-open-completed":
                                if (root.TryGetProperty("requestId", out var requestId)
                                    && requestId.ValueKind == JsonValueKind.String && requestId.GetString() is { } id)
                                    session.ProjectOpens.Complete(projectClientId, id);
                                break;
                            case "inputs":
                                if (root.TryGetProperty("bits", out var bits) && bits.ValueKind == JsonValueKind.Array
                                    && bits.GetArrayLength() == PlcService.InputCount
                                    && bits.EnumerateArray().All(bit => bit.ValueKind is JsonValueKind.True or JsonValueKind.False))
                                    plc.SetInputs(bits.EnumerateArray().Select(bit => bit.GetBoolean()).ToArray());
                                break;
                            case "connect":
                                if (root.TryGetProperty("config", out var config) && config.ValueKind == JsonValueKind.Object)
                                {
                                    var cfg = config.Deserialize<PlcConfig>(json);
                                    if (cfg != null) await plc.ConnectAsync(cfg);
                                }
                                break;
                            case "disconnect":
                                await plc.DisconnectAsync();
                                break;
                        }
                    }
                    catch (Exception error) when (error is JsonException or InvalidOperationException or ArgumentException or FormatException)
                    {
                        app.Logger.LogWarning("形式が不正なWebSocketメッセージを無視しました");
                    }
                }
            }
            catch (Exception error) when (error is WebSocketException or OperationCanceledException)
            {
                app.Logger.LogDebug(error, "画面との受信を終了しました");
            }
            finally
            {
                projectClients.TryRemove(ws, out _);
                session.ProjectOpens.Release(projectClientId);
                lock (sockets)
                {
                    sockets.TryRemove(ws, out _);
                    plc.SetSocketCount(sockets.Count);
                }
                if (ws.State == WebSocketState.CloseReceived)
                {
                    using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                    try
                    {
                        await gate.WaitAsync(timeout.Token);
                        try { await ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "", timeout.Token); }
                        finally { gate.Release(); }
                    }
                    catch (Exception error) when (error is WebSocketException or OperationCanceledException)
                    {
                        app.Logger.LogDebug(error, "画面との終了応答を完了できませんでした");
                    }
                }
            }
        });
    }
}
