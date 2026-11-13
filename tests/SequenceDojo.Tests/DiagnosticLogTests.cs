using System.Text;
using Microsoft.Extensions.Logging;
using SequenceDojo.Plc;

namespace SequenceDojo.Tests;

public class DiagnosticLogTests
{
    [Fact]
    public void RotationBoundsFileCountAndUtf8EntrySize()
    {
        using var folder = new TestFolder();
        var log = new DiagnosticLog(folder.LogPath, maxFileBytes: 256, maxFiles: 3);
        for (int i = 0; i < 40; i++) log.Write($"entry {i}: " + string.Concat(Enumerable.Repeat("あ𠀋", 300)));
        var files = Directory.GetFiles(folder.LogPath);
        Assert.InRange(files.Length, 1, 3);
        var strictUtf8 = new UTF8Encoding(false, true);
        foreach (string file in files)
        {
            byte[] bytes = File.ReadAllBytes(file);
            Assert.InRange(bytes.Length, 1, 256);
            string text = strictUtf8.GetString(bytes);
            Assert.EndsWith("\n", text);
            Assert.Contains("あ", text);
        }
        Assert.Contains("entry 39", File.ReadAllText(Path.Combine(folder.LogPath, "sequence-dojo.log")));
    }

    [Fact]
    public void SingleFileRetentionReplacesThePreviousEntry()
    {
        using var folder = new TestFolder();
        var log = new DiagnosticLog(folder.LogPath, maxFileBytes: 128, maxFiles: 1);
        for (int i = 0; i < 8; i++) log.Write($"last entry {i}: " + new string('x', 200));
        string path = Assert.Single(Directory.GetFiles(folder.LogPath));
        Assert.True(new FileInfo(path).Length <= 128);
        Assert.Contains("last entry 7", File.ReadAllText(path));
        Assert.DoesNotContain("last entry 6", File.ReadAllText(path));
    }

    [Fact]
    public void ConcurrentWritersKeepCompleteBoundedRecords()
    {
        using var folder = new TestFolder();
        var log = new DiagnosticLog(folder.LogPath, maxFileBytes: 256, maxFiles: 4);
        Parallel.For(0, 80, i => log.Write($"parallel record {i}"));
        var files = Directory.GetFiles(folder.LogPath);
        Assert.InRange(files.Length, 1, 4);
        foreach (string path in files)
        {
            Assert.True(new FileInfo(path).Length <= 256);
            Assert.All(File.ReadAllLines(path), line => Assert.Contains("parallel record", line));
        }
    }

    [Fact]
    public void RegisteredSecretsSessionTokensAndBootstrapHtmlAreNotRecorded()
    {
        using var folder = new TestFolder();
        var log = new DiagnosticLog(folder.LogPath);
        string registered = "synthetic-secret-value";
        string sessionToken = new string('A', 64);
        log.RegisterSecret(registered);
        log.Write("context " + registered, new InvalidOperationException("exception " + sessionToken));
        log.Write("bootstrap <!doctype html><form><input name=token value=synthetic-bootstrap-secret></form>");
        string text = File.ReadAllText(Path.Combine(folder.LogPath, "sequence-dojo.log"));
        Assert.DoesNotContain(registered, text);
        Assert.DoesNotContain(sessionToken, text);
        Assert.DoesNotContain("synthetic-bootstrap-secret", text);
        Assert.DoesNotContain("<!doctype", text);
        Assert.Contains("[redacted]", text);
        Assert.Contains("[HTML content omitted]", text);
    }

    [Fact]
    public void InvalidStorageDoesNotThrowFromTheWriterOrLoggerProvider()
    {
        using var folder = new TestFolder();
        string blocked = Path.Combine(folder.Path, "file-instead-of-directory");
        File.WriteAllText(blocked, "keep this file");
        var log = new DiagnosticLog(Path.Combine(blocked, "logs"));
        Assert.Null(Record.Exception(() => log.Write("cannot write", new IOException("failure"))));
        using var provider = new DiagnosticLoggerProvider(log);
        Assert.Null(Record.Exception(() => provider.CreateLogger("test").LogWarning("cannot write either")));
        Assert.Equal("keep this file", File.ReadAllText(blocked));
    }

