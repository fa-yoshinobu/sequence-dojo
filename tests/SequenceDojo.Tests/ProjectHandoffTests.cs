using System.Collections.Concurrent;

namespace SequenceDojo.Tests;

public class ProjectHandoffTests
{
    [Fact]
    public void PipeNamesAreStableAndSeparatedByUserIdentity()
    {
        Assert.Equal(SingleInstanceHandoff.NameForIdentity("user-a"), SingleInstanceHandoff.NameForIdentity("user-a"));
        Assert.NotEqual(SingleInstanceHandoff.NameForIdentity("user-a"), SingleInstanceHandoff.NameForIdentity("user-b"));
        Assert.DoesNotContain("user-a", SingleInstanceHandoff.NameForIdentity("user-a"));
    }

    [Fact]
    public void ReceiverChecksExtensionAndFiveMegabyteLimitBeforeReading()
    {
        using var files = new Folder();
        string valid = files.File("valid.SDOJO", "{\"name\":\"日本語\"}");
        Assert.Equal(Path.GetFullPath(valid), ProjectFiles.ValidatePath(valid));
        Assert.Contains("日本語", ProjectFiles.ReadContent(valid));
        Assert.Throws<IOException>(() => ProjectFiles.ValidatePath(files.File("wrong.txt", "{}")));
        string large = files.File("large.sdojo", "");
        using (var stream = new FileStream(large, FileMode.Open, FileAccess.Write)) stream.SetLength(ProjectFiles.MaxBytes + 1);
        Assert.Throws<IOException>(() => ProjectFiles.ReadContent(large));
    }

    [Fact]
    public void StartupAndInFlightRequestsAreDeduplicatedAndClosingRejectsFurtherRequests()
    {
        using var files = new Folder();
        string first = files.File("first.sdojo", "{}");
        string second = files.File("second.sdojo", "{}");
        var queue = new ProjectOpenQueue();
        Assert.True(queue.Enqueue(first));
        Assert.True(queue.Enqueue(first));
        Assert.True(queue.TryTake(out string selected));
        Assert.Equal(first, selected);
        Assert.True(queue.Enqueue(first));
        Assert.False(queue.TryTake(out _));
        Assert.True(queue.Enqueue(second));
        queue.Complete(first);
        Assert.True(queue.Enqueue(first));
        Assert.True(queue.TryTake(out selected));
        Assert.Equal(second, selected);
        queue.Close();
        Assert.False(queue.TryTake(out _));
        Assert.False(queue.Enqueue(first));
    }

    [Fact]
    public async Task CurrentUserPipeTransfersOnlyThePathAndRejectsAnInvalidFile()
    {
        using var files = new Folder();
        string project = files.File("queued.sdojo", "{\"notSentThroughPipe\":true}");
        var received = new ConcurrentQueue<string>();
        string pipe = "SequenceDojo-test-" + Guid.NewGuid().ToString("N");
        await using var server = new SingleInstanceHandoff(pipe, path =>
        {
            received.Enqueue(ProjectFiles.ValidatePath(path));
            return true;
        });
        Assert.True(await SingleInstanceHandoff.SendAsync(pipe, project));
        Assert.Equal(project, Assert.Single(received));
        Assert.False(await SingleInstanceHandoff.SendAsync(pipe, files.File("rejected.txt", "{}")));
        Assert.Single(received);
    }

