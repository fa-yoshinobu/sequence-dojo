using System.Collections.Concurrent;
using System.Reflection;
using System.Security.Cryptography;
using Microsoft.AspNetCore.StaticFiles;
using Microsoft.Net.Http.Headers;

namespace SequenceDojo;

/// <summary>画面を展開せずに配信する。内容のSHA-256をETagにして条件付きGETを維持する。</summary>
internal sealed class EmbeddedWebFiles
{
    private readonly Assembly _assembly = typeof(WebServer).Assembly;
    private readonly Dictionary<string, string> _names;
    private readonly ConcurrentDictionary<string, Asset> _assets = new();
    private readonly FileExtensionContentTypeProvider _types = new();

    public EmbeddedWebFiles() => _names = _assembly.GetManifestResourceNames()
        .Select(name => (Path: name.Replace('\\', '/'), Resource: name))
        .Where(item => item.Path.StartsWith("wwwroot/", StringComparison.Ordinal))
        .ToDictionary(item => item.Path[8..], item => item.Resource, StringComparer.Ordinal);

    internal static bool HasDevelopmentFiles(string directory)
    {
        // An empty Location identifies a bundled assembly: published EXEs always use embedded assets.
#pragma warning disable IL3000
        return typeof(WebServer).Assembly.Location.Length != 0 && Directory.Exists(directory);
#pragma warning restore IL3000
    }

    public async Task ServeAsync(HttpContext context)
    {
        string path = context.Request.Path.Value?.TrimStart('/') ?? "";
        if (path.Length == 0) path = "index.html";
        if (!_names.TryGetValue(path, out var resource))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        var asset = _assets.GetOrAdd(resource, name =>
        {
            using var stream = _assembly.GetManifestResourceStream(name)
                ?? throw new InvalidDataException("埋め込み画面ファイルを読み込めません。");
            using var content = new MemoryStream();
            stream.CopyTo(content);
            byte[] bytes = content.ToArray();
            _types.TryGetContentType(path, out var type);
            return new Asset(bytes, type ?? "application/octet-stream",
                new EntityTagHeaderValue('"' + Convert.ToHexString(SHA256.HashData(bytes)) + '"'));
        });
        context.Response.Headers.CacheControl = "no-cache";
        await Results.File(asset.Bytes, asset.Type, entityTag: asset.Tag, enableRangeProcessing: true).ExecuteAsync(context);
    }

    private sealed record Asset(byte[] Bytes, string Type, EntityTagHeaderValue Tag);
}
