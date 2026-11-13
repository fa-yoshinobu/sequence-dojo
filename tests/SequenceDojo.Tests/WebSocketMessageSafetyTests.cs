using System.Net;
using System.Net.WebSockets;
using System.Text;
using Microsoft.Extensions.DependencyInjection;

namespace SequenceDojo.Tests;

public class WebSocketMessageSafetyTests
{
    [Theory]
    [InlineData("{")]
    [InlineData("{}")]
    [InlineData("null")]
    [InlineData("{\"type\":17}")]
    [InlineData("{\"type\":\"inputs\",\"bits\":true}")]
    [InlineData("{\"type\":\"inputs\",\"bits\":[true]}")]
    [InlineData("{\"type\":\"inputs\",\"bits\":[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]}")]
    [InlineData("{\"type\":\"inputs\",\"bits\":[true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true,true]}")]
    [InlineData("{\"type\":\"connect\",\"config\":17}")]
    public async Task MalformedMessageDoesNotPreventAValidDisconnectAndStateReply(string invalidMessage)
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
            await socket.ConnectAsync(new UriBuilder(url) { Scheme = "ws", Path = "/ws" }.Uri, timeout.Token);
            await WebSocketTestSupport.ReceiveStateAsync(socket, timeout.Token);
            await socket.SendAsync(Encoding.UTF8.GetBytes(invalidMessage), WebSocketMessageType.Text, true, timeout.Token);
            await socket.SendAsync(Encoding.UTF8.GetBytes("{\"type\":\"disconnect\"}"), WebSocketMessageType.Text, true, timeout.Token);
            await WebSocketTestSupport.ReceiveStateAsync(socket, timeout.Token);
            Assert.Equal(WebSocketState.Open, socket.State);
            await socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "test complete", timeout.Token);
        }
        finally { await app.StopAsync(); }
    }
}
