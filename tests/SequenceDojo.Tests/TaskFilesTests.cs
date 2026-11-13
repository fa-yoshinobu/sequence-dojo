using System.Net;
using System.Text;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Logging;
using SequenceDojo;

namespace SequenceDojo.Tests;

public sealed class TaskFilesTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "SequenceDojo.TaskTests", Guid.NewGuid().ToString("N"));
    private const string Valid = """{"title":"<img src=x onerror=alert(1)>","grade":3,"scenario":[{"expect":{"PL1":false}}]}""";
    private TaskFiles Storage => new(_root);

    [Theory]
    [InlineData("t01_selfhold.json")]
    [InlineData("t02_conveyor.json")]
    [InlineData("t03_hinban.json")]
    public void BundledTasksPassSchema(string name)
    {
        var folder = new DirectoryInfo(AppContext.BaseDirectory);
        while (folder != null && !File.Exists(Path.Combine(folder.FullName, "SequenceDojo.sln"))) folder = folder.Parent;
        Assert.NotNull(folder);
        TaskFiles.Validate(File.ReadAllText(Path.Combine(folder.FullName, "src", "SequenceDojo", "wwwroot", "tasks", name)));
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"title\":\"x\",\"grade\":4,\"scenario\":[{\"reset\":true}]}")]
    [InlineData("{\"title\":\"x\",\"scenario\":[{\"work\":{\"at\":\"left\"}}]}")]
    [InlineData("{\"title\":\"x\",\"scenario\":[{\"expect\":{\"PL1\":1}}]}")]
    [InlineData("{\"title\":\"x\",\"scenario\":[{\"expect\":{\"PLC_ADDRESS\":true}}]}")]
    [InlineData("{\"title\":\"x\",\"scenario\":[{\"press\":\"PB6\"}]}")]
    [InlineData("{\"title\":\"x\",\"scenario\":[{\"expectFor\":{\"PL1\":true}}]}")]
    public void InvalidSchemaIsRejected(string content) => Assert.Throws<IOException>(() => TaskFiles.Validate(content));

    [Fact]
    public void InvalidStepReportsItsOriginalLine()
    {
        var error = Assert.Throws<IOException>(() => TaskFiles.Validate("{\"title\":\"x\",\"scenario\":[\n {\"reset\":true},\n {\"work\":{\"at\":\"left\"}}\n]}"));
        Assert.Contains("行 3: scenario[1]", error.Message);
    }

    [Fact]
    public async Task ImportGeneratesNamesAndNeverOverwrites()
    {
        var first = await Storage.ImportAsync(new MemoryStream(Encoding.UTF8.GetBytes(Valid)));
        var second = await Storage.ImportAsync(new MemoryStream(Encoding.UTF8.GetBytes(Valid)));
        Assert.Matches("^[a-f0-9]{32}\\.json$", first.File);
        Assert.NotEqual(first.File, second.File);
        Assert.Equal(Valid, File.ReadAllText(Path.Combine(_root, first.File)));
        Assert.Equal(2, Directory.GetFiles(_root).Length);
    }

    [Fact]
    public async Task OversizedOrInvalidImportCreatesNoFiles()
    {
        await Assert.ThrowsAsync<IOException>(() => Storage.ImportAsync(new MemoryStream(new byte[TaskFiles.MaxBytes + 1])));
        await Assert.ThrowsAsync<IOException>(() => Storage.ImportAsync(new MemoryStream(Encoding.UTF8.GetBytes("{}"))));
        Assert.False(Directory.Exists(_root));
    }

    [Fact]
    public async Task BrokenOrLockedFileDoesNotHideValidTask()
    {
        Directory.CreateDirectory(_root);
        File.WriteAllText(Path.Combine(_root, "good.json"), Valid);
        File.WriteAllText(Path.Combine(_root, "broken.json"), "{bad");
        File.WriteAllText(Path.Combine(_root, "locked.json"), Valid);
        using var locked = File.Open(Path.Combine(_root, "locked.json"), FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        var result = await Storage.ReadAllAsync();
        Assert.Single(result.Items);
        Assert.Equal("good.json", result.Items[0].File);
        Assert.Equal(2, result.Errors.Count);
    }

    [Fact]
    public async Task HttpEndpointsRequireCookieAndOriginBeforeWriting()
    {
        var builder = WebApplication.CreateBuilder();
        builder.Logging.ClearProviders();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        await using var app = builder.Build();
        var session = new BrowserSession();
        TaskFiles.MapEndpoints(app, session, Storage);
        await app.StartAsync();
        session.Origin = app.Urls.Single();
        using var client = new HttpClient { BaseAddress = new Uri(session.Origin) };
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/tasks")).StatusCode);
        client.DefaultRequestHeaders.Add("Cookie", $"{BrowserSession.CookieName}={session.Token}");
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/tasks")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/tasks", new StringContent(Valid))).StatusCode);
        client.DefaultRequestHeaders.Add("Origin", "https://untrusted.invalid");
        Assert.Equal(HttpStatusCode.Forbidden, (await client.GetAsync("/api/tasks")).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/tasks", new StringContent(Valid))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsync("/api/tasks/open-folder", null)).StatusCode);
        Assert.False(Directory.Exists(_root));
        client.DefaultRequestHeaders.Remove("Origin");
        client.DefaultRequestHeaders.Add("Origin", session.Origin);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/tasks", new StringContent(Valid))).StatusCode);
        Assert.Single(Directory.GetFiles(_root));
        await app.StopAsync();
    }

    public void Dispose()
    {
        string expected = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "SequenceDojo.TaskTests")) + Path.DirectorySeparatorChar;
        if (Directory.Exists(_root) && Path.GetFullPath(_root).StartsWith(expected, StringComparison.OrdinalIgnoreCase)) Directory.Delete(_root, true);
    }
}
