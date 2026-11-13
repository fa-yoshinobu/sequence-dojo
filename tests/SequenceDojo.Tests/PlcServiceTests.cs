using System.Collections.Concurrent;
using System.IO;
using SequenceDojo.Plc;

namespace SequenceDojo.Tests;

public class PlcServiceTests
{
    [Fact]
    public async Task InputWritesOccurOnlyWhenTheSixteenBitsChange()
    {
        var link = new TestLink();
        await using var service = new PlcService((_, _) => Task.FromResult<IPlcLink>(link));
        await service.ConnectAsync(new PlcConfig(IntervalMs: 10));
        await WaitUntil(() => link.ReadCount >= 3);
        Assert.Single(link.Writes);
        Assert.Equal(new bool[16], link.Writes.Single());

        var input = new bool[16];
        input[3] = true;
        service.SetInputs(input);
        await WaitUntil(() => link.Writes.Count >= 2);
        int reads = link.ReadCount;
        await WaitUntil(() => link.ReadCount >= reads + 3);
        Assert.Equal(2, link.Writes.Count);
        Assert.Equal(input, link.Writes.Last());
        Assert.All(link.Writes, write => Assert.Equal(PlcService.InputCount, write.Length));
    }

    [Fact]
    public async Task ACommunicationErrorIsPublishedAndPollingRecovers()
    {
        var failedLink = new TestLink { ReadFailures = 1, OutputOn = 4 };
        var recoveredLink = new TestLink { OutputOn = 4 };
        int opens = 0;
        var error = new TaskCompletionSource<PlcState>(TaskCreationOptions.RunContinuationsAsynchronously);
        var recovered = new TaskCompletionSource<PlcState>(TaskCreationOptions.RunContinuationsAsynchronously);
        await using var service = new PlcService((_, _) => Task.FromResult<IPlcLink>(
            Interlocked.Increment(ref opens) == 1 ? failedLink : recoveredLink));
        service.StateChanged += state =>
        {
            if (state.Error != null) error.TrySetResult(state);
            else if (state.Outputs[4]) recovered.TrySetResult(state);
        };
        await service.ConnectAsync(new PlcConfig(IntervalMs: 10));
        Assert.Contains("test read failure", (await error.Task.WaitAsync(TimeSpan.FromSeconds(5))).Error);
        var final = await recovered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(final.Connected);
        Assert.Null(final.Error);
        Assert.True(final.Outputs[4]);
        Assert.True(opens >= 1);
        Assert.True(failedLink.Writes.Count + recoveredLink.Writes.Count >= 2);
    }

    private static async Task WaitUntil(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!condition()) await Task.Delay(5, timeout.Token);
    }

    private sealed class TestLink : IPlcLink
    {
        private int _reads;
        public string Endpoint => "test";
        public int ReadCount => Volatile.Read(ref _reads);
        public int ReadFailures;
        public int OutputOn { get; init; } = -1;
        public ConcurrentQueue<bool[]> Writes { get; } = new();
        public Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Writes.Enqueue(bits.ToArray());
            return Task.CompletedTask;
        }
        public Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct)
        {
            ct.ThrowIfCancellationRequested();
            Interlocked.Increment(ref _reads);
            if (Interlocked.Decrement(ref ReadFailures) >= 0) throw new IOException("test read failure");
            var output = new bool[count];
            if (OutputOn >= 0) output[OutputOn] = true;
            return Task.FromResult(output);
        }
        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