    [Fact]
    public void ProviderFormatsStructuredEventsAndKeepsExceptionDetails()
    {
        using var folder = new TestFolder();
        using var provider = new DiagnosticLoggerProvider(new DiagnosticLog(folder.LogPath));
        var logger = provider.CreateLogger("SyntheticServer");
        logger.LogDebug("debug hidden");
        logger.LogWarning(new IOException("offline peer"), "PLC {Host}:{Port} failed", "127.0.0.1", 4321);
        string text = File.ReadAllText(Path.Combine(folder.LogPath, "sequence-dojo.log"));
        Assert.Contains("Warning SyntheticServer: PLC 127.0.0.1:4321 failed", text);
        Assert.Contains("offline peer", text);
        Assert.DoesNotContain("debug hidden", text);
    }

    [Fact]
    public void AThrowingFormatterCannotStopTheApplication()
    {
        using var folder = new TestFolder();
        using var provider = new DiagnosticLoggerProvider(new DiagnosticLog(folder.LogPath));
        var logger = provider.CreateLogger("SyntheticServer");
        Assert.Null(Record.Exception(() => logger.Log(LogLevel.Error, new EventId(1), "state", null,
            (_, _) => throw new InvalidOperationException("formatter failed"))));
        string text = File.ReadAllText(Path.Combine(folder.LogPath, "sequence-dojo.log"));
        Assert.Contains("ログ書式の生成に失敗", text);
        Assert.Contains("formatter failed", text);
    }

    [Fact]
    public void FolderOpeningUsesTheResolvedExistingStorageLocation()
    {
        using var folder = new TestFolder();
        var log = new DiagnosticLog(folder.LogPath);
        string resolved = log.GetExistingDirectoryPath();
        Assert.True(Path.IsPathFullyQualified(resolved));
        Assert.True(Directory.Exists(resolved));
        Assert.False(resolved.StartsWith(@"\\?\", StringComparison.Ordinal));
    }

    [Fact]
    public async Task PlcConnectionFailureRecordsPeerAndCauseWithoutUsingTheNetwork()
    {
        using var folder = new TestFolder();
        await using var service = new PlcService((_, _) => Task.FromException<IPlcLink>(new IOException("synthetic peer unavailable")),
            diagnostics: new DiagnosticLog(folder.LogPath));
        await service.ConnectAsync(new PlcConfig(Host: "127.0.0.1", Port: 4321));
        Assert.False(service.Snapshot().Connected);
        string text = File.ReadAllText(Path.Combine(folder.LogPath, "sequence-dojo.log"));
        Assert.Contains("127.0.0.1:4321", text);
        Assert.Contains("synthetic peer unavailable", text);
    }

    [Fact]
    public async Task PlcConnectAndNormalCancellationShutdownAreRecordedWithoutAnError()
    {
        using var folder = new TestFolder();
        await using var service = new PlcService((_, _) => Task.FromResult<IPlcLink>(new SyntheticLink()),
            diagnostics: new DiagnosticLog(folder.LogPath));
        await service.ConnectAsync(new PlcConfig(IntervalMs: 10));
        await service.DisconnectAsync();
        string text = File.ReadAllText(Path.Combine(folder.LogPath, "sequence-dojo.log"));
        Assert.Contains("PLCへ接続しました: synthetic peer", text);
        Assert.Contains("PLC通信を終了しました: synthetic peer", text);
        Assert.DoesNotContain("に失敗", text);
        Assert.DoesNotContain("通信エラー", text);
    }

    private sealed class SyntheticLink : IPlcLink
    {
        public string Endpoint => "synthetic peer";
        public Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct) => Task.CompletedTask;
        public Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct) => Task.FromResult(new bool[count]);
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    private sealed class TestFolder : IDisposable
    {
        public string Path { get; } = Directory.CreateTempSubdirectory("seq-diagnostics-").FullName;
        public string LogPath => System.IO.Path.Combine(Path, "logs");
        public void Dispose() => Directory.Delete(Path, recursive: true);
    }
}
