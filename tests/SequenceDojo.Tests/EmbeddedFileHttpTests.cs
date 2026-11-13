using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SequenceDojo.Tests;

public class EmbeddedFileHttpTests
{
    [Fact]
    public async Task EmbeddedAssetsServeRootModulesTasksHeadAndConditionalGet()
    {
        var (app, url) = await WebServer.StartAsync([], port: 0, embeddedFiles: true);
        await using var server = app;
        using var client = new HttpClient { BaseAddress = new Uri(url), Timeout = TimeSpan.FromSeconds(10) };
        try
        {
            using var root = await client.GetAsync("");
            root.EnsureSuccessStatusCode();
            Assert.Contains("js/app.js", await root.Content.ReadAsStringAsync());
            foreach (string path in new[] { "js/app.js", "vendor/three.module.js", "vendor/three.core.js", "vendor/addons/OrbitControls.js", "css/style.css", "img/logo.svg", "tasks/index.json", "tasks/t01_selfhold.json" })
            {
                using var response = await client.GetAsync(path);
                response.EnsureSuccessStatusCode();
                byte[] bytes = await response.Content.ReadAsByteArrayAsync();
                Assert.NotEmpty(bytes);
                Assert.True(response.Headers.CacheControl?.NoCache);
                string tag = '"' + Convert.ToHexString(SHA256.HashData(bytes)) + '"';
                Assert.Equal(tag, response.Headers.ETag?.Tag);
                if (path.EndsWith(".json")) using (JsonDocument.Parse(bytes)) { }
                using var head = await client.SendAsync(new HttpRequestMessage(HttpMethod.Head, path));
                Assert.Equal(HttpStatusCode.OK, head.StatusCode);
                Assert.Equal(bytes.Length, head.Content.Headers.ContentLength);
                Assert.Empty(await head.Content.ReadAsByteArrayAsync());
                using var conditional = new HttpRequestMessage(HttpMethod.Get, path);
                conditional.Headers.TryAddWithoutValidation("If-None-Match", tag);
                using var unchanged = await client.SendAsync(conditional);
                Assert.Equal(HttpStatusCode.NotModified, unchanged.StatusCode);
                Assert.True(unchanged.Headers.CacheControl?.NoCache);
                Assert.Empty(await unchanged.Content.ReadAsByteArrayAsync());
            }
            Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("missing-g5-test-file.js")).StatusCode);
        }
        finally { await app.StopAsync(); }
    }

    [Fact]
    public void EveryRelativeModuleImportExistsInTheAssembly()
    {
        var assembly = typeof(WebServer).Assembly;
        var resources = assembly.GetManifestResourceNames().ToDictionary(name => name.Replace('\\', '/'));
        foreach (string name in resources.Keys.Where(name => name.StartsWith("wwwroot/") && name.EndsWith(".js")))
        {
            using var reader = new StreamReader(assembly.GetManifestResourceStream(resources[name])!);
            foreach (Match match in Regex.Matches(reader.ReadToEnd(), "(?:from\\s*|import\\s*)['\"](\\.[^'\"]+)['\"]"))
            {
                string imported = new Uri(new Uri("https://embedded.invalid/" + name), match.Groups[1].Value).AbsolutePath.TrimStart('/');
                Assert.Contains(imported, resources.Keys);
            }
        }
        Assert.Contains("wwwroot/js/app.js", resources.Keys);
    }
}
