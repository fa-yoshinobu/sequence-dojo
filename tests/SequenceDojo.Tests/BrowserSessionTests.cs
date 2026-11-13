using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace SequenceDojo.Tests;

public class BrowserSessionTests
{
    [Fact]
    public async Task InvalidBootstrapTokenCannotCreateASessionCookie()
    {
        var (app, url) = await WebServer.StartAsync([], port: 0);
        await using var server = app;
        try
        {
            using var handler = new HttpClientHandler { AllowAutoRedirect = false };
            using var client = new HttpClient(handler);
            client.DefaultRequestHeaders.Add("Origin", "null");
            using var form = new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = "wrong-token" });
            using var response = await client.PostAsync(new Uri(new Uri(url), "session"), form);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
            Assert.False(response.Headers.Contains("Set-Cookie"));
        }
        finally { await app.StopAsync(); }
    }

    [Fact]
    public async Task BootstrapFormCreatesHttpOnlyStrictCookieUsableByWebSocket()
    {
        var (app, url) = await WebServer.StartAsync([], port: 0);
        await using var server = app;
        try
        {
            var session = app.Services.GetRequiredService<BrowserSession>();
            var cookies = new CookieContainer();
            using var handler = new HttpClientHandler { AllowAutoRedirect = false, CookieContainer = cookies };
            using var client = new HttpClient(handler);
            client.DefaultRequestHeaders.Add("Origin", "null");
            using var form = new FormUrlEncodedContent(new Dictionary<string, string> { ["token"] = session.Token });
            using var response = await client.PostAsync(new Uri(new Uri(url), "session"), form);
            Assert.Equal(HttpStatusCode.SeeOther, response.StatusCode);
            Assert.Equal("/", response.Headers.Location?.ToString());
            string setCookie = Assert.Single(response.Headers.GetValues("Set-Cookie")).ToLowerInvariant();
            Assert.Contains("httponly", setCookie);
            Assert.Contains("samesite=strict", setCookie);
            Assert.Contains("no-store", response.Headers.CacheControl?.ToString());

            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader("Origin", session.Origin);
            socket.Options.Cookies = cookies;
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            await socket.ConnectAsync(new UriBuilder(url) { Scheme = "ws", Path = "/ws" }.Uri, timeout.Token);
            await WebSocketTestSupport.ReceiveStateAsync(socket, timeout.Token);
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
        }
        finally { await app.StopAsync(); }
    }

    [Theory]
    [InlineData("foreign", true)]
    [InlineData("missing", true)]
    [InlineData("null", true)]
    [InlineData("correct", false)]
    public async Task WrongOriginOrCookieCannotUpgradeToWebSocket(string originKind, bool validCookie)
    {
        var (app, url) = await WebServer.StartAsync([], port: 0);
        await using var server = app;
        try
        {
            var session = app.Services.GetRequiredService<BrowserSession>();
            using var client = new HttpClient();
            using var request = new HttpRequestMessage(HttpMethod.Get, new Uri(new Uri(url), "ws"));
            if (originKind != "missing")
                request.Headers.Add("Origin", originKind switch { "foreign" => "https://example.invalid", "null" => "null", _ => session.Origin });
            request.Headers.Add("Cookie", $"{BrowserSession.CookieName}={(validCookie ? session.Token : "wrong-token")}");
            request.Headers.Add("Connection", "Upgrade");
            request.Headers.Add("Upgrade", "websocket");
            request.Headers.Add("Sec-WebSocket-Version", "13");
            request.Headers.Add("Sec-WebSocket-Key", Convert.ToBase64String(Guid.NewGuid().ToByteArray()));
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        }
        finally { await app.StopAsync(); }
    }

    [Fact]
    public async Task CorrectOriginAndSessionCookieCanConnectAndReceiveState()
    {
        var (app, url) = await WebServer.StartAsync([], port: 0);
        await using var server = app;
        try
        {
            var session = app.Services.GetRequiredService<BrowserSession>();
            using var socket = new ClientWebSocket();
            socket.Options.SetRequestHeader("Origin", session.Origin);
            socket.Options.Cookies = new CookieContainer();
            socket.Options.Cookies.Add(new Uri(url), new Cookie(BrowserSession.CookieName, session.Token));
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(10));
            var address = new UriBuilder(url) { Scheme = "ws", Path = "/ws" }.Uri;
            await socket.ConnectAsync(address, timeout.Token);
            var buffer = new byte[16 * 1024];
            var result = await socket.ReceiveAsync(buffer, timeout.Token);
            Assert.Equal(WebSocketMessageType.Text, result.MessageType);
            Assert.True(result.EndOfMessage);
            using var document = JsonDocument.Parse(buffer.AsMemory(0, result.Count));
            Assert.Equal("state", document.RootElement.GetProperty("type").GetString());
            Assert.False(document.RootElement.GetProperty("state").GetProperty("connected").GetBoolean());
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
        }
        finally { await app.StopAsync(); }
    }
}
