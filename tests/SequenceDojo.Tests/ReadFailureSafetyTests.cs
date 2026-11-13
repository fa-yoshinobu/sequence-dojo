using System.Collections.Concurrent;
using SequenceDojo.Plc;

namespace SequenceDojo.Tests;

public class ReadFailureSafetyTests
{
    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task DisconnectDuringReadFailureWaitsForIndependentOffAttemptAndClose(bool dispose, bool failOff)
    {
        string folder = Directory.CreateTempSubdirectory("dojo-read-failure-").FullName;
        var link = new FailingReadLink(failOff);
        var service = new PlcService((_, _) => Task.FromResult<IPlcLink>(link), diagnostics: new DiagnosticLog(folder));
        try
        {
            service.SetSocketCount(1);
            service.SetInputs(Enumerable.Repeat(true, 16).ToArray());
            await service.ConnectAsync(new PlcConfig(IntervalMs: 10, TimeoutMs: 10000));
            await link.OffEntered.Task.WaitAsync(TimeSpan.FromSeconds(3));
            Assert.False(service.Snapshot().Connected);
            Task closing = dispose ? service.DisposeAsync().AsTask() : service.DisconnectAsync();
            Assert.False(closing.IsCompleted);
            link.FinishOff.TrySetResult();
            await closing.WaitAsync(TimeSpan.FromSeconds(3));
            Assert.Equal(new[] { "on", "off", "close" }, link.Calls);
            Assert.False(link.OffCancelled);
            Assert.False(service.Snapshot().Connected);
        }
        finally
        {
            link.FinishOff.TrySetResult();
            await service.DisposeAsync();
            string full = Path.GetFullPath(folder);
            Assert.Equal(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())), Path.GetDirectoryName(full), ignoreCase: true);
            Assert.StartsWith("dojo-read-failure-", Path.GetFileName(full));
            Directory.Delete(full, recursive: true);
        }
    }

    private sealed class FailingReadLink(bool failOff) : IPlcLink
    {
        public string Endpoint => "fake read-only failure";
        public ConcurrentQueue<string> Calls { get; } = new();
        public TaskCompletionSource OffEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource FinishOff { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public bool OffCancelled { get; private set; }
        public async Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct)
        {
            Assert.Equal(16, bits.Count);
            if (bits.Any(bit => bit)) { Calls.Enqueue("on"); return; }
            Calls.Enqueue("off");
            OffEntered.TrySetResult();
            await FinishOff.Task.WaitAsync(ct);
            OffCancelled = ct.IsCancellationRequested;
            if (failOff) throw new IOException("OFF rejected");
        }
        public Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct) => throw new IOException("read failed after successful ON");
        public ValueTask DisposeAsync() { Calls.Enqueue("close"); return ValueTask.CompletedTask; }
    }
}
