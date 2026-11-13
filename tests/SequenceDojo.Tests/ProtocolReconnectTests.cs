using System.Collections.Concurrent;
using System.Diagnostics;
using SequenceDojo.Plc;

namespace SequenceDojo.Tests;

public sealed class ProtocolReconnectTests
{
    private static PlcConfig Config(string protocol, int port) => protocol switch
    {
        "melsec" => new(Protocol:protocol,Profile:"melsec:iq-f",Host:"127.0.0.1",Port:port,InputStart:"M100",OutputStart:"M300",IntervalMs:20,TimeoutMs:200),
        "keyence" => new(Protocol:protocol,Profile:"keyence:kv-8000",Host:"127.0.0.1",Port:port,InputStart:"MR000",OutputStart:"MR100",IntervalMs:20,TimeoutMs:200),
        _ => new(Protocol:protocol,Host:"127.0.0.1",Port:port,InputStart:"C0",OutputStart:"C16",IntervalMs:20,TimeoutMs:200)
    };
    private static bool[] Pressed() { var bits = new bool[16]; bits[0] = bits[5] = bits[15] = true; return bits; }
    private static async Task UntilAsync(Func<bool> condition, Func<string> context)
    {
        var elapsed = Stopwatch.StartNew();
        while (!condition() && elapsed.Elapsed < TimeSpan.FromSeconds(10)) await Task.Delay(10);
        Assert.True(condition(),context());
    }
    private static void AssertWrapper(IPlcLink link, string protocol)
    {
        if (protocol == "melsec") Assert.IsType<SlmpLink>(link);
        else if (protocol == "keyence") Assert.IsType<HostLinkLink>(link);
        else Assert.IsType<ModbusLink>(link);
    }
    [Theory]
    [InlineData("melsec")]
    [InlineData("keyence")]
    [InlineData("modbus")]
    public async Task DisconnectWritesTheSameSixteenInputsOffOverTheRealProtocol(string protocol)
    {
        await using var server = new ProtocolLoopbackServer(protocol);
        await using var service = new PlcService(); service.SetSocketCount(1);
        await service.ConnectAsync(Config(protocol,server.Port));
        string Context() => $"{service.Snapshot()} / {string.Join("; ",server.Requests)} / {string.Join("; ",server.Failures)}";
        Assert.True(service.Snapshot().Connected,Context());
        service.SetInputs(Pressed());
        await UntilAsync(() => server.Writes.Any(w => w.Bits.SequenceEqual(Pressed())),Context);
        await service.DisconnectAsync();
        Assert.False(service.Snapshot().Connected);
        Assert.Null(service.Snapshot().Error);
        var writes = server.Writes.ToArray();
        Assert.Equal(protocol == "melsec" ? 100 : 0,writes[^1].Start);
        Assert.Equal(new bool[16],writes[^1].Bits);
        Assert.All(writes,w => { Assert.Equal(writes[^1].Start,w.Start); Assert.Equal(16,w.Bits.Length); });
        Assert.Empty(server.Failures);
    }
    [Fact]
    public async Task KeyenceDisconnectCompletesAnInFlightReadBeforeWritingFinalOff()
    {
        await using var server = new ProtocolLoopbackServer("keyence");
        await using var service = new PlcService(); service.SetSocketCount(1);
        await service.ConnectAsync(Config("keyence",server.Port) with { TimeoutMs = 2000 });
        string Context() => $"{service.Snapshot()} / {string.Join("; ",server.Requests)} / {string.Join("; ",server.Failures)}";
        Assert.True(service.Snapshot().Connected,Context());
        service.SetInputs(Pressed());
        await UntilAsync(() => server.Writes.Any(w => w.Bits.SequenceEqual(Pressed())),Context);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        server.OutputReadGate = release.Task;
        try
        {
            await server.OutputReadEntered.Task.WaitAsync(TimeSpan.FromSeconds(5));
            var disconnect = service.DisconnectAsync();
            // Keep the real SDK read pending while shutdown is requested, then let it finish normally.
            await Task.WhenAny(disconnect,Task.Delay(30));
            release.TrySetResult();
            await disconnect.WaitAsync(TimeSpan.FromSeconds(5));
            Assert.Null(service.Snapshot().Error);
            Assert.Equal(new bool[16],server.Writes.Last().Bits);
            Assert.Equal(0,server.Writes.Last().Start);
            Assert.Empty(server.Failures);
        }
        finally { release.TrySetResult(); }
    }

    [Theory]
    [InlineData("melsec")]
    [InlineData("keyence")]
    [InlineData("modbus")]
    public async Task ServerRestartRecreatesTheRealWrapperAndRestoresPollingAndInputs(string protocol)
    {
        await using var server = new ProtocolLoopbackServer(protocol);
        var links = new ConcurrentQueue<IPlcLink>();
        await using var service = new PlcService(async (config,ct) => {
            var link = await PlcLinks.OpenAsync(config,ct); links.Enqueue(link); return link;
        });
        service.SetSocketCount(1);
        await service.ConnectAsync(Config(protocol,server.Port));
        string Context() => $"{service.Snapshot()} / opens={links.Count} / {string.Join("; ",server.Requests)} / {string.Join("; ",server.Failures)}";
        Assert.True(service.Snapshot().Connected,Context());
        service.SetInputs(Pressed());
        await UntilAsync(() => server.Writes.Any(w => w.Bits.SequenceEqual(Pressed())) && service.Snapshot().Outputs[3],Context);
        await server.StopAsync();
        await UntilAsync(() => !service.Snapshot().Connected && service.Snapshot().Error != null,Context);
        int before = server.Writes.Count;
        Volatile.Write(ref server.OutputWord,1 << 9); server.Start();
        await UntilAsync(() => links.Count >= 2 && service.Snapshot() is { Connected:true,Error:null } snapshot && snapshot.Outputs[9]
            && server.Writes.Count > before && server.Writes.Last().Bits.SequenceEqual(Pressed()),Context);
        var created = links.ToArray(); Assert.NotSame(created[0],created[^1]);
        Assert.All(created,link => AssertWrapper(link,protocol));
        Assert.True(server.Connections >= 2);
        Assert.False(service.Snapshot().Outputs[3]);
        await service.DisconnectAsync();
        Assert.Equal(new bool[16],server.Writes.Last().Bits);
        Assert.Empty(server.Failures);
    }
}
