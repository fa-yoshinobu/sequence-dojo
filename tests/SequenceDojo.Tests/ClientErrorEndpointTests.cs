using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace SequenceDojo.Tests;

public class ClientErrorEndpointTests
{
    [Theory]
    [InlineData("foreign", true)]
    [InlineData("missing", true)]
    [InlineData("null", true)]
    [InlineData("correct", false)]
    public Task WrongOriginOrMissingCookieCannotRecordClientErrors(string originKind, bool validCookie) =>
        WithServer(async (client, address, session) =>
        {
            using var request = Request(address, session, "{\"message\":\"synthetic error\"}");
            request.Headers.Remove("Origin");
            if (originKind != "missing")
                request.Headers.Add("Origin", originKind switch { "foreign" => "https://example.invalid", "null" => "null", _ => session.Origin });
            if (!validCookie) request.Headers.Remove("Cookie");
            using var response = await client.SendAsync(request);
            Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        });

    [Fact]
    public Task CorrectOriginAndCookieCanRecordAClientError() => WithServer(async (client, address, session) =>
    {
        using var request = Request(address, session, "{\"message\":\"synthetic client error\"}");
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.Empty(await response.Content.ReadAsStringAsync());
    });

    [Fact]
    public Task SelectionEventsAreLoggedAsOperationsRatherThanErrors() => WithServer(async (client, address, session) =>
    {
        string marker = "selection-test-" + Guid.NewGuid();
        using var request = Request(address, session, JsonSerializer.Serialize(new { kind = "event", message = marker }));
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        string log = await File.ReadAllTextAsync(Path.Combine(DiagnosticLog.Shared.DirectoryPath, "sequence-dojo.log"));
        Assert.Contains("画面操作: " + marker, log);
        Assert.DoesNotContain("画面エラー: " + marker, log);
    });

    [Theory]
    [InlineData("not json")]
    [InlineData("{}")]
    [InlineData("[]")]
    [InlineData("{\"message\":7}")]
    public Task MalformedOrWrongShapeJsonIsRejected(string body) => WithServer(async (client, address, session) =>
    {
        using var request = Request(address, session, body);
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    });

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public Task BodyLimitAppliesToDeclaredLengthAndChunkedRequests(bool chunked) => WithServer(async (client, address, session) =>
    {
        string body = JsonSerializer.Serialize(new { message = new string('x', 20 * 1024) });
        using var request = Request(address, session, body);
        if (chunked) request.Headers.TransferEncodingChunked = true;
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
    });

    [Fact]
    public Task LongMessageWithinBodyLimitIsAcceptedForBoundedLogging() => WithServer(async (client, address, session) =>
    {
        using var request = Request(address, session, JsonSerializer.Serialize(new { message = new string('x', 8192) }));
        using var response = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    });

    private static HttpRequestMessage Request(Uri address, BrowserSession session, string body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, address)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };
        request.Headers.Add("Origin", session.Origin);
        request.Headers.Add("Cookie", $"{BrowserSession.CookieName}={session.Token}");
        return request;
    }

    private static async Task WithServer(Func<HttpClient, Uri, BrowserSession, Task> check)
    {
        var (app, url) = await WebServer.StartAsync([], port: 0);
        await using var server = app;
        using var client = new HttpClient(new HttpClientHandler { UseCookies = false });
        try
        {
            await check(client, new Uri(new Uri(url), "api/client-errors"), app.Services.GetRequiredService<BrowserSession>());
        }
        finally { await app.StopAsync(); }
    }
}
