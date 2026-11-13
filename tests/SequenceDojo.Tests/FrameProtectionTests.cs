using System.Net;

namespace SequenceDojo.Tests;

public class FrameProtectionTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task NativeFileBridgeCannotBeFramedByAnotherPage(bool embedded)
    {
        var (app, url) = await WebServer.StartAsync([], port: 0, embeddedFiles: embedded);
        await using var server = app;
        using var client = new HttpClient { BaseAddress = new Uri(url) };
        try
        {
            using var response = await client.GetAsync("");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("DENY", Assert.Single(response.Headers.GetValues("X-Frame-Options")));
            Assert.Equal("frame-ancestors 'none'", Assert.Single(response.Headers.GetValues("Content-Security-Policy")));
        }
        finally { await app.StopAsync(); }
    }
}
