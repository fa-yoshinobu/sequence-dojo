using System.Collections.Concurrent;
using SequenceDojo.Plc;

namespace SequenceDojo.Tests;

public class PlcSafetyTests
{
    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    [InlineData(true, true)]
    public async Task ShutdownWritesSixteenOffBeforeCloseEvenIfThatWriteFails(bool dispose, bool failOff)
    {
        var link = new Link { FailOff = failOff };
        var service = new PlcService((_, _) => Task.FromResult<IPlcLink>(link));
        try
        {
            service.SetSocketCount(1);
            service.SetInputs(On());
            await service.ConnectAsync(Config());
            await Until(() => link.Writes.Any(bits => bits[0]));
            if (dispose) await service.DisposeAsync();
            else await service.DisconnectAsync();
            Assert.True(link.Closed);
            Assert.False(service.Snapshot().Connected);
            Assert.Equal(1, link.Writes.Count(bits => bits.All(bit => !bit)));
            Assert.All(link.Writes, bits => Assert.Equal(16, bits.Length));
            Assert.Equal(new[] { "off", "close" }, link.Calls.TakeLast(2));
            Assert.False(link.FinalOffTokenCancelled);
            if (failOff) Assert.Contains("入力OFF書込み失敗", service.Snapshot().Error);
        }
        finally { await service.DisposeAsync(); }
    }

    [Fact]
    public async Task ConnectAndDisconnectOperationsCannotOverlapOrLeaveAnOldLinkAlive()
    {
        var entered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var first = new Link();
        var second = new Link();
        int opened = 0;
        await using var service = new PlcService(async (_, ct) =>
        {
            if (Interlocked.Increment(ref opened) == 1)
            {
                entered.SetResult();
                await release.Task.WaitAsync(ct);
                return first;
            }
            Assert.True(first.Closed);
            return second;
        });
        service.SetSocketCount(1);
        service.SetInputs(On());
        Task connectFirst = service.ConnectAsync(Config());
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Task connectSecond = service.ConnectAsync(Config());
        Task disconnect = service.DisconnectAsync();
        Assert.Equal(1, Volatile.Read(ref opened));
        release.SetResult();
        await Task.WhenAll(connectFirst, connectSecond, disconnect).WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(2, opened);
        Assert.True(first.Closed);
        Assert.True(second.Closed);
        Assert.False(service.Snapshot().Connected);
    }

    [Theory]
    [InlineData("melsec")]
    [InlineData("keyence")]
    [InlineData("modbus")]
    public async Task CommunicationFailureReopensTheSelectedProtocolAndResendsCurrentInputs(string protocol)
    {
        var failed = new Link { FailReads = true };
        var healthy = new Link();
        var protocols = new ConcurrentQueue<string>();
        int opened = 0;
        await using var service = new PlcService((config, _) =>
        {
            protocols.Enqueue(config.Protocol);
            return Task.FromResult<IPlcLink>(Interlocked.Increment(ref opened) == 1 ? failed : healthy);
        });
        service.SetSocketCount(1);
        service.SetInputs(On());
        await service.ConnectAsync(Config() with { Protocol = protocol });
        await Until(() => healthy.ReadCount > 0 && service.Snapshot().Error == null);
        Assert.True(failed.Closed);
        Assert.Equal(new[] { protocol, protocol }, protocols);
        Assert.True(service.Snapshot().Connected);
        Assert.Contains(healthy.Writes, bits => bits.SequenceEqual(On()));
    }

    [Fact]
    public async Task OnlyTheLastSocketLossClearsInputsAfterTwoSecondsAndFreshInputsRestoreThem()
    {
        var clock = new Clock();
        var link = new Link();
        await using var service = new PlcService((_, _) => Task.FromResult<IPlcLink>(link), clock);
        service.SetSocketCount(2);
        service.SetInputs(On());
        await service.ConnectAsync(Config());
        await Until(() => link.Writes.Count == 1);
        service.SetSocketCount(1);
        clock.Advance(3);
        int reads = link.ReadCount;
        await Until(() => link.ReadCount >= reads + 2);
        Assert.Single(link.Writes);
        service.SetSocketCount(0);
        clock.Advance(1.9);
        reads = link.ReadCount;
        await Until(() => link.ReadCount >= reads + 2);
        Assert.Single(link.Writes);
        clock.Advance(0.2);
        await Until(() => link.Writes.Count == 2);
        Assert.All(link.Writes.Last(), bit => Assert.False(bit));
        service.SetSocketCount(1);
        reads = link.ReadCount;
        await Until(() => link.ReadCount >= reads + 2);
        Assert.Equal(2, link.Writes.Count);
        service.SetInputs(On());
        await Until(() => link.Writes.Count == 3);
        Assert.True(link.Writes.Last()[0]);
        Assert.All(link.Writes, bits => Assert.Equal(16, bits.Length));
    }

    [Fact]
    public async Task ScanTimePublishesPeriodicallyEvenWhenEveryOutputStaysOff()
    {
        var clock = new Clock();
        var link = new Link();
        await using var service = new PlcService((_, _) => Task.FromResult<IPlcLink>(link), clock);
        service.SetSocketCount(1);
        var states = new ConcurrentQueue<PlcState>();
        service.StateChanged += states.Enqueue;
        await service.ConnectAsync(Config());
        await Until(() => link.ReadCount >= 2);
        int count = states.Count;
        clock.Advance(1.1);
        await Until(() => states.Count > count);
        Assert.True(states.Last().Connected);
        Assert.InRange(states.Last().ScanMs, 0, 1000);
        Assert.All(states.Last().Outputs, bit => Assert.False(bit));
        count = states.Count;
        clock.Advance(1.1);
        await Until(() => states.Count > count);
    }

    private static PlcConfig Config() => new(IntervalMs: 10, TimeoutMs: 100);
    private static bool[] On() => Enumerable.Range(0, 16).Select(index => index == 0).ToArray();
    private static async Task Until(Func<bool> condition)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!condition()) await Task.Delay(5, timeout.Token);
    }

    private sealed class Clock : TimeProvider
    {
        private long _timestamp;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => Interlocked.Read(ref _timestamp);
        public void Advance(double seconds) => Interlocked.Add(ref _timestamp, TimeSpan.FromSeconds(seconds).Ticks);
    }

    private sealed class Link : IPlcLink
    {
        public string Endpoint => "test";
        public bool FailOff { get; init; }
        public bool FailReads { get; init; }
        public volatile bool Closed;
        public bool FinalOffTokenCancelled { get; private set; }
        private int _readCount;
        public int ReadCount => Volatile.Read(ref _readCount);
        public ConcurrentQueue<bool[]> Writes { get; } = new();
        public ConcurrentQueue<string> Calls { get; } = new();
        public Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct)
        {
            Assert.False(Closed);
            bool[] snapshot = bits.ToArray();
            Writes.Enqueue(snapshot);
            bool off = snapshot.All(bit => !bit);
            Calls.Enqueue(off ? "off" : "on");
            if (off)
            {
                FinalOffTokenCancelled = ct.IsCancellationRequested;
                if (FailOff) throw new IOException("off write failed");
            }
            return Task.CompletedTask;
        }
        public Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct)
        {
            Assert.False(Closed);
            Interlocked.Increment(ref _readCount);
            if (FailReads) throw new IOException("broken connection");
            Calls.Enqueue("read");
            return Task.FromResult(new bool[count]);
        }
        public ValueTask DisposeAsync()
        {
            Calls.Enqueue("close");
            Closed = true;
            return ValueTask.CompletedTask;
        }
    }
}
