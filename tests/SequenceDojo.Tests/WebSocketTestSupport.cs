using System.Net.WebSockets;
using System.Text.Json;

namespace SequenceDojo.Tests;

internal static class WebSocketTestSupport
{
    public static async Task ReceiveStateAsync(ClientWebSocket socket, CancellationToken ct)
    {
        var buffer = new byte[16 * 1024];
        var result = await socket.ReceiveAsync(buffer, ct);
        Assert.Equal(WebSocketMessageType.Text, result.MessageType);
        Assert.True(result.EndOfMessage);
        using var document = JsonDocument.Parse(buffer.AsMemory(0, result.Count));
        Assert.Equal("state", document.RootElement.GetProperty("type").GetString());
    }
}
