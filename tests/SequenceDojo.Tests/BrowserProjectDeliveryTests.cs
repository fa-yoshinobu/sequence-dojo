using System.Net;
using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace SequenceDojo.Tests;

public class BrowserProjectDeliveryTests
{
    [Fact]
    public async Task FileQueuedBeforeSocketReadyIsDeliveredAfterAuthenticationAndAcknowledged()
    {
        string path = Path.Combine(Path.GetTempPath(), "dojo-browser-" + Guid.NewGuid().ToString("N") + ".sdojo");
        File.WriteAllText(path, "{\"name\":\"queued before browser startup\"}");
        var (app, url) = await WebServer.StartAsync([], port: 0);
        await using var server = app;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        Task? opening = null;
        try
        {
            var session = app.Services.GetRequiredService<BrowserSession>();
            opening = session.ProjectOpens.OpenAsync(path, timeout.Token);
            using (var forbidden = Socket(session, url, "http://foreign.invalid"))
                await Assert.ThrowsAsync<WebSocketException>(() => forbidden.ConnectAsync(Endpoint(url), timeout.Token));
            Assert.False(opening.IsCompleted);
            using var socket = Socket(session, url, session.Origin);
            await socket.ConnectAsync(Endpoint(url), timeout.Token);
            await WebSocketTestSupport.ReceiveStateAsync(socket, timeout.Token);
            Assert.False(opening.IsCompleted);
            await Send(socket, new { type = "project-ready" }, timeout.Token);
            JsonElement payload = await Receive(socket, timeout.Token);
            Assert.Equal("file-opened", payload.GetProperty("type").GetString());
            Assert.Equal(path, payload.GetProperty("path").GetString());
            Assert.Contains("queued before browser startup", payload.GetProperty("content").GetString());
            await Send(socket, new { type = "file-open-completed", requestId = payload.GetProperty("requestId").GetString() }, timeout.Token);
            await opening.WaitAsync(timeout.Token);
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "complete", timeout.Token);
        }
        finally
        {
            timeout.Cancel();
            if (opening != null) { try { await opening; } catch (OperationCanceledException) { } }
            await app.StopAsync();
            File.Delete(path);
        }
    }

    [Fact]
    public async Task BrowserDisconnectBeforeAckKeepsTheFileForTheReconnectedReadyScreen()
    {
        string path = Path.Combine(Path.GetTempPath(), "dojo-browser-" + Guid.NewGuid().ToString("N") + ".sdojo");
        File.WriteAllText(path, "{}");
        var (app, url) = await WebServer.StartAsync([], port: 0);
        await using var server = app;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        Task? opening = null;
        try
        {
            var session = app.Services.GetRequiredService<BrowserSession>();
            opening = session.ProjectOpens.OpenAsync(path, timeout.Token);
            string? firstId;
            using (var first = Socket(session, url, session.Origin))
            {
                await first.ConnectAsync(Endpoint(url), timeout.Token);
                await WebSocketTestSupport.ReceiveStateAsync(first, timeout.Token);
                await Send(first, new { type = "project-ready" }, timeout.Token);
                firstId = (await Receive(first, timeout.Token)).GetProperty("requestId").GetString();
                await first.CloseAsync(WebSocketCloseStatus.NormalClosure, "reconnect", timeout.Token);
            }
            Assert.False(opening.IsCompleted);
            using var second = Socket(session, url, session.Origin);
            await second.ConnectAsync(Endpoint(url), timeout.Token);
            await WebSocketTestSupport.ReceiveStateAsync(second, timeout.Token);
            await Send(second, new { type = "project-ready" }, timeout.Token);
            var resent = await Receive(second, timeout.Token);
            Assert.Equal(firstId, resent.GetProperty("requestId").GetString());
            await Send(second, new { type = "file-open-completed", requestId = firstId }, timeout.Token);
            await opening.WaitAsync(timeout.Token);
            await second.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "complete", timeout.Token);
        }
        finally
        {
            timeout.Cancel();
            if (opening != null) { try { await opening; } catch (OperationCanceledException) { } }
            await app.StopAsync();
            File.Delete(path);
        }
    }

    private static Uri Endpoint(string url) => new UriBuilder(url) { Scheme = "ws", Path = "/ws" }.Uri;
    private static ClientWebSocket Socket(BrowserSession session, string url, string origin)
    {
        var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Origin", origin);
        socket.Options.Cookies = new CookieContainer();
        socket.Options.Cookies.Add(new Uri(url), new Cookie(BrowserSession.CookieName, session.Token));
        return socket;
    }
    private static Task Send(ClientWebSocket socket, object message, CancellationToken ct) =>
        socket.SendAsync(new ArraySegment<byte>(JsonSerializer.SerializeToUtf8Bytes(message)), WebSocketMessageType.Text, true, ct);
    private static async Task<JsonElement> Receive(ClientWebSocket socket, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        using var message = new MemoryStream();
        WebSocketReceiveResult result;
        do
        {
            result = await socket.ReceiveAsync(buffer, ct);
            Assert.Equal(WebSocketMessageType.Text, result.MessageType);
            message.Write(buffer, 0, result.Count);
        } while (!result.EndOfMessage);
        using var document = JsonDocument.Parse(message.ToArray());
        return document.RootElement.Clone();
    }
}