    [Fact]
    public async Task PipeListenerStopsWhileWaitingForASecondLaunch()
    {
        var server = new SingleInstanceHandoff("SequenceDojo-stop-test-" + Guid.NewGuid().ToString("N"), _ => true);
        await server.DisposeAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(2));
        await server.DisposeAsync();
    }

    [Fact]
    public void AssociationQuotesTheExecutableAndRestoresThePreviousUserDefault()
    {
        var store = new MemoryAssociations();
        store.Write(".sdojo", "Previous.App");
        var association = new ProjectAssociation(store);
        association.Register(@"C:\Applications\Sequence Dojo\SequenceDojo.exe");
        association.Register(@"C:\Applications\Moved Dojo\SequenceDojo.exe");
        Assert.Equal("\"C:\\Applications\\Moved Dojo\\SequenceDojo.exe\" \"%1\"",
            store.Read(ProjectAssociation.ProgId + @"\shell\open\command"));
        association.Unregister();
        Assert.Equal("Previous.App", store.Read(".sdojo"));
        Assert.Null(store.Read(ProjectAssociation.ProgId));
    }

    [Fact]
    public void RemovingOurAssociationDoesNotOverwriteASubsequentlySelectedApplication()
    {
        var store = new MemoryAssociations();
        var association = new ProjectAssociation(store);
        association.Register(@"C:\Applications\SequenceDojo.exe");
        store.Write(".sdojo", "Other.App");
        association.Unregister();
        Assert.Equal("Other.App", store.Read(".sdojo"));
    }

    [Fact]
    public async Task BrowserOpenWaitsForAReadyClientAndItsMatchingAcknowledgement()
    {
        using var files = new Folder();
        string path = files.File("browser.sdojo", "{\"name\":\"browser fallback\"}");
        var opens = new BrowserProjectOpens();
        opens.Register("ready-client");
        opens.Register("other-client");
        Task request = opens.OpenAsync(path, CancellationToken.None);
        Assert.False(request.IsCompleted);
        var payload = Assert.IsType<CoreProjectPayload>(opens.Claim("ready-client"));
        Assert.Equal(path, payload.Path);
        Assert.Contains("browser fallback", payload.Content);
        Assert.Null(opens.Claim("other-client"));
        Assert.False(opens.Complete("other-client", payload.RequestId));
        Assert.False(opens.Complete("ready-client", "wrong-id"));
        Assert.False(request.IsCompleted);
        Assert.True(opens.Complete("ready-client", payload.RequestId));
        await request.WaitAsync(TimeSpan.FromSeconds(2));
        Assert.Null(opens.Claim("ready-client"));
    }

    [Fact]
    public async Task BrowserDisconnectReturnsTheSameRequestToTheNextReadyClient()
    {
        using var files = new Folder();
        var opens = new BrowserProjectOpens();
        opens.Register("old-client");
        opens.Register("new-client");
        Task request = opens.OpenAsync(files.File("retry.sdojo", "{}"), CancellationToken.None);
        var first = Assert.IsType<CoreProjectPayload>(opens.Claim("old-client"));
        opens.Release("old-client");
        var next = Assert.IsType<CoreProjectPayload>(opens.Claim("new-client"));
        Assert.Equal(first.RequestId, next.RequestId);
        Assert.False(opens.Complete("old-client", first.RequestId));
        Assert.True(opens.Complete("new-client", next.RequestId));
        await request.WaitAsync(TimeSpan.FromSeconds(2));
    }

    [Fact]
    public async Task ClosingCancelsABrowserRequestThatHasNoReadySocket()
    {
        using var files = new Folder();
        using var closing = new CancellationTokenSource();
        var opens = new BrowserProjectOpens();
        opens.Register("late-client");
        Task request = opens.OpenAsync(files.File("pending.sdojo", "{}"), closing.Token);
        closing.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => request);
        Assert.Null(opens.Claim("late-client"));
    }

    private sealed class MemoryAssociations : IAssociationStore
    {
        private readonly Dictionary<string, string> _values = new(StringComparer.OrdinalIgnoreCase);
        public string? Read(string key, string name = "") => _values.GetValueOrDefault(key + "|" + name);
        public void Write(string key, string value, string name = "") => _values[key + "|" + name] = value;
        public void DeleteValue(string key, string name = "") => _values.Remove(key + "|" + name);
        public void DeleteTree(string key)
        {
            foreach (string name in _values.Keys.Where(name => name.StartsWith(key + "|", StringComparison.OrdinalIgnoreCase)
                || name.StartsWith(key + "\\", StringComparison.OrdinalIgnoreCase)).ToArray()) _values.Remove(name);
        }
    }

    private sealed class Folder : IDisposable
    {
        private readonly string _path = Directory.CreateTempSubdirectory("dojo-handoff-").FullName;
        public string File(string name, string contents)
        {
            string path = Path.Combine(_path, name);
            System.IO.File.WriteAllText(path, contents);
            return path;
        }
        public void Dispose()
        {
            string full = Path.GetFullPath(_path);
            string parent = Path.GetDirectoryName(full)!;
            string temporary = Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar);
            if (!string.Equals(parent, temporary, StringComparison.OrdinalIgnoreCase)
                || !Path.GetFileName(full).StartsWith("dojo-handoff-", StringComparison.Ordinal))
                throw new InvalidOperationException("Unexpected test directory.");
            Directory.Delete(full, recursive: true);
        }
    }
}
