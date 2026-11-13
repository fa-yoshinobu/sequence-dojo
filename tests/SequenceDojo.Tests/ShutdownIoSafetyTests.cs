using System.Collections.Concurrent;
using SequenceDojo.Plc;

namespace SequenceDojo.Tests;

public class ShutdownIoSafetyTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task StoppingDuringAnInFlightReadPreservesTheTransportForFinalOff(bool dispose)
    {
        string folder = Directory.CreateTempSubdirectory("dojo-shutdown-io-").FullName;
        var link = new CancellationClosesTransportLink();
        var service = new PlcService((_, _) => Task.FromResult<IPlcLink>(link), diagnostics: new DiagnosticLog(folder));
        try
        {
            service.SetSocketCount(1);
            service.SetInputs(Enumerable.Repeat(true, 16).ToArray());
            await service.ConnectAsync(new PlcConfig(IntervalMs: 10, TimeoutMs: 10000));
            await link.ReadEntered.Task.WaitAsync(TimeSpan.FromSeconds(3));
            Task closing = dispose ? service.DisposeAsync().AsTask() : service.DisconnectAsync();
            Assert.False(closing.IsCompleted);
            Assert.False(link.TransportClosed);
            link.FinishRead.TrySetResult();
            await closing.WaitAsync(TimeSpan.FromSeconds(3));
            Assert.Equal(new[] { "on", "read", "off", "close" }, link.Calls);
            Assert.Null(service.Snapshot().Error);
            Assert.True(link.TransportClosed);
        }
        finally
        {
            link.FinishRead.TrySetResult();
            await service.DisposeAsync();
            string full = Path.GetFullPath(folder);
            Assert.Equal(Path.TrimEndingDirectorySeparator(Path.GetFullPath(Path.GetTempPath())), Path.GetDirectoryName(full), ignoreCase: true);
            Assert.StartsWith("dojo-shutdown-io-", Path.GetFileName(full));
            Directory.Delete(full, recursive: true);
        }
    }

    private sealed class CancellationClosesTransportLink : IPlcLink
    {
        public string Endpoint => "fake cancellation-sensitive transport";
        public ConcurrentQueue<string> Calls { get; } = new();
        public TaskCompletionSource ReadEntered { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public TaskCompletionSource FinishRead { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public volatile bool TransportClosed;
        public Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct)
        {
            Assert.False(TransportClosed);
            Assert.Equal(16, bits.Count);
            Calls.Enqueue(bits.Any(bit => bit) ? "on" : "off");
            return Task.CompletedTask;
        }
        public async Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct)
        {
            Calls.Enqueue("read");
            using var registration = ct.Register(() => TransportClosed = true);
            ReadEntered.TrySetResult();
            await FinishRead.Task.WaitAsync(ct);
            return new bool[count];
        }
        public ValueTask DisposeAsync() { Calls.Enqueue("close"); TransportClosed = true; return ValueTask.CompletedTask; }
    }
}
