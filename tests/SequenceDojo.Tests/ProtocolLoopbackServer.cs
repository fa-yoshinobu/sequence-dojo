using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Text;

namespace SequenceDojo.Tests;

// Only the binary SLMP bit, KV bit and Modbus coil requests used by the real wrappers.
internal sealed class ProtocolLoopbackServer : IAsyncDisposable
{
    private readonly string _protocol;
    private TcpListener? _listener;
    private CancellationTokenSource? _stop;
    private Task? _accept;
    private readonly ConcurrentBag<TcpClient> _clients = [];
    private readonly ConcurrentBag<Task> _sessions = [];
    internal readonly ConcurrentQueue<(int Start, bool[] Bits)> Writes = new();
    internal readonly ConcurrentQueue<string> Requests = new();
    internal readonly ConcurrentQueue<Exception> Failures = new();
    internal int Port { get; private set; }
    internal int Connections;
    internal volatile Task? OutputReadGate;
    internal readonly TaskCompletionSource OutputReadEntered = new(TaskCreationOptions.RunContinuationsAsynchronously);
    internal int OutputWord = 1 << 3;

    internal ProtocolLoopbackServer(string protocol) { _protocol = protocol; Start(); }
    internal void Start()
    {
        _stop = new(); _listener = new(IPAddress.Loopback, Port); _listener.Start();
        Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
        _accept = AcceptAsync(_stop.Token);
    }
    private async Task AcceptAsync(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                var client = await _listener!.AcceptTcpClientAsync(ct);
                Interlocked.Increment(ref Connections); _clients.Add(client);
                _sessions.Add(ServeAsync(client, ct));
            }
        }
        catch (Exception error) when (ct.IsCancellationRequested && error is OperationCanceledException or SocketException or ObjectDisposedException) { }
    }
    private async Task ServeAsync(TcpClient client, CancellationToken ct)
    {
        try
        {
            using var stream = client.GetStream();
            while (!ct.IsCancellationRequested)
            {
                if (_protocol == "keyence") await HostLinkAsync(stream, ct);
                else if (_protocol == "melsec") await SlmpAsync(stream, ct);
                else await ModbusAsync(stream, ct);
            }
        }
        catch (Exception error) when (error is not InvalidDataException && error is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
        catch (Exception error) { Failures.Enqueue(error); }
        finally { client.Dispose(); }
    }
    private static async Task<byte[]> ReadAsync(NetworkStream stream, int size, CancellationToken ct)
    {
        var bytes = new byte[size]; await stream.ReadExactlyAsync(bytes, ct); return bytes;
    }
    private async Task SlmpAsync(NetworkStream stream, CancellationToken ct)
    {
        byte[] sub = await ReadAsync(stream, 2, ct);
        bool four = sub[0] == 0x54;
        if (sub[0] is not (0x50 or 0x54)) throw new InvalidDataException("Unexpected SLMP frame");
        byte[] head = await ReadAsync(stream, four ? 11 : 7, ct);
        byte[] body = await ReadAsync(stream, BinaryPrimitives.ReadUInt16LittleEndian(head.AsSpan(four ? 9 : 5)), ct);
        ushort command = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(2));
        ushort subcommand = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(4));
        if (subcommand != 1) throw new InvalidDataException($"Unexpected SLMP subcommand {subcommand:X}");
        int start = body[6] | body[7] << 8 | body[8] << 16, count = BinaryPrimitives.ReadUInt16LittleEndian(body.AsSpan(10));
        if (body[9] != 0x90 || count != 16) throw new InvalidDataException("Expected M device and sixteen bits");
        Requests.Enqueue($"SLMP {command:X4} M{start} {count}");
        byte[] data;
        if (command == 0x1401)
        {
            bool[] bits = Enumerable.Range(0, count).Select(i => (body[12+i/2] & (i%2 == 0 ? 0x10 : 0x01)) != 0).ToArray();
            Writes.Enqueue((start,bits)); data = [];
        }
        else if (command == 0x0401)
        {
            data = new byte[(count+1)/2]; int word = Volatile.Read(ref OutputWord);
            for (int i=0;i<count;i++) if ((word & 1 << i) != 0) data[i/2] |= (byte)(i%2 == 0 ? 0x10 : 1);
        }
        else throw new InvalidDataException($"Unexpected SLMP command {command:X4}");
        var response = new List<byte>();
        if (four) response.AddRange([0xD4,0,head[0],head[1],0,0]); else response.AddRange([0xD0,0]);
        response.AddRange(head.AsSpan(four ? 4 : 0,5).ToArray());
        response.Add((byte)(2+data.Length)); response.Add(0); response.AddRange([0,0]); response.AddRange(data);
        await stream.WriteAsync(response.ToArray(), ct);
    }
    private async Task HostLinkAsync(NetworkStream stream, CancellationToken ct)
    {
        var command = new StringBuilder();
        while (true)
        {
            byte value = (await ReadAsync(stream,1,ct))[0];
            if (value == '\r') break;
            if (value != '\n') command.Append((char)value);
            if (command.Length > 2048) throw new InvalidDataException("Oversized HostLink command");
        }
        string text = command.ToString(), response; Requests.Enqueue(text);
        if (text == "?M") response = "1";
        else
        {
            string[] parts = text.Split(' ',StringSplitOptions.RemoveEmptyEntries);
            int start = int.Parse(parts[1][2..].Split('.')[0]);
            start = start/100*16+start%100;
            int count = int.Parse(parts[2]);
            if (!parts[1].StartsWith("MR",StringComparison.Ordinal) || count != 16) throw new InvalidDataException("Expected sixteen MR bits");
            if (parts[0] == "WRS") { Writes.Enqueue((start,parts.Skip(3).Select(v => v == "1").ToArray())); response = "OK"; }
            else if (parts[0] == "RDS")
            {
                if (OutputReadGate is { } gate)
                {
                    OutputReadEntered.TrySetResult();
                    await gate.WaitAsync(ct);
                }
                response = string.Join(' ',Enumerable.Range(0,count).Select(i => (Volatile.Read(ref OutputWord) & 1 << i) != 0 ? "1" : "0"));
            }
            else throw new InvalidDataException($"Unexpected HostLink command {text}");
        }
        await stream.WriteAsync(Encoding.ASCII.GetBytes(response+"\r\n"),ct);
    }
    private async Task ModbusAsync(NetworkStream stream, CancellationToken ct)
    {
        byte[] head = await ReadAsync(stream,7,ct);
        byte[] pdu = await ReadAsync(stream,BinaryPrimitives.ReadUInt16BigEndian(head.AsSpan(4))-1,ct);
        int start = BinaryPrimitives.ReadUInt16BigEndian(pdu.AsSpan(1)), count = BinaryPrimitives.ReadUInt16BigEndian(pdu.AsSpan(3));
        if (head[6] != 1 || count != 16) throw new InvalidDataException("Expected unit one and sixteen coils");
        Requests.Enqueue($"Modbus {pdu[0]} C{start} {count}");
        byte[] response;
        if (pdu[0] == 15)
        {
            Writes.Enqueue((start,Enumerable.Range(0,count).Select(i => (pdu[6+i/8] & 1 << i%8) != 0).ToArray()));
            response = pdu[..5];
        }
        else if (pdu[0] == 1) { int word = Volatile.Read(ref OutputWord); response = [1,2,(byte)word,(byte)(word >> 8)]; }
        else throw new InvalidDataException($"Unexpected Modbus function {pdu[0]}");
        BinaryPrimitives.WriteUInt16BigEndian(head.AsSpan(4),(ushort)(response.Length+1));
        await stream.WriteAsync(head.Concat(response).ToArray(),ct);
    }
    internal async Task StopAsync()
    {
        if (_stop == null) return;
        await _stop.CancelAsync(); _listener!.Stop();
        while (_clients.TryTake(out var client)) client.Dispose();
        if (_accept != null) await _accept;
        while (_sessions.TryTake(out var session)) await session;
        _stop.Dispose(); _stop = null;
    }
    public async ValueTask DisposeAsync() => await StopAsync();
}
