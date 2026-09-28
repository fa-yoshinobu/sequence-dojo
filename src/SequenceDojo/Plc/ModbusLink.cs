using System.Text.RegularExpressions;
using AMWD.Protocols.Modbus.Common;
using AMWD.Protocols.Modbus.Tcp;

namespace SequenceDojo.Plc;

/// <summary>
/// Modbus TCP。アドレスは 0 起点で、領域は C（コイル）/ DI（入力ステータス）/ HR（保持レジスタ）/ IR（入力レジスタ）。
/// 入力の書込先: C（16 コイル）または HR（1 レジスタの 16 ビット）。
/// 出力の読出元: C / DI（16 点）または HR / IR（1 レジスタの 16 ビット）。
/// </summary>
public sealed partial class ModbusLink : IPlcLink
{
    private readonly ModbusTcpClient _client;
    private readonly byte _unit;
    private readonly (string Area, ushort Number) _in, _out;

    private ModbusLink(ModbusTcpClient client, byte unit, (string, ushort) input, (string, ushort) output, string endpoint)
    {
        _client = client;
        _unit = unit;
        _in = input;
        _out = output;
        Endpoint = endpoint;
    }

    public string Endpoint { get; }

    [GeneratedRegex(@"^(C|DI|HR|IR)([0-9]+)$")]
    private static partial Regex AddressPattern();

    private static (string Area, ushort Number) Parse(string address, bool forWrite)
    {
        var m = AddressPattern().Match(address);
        if (!m.Success || !ushort.TryParse(m.Groups[2].Value, out var number))
            throw new ArgumentException($"Modbus のアドレスは C・DI・HR・IR に 0〜65535 の番号を付けて指定してください（例: C0、HR100）: {address}");
        var area = m.Groups[1].Value;
        if (forWrite && area is "DI" or "IR")
            throw new ArgumentException($"{area} は読出し専用です。入力先頭には C または HR を指定してください: {address}");
        if (area is "C" or "DI" && number > ushort.MaxValue - 15)
            throw new ArgumentException($"16 点がアドレス範囲を超えます: {address}");
        return (area, number);
    }

    public static Task<IPlcLink> OpenAsync(PlcConfig c, CancellationToken ct)
    {
        if (c.UnitId is < 0 or > 255) throw new ArgumentException("Unit ID は 0〜255 で指定してください。");
        var input = Parse(c.InputStart, forWrite: true);
        var output = Parse(c.OutputStart, forWrite: false);
        var timeout = TimeSpan.FromMilliseconds(c.TimeoutMs);
        var client = new ModbusTcpClient(c.Host, c.Port)
        {
            ConnectTimeout = timeout,
            ReadTimeout = timeout,
            WriteTimeout = timeout,
            IdleTimeout = Timeout.InfiniteTimeSpan,
        };
        IPlcLink link = new ModbusLink(client, (byte)c.UnitId, input, output, $"Modbus TCP {c.Host}:{c.Port}（Unit ID {c.UnitId}）");
        return Task.FromResult(link);
    }

    public async Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct)
    {
        if (_in.Area == "C")
        {
            var coils = bits.Select((b, i) => new Coil { Address = (ushort)(_in.Number + i), Value = b }).ToList();
            await _client.WriteMultipleCoilsAsync(_unit, coils, ct);
        }
        else
        {
            ushort word = 0;
            for (int i = 0; i < Math.Min(16, bits.Count); i++) if (bits[i]) word |= (ushort)(1 << i);
            await _client.WriteSingleHoldingRegisterAsync(_unit, new HoldingRegister { Address = _in.Number, Value = word }, ct);
        }
    }

    public async Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct)
    {
        count = Math.Min(count, 16);
        switch (_out.Area)
        {
            case "C":
                return (await _client.ReadCoilsAsync(_unit, _out.Number, (ushort)count, ct)).Select(v => v.Value).ToArray();
            case "DI":
                return (await _client.ReadDiscreteInputsAsync(_unit, _out.Number, (ushort)count, ct)).Select(v => v.Value).ToArray();
            default:
                ushort word = _out.Area == "HR"
                    ? (await _client.ReadHoldingRegistersAsync(_unit, _out.Number, 1, ct))[0].Value
                    : (await _client.ReadInputRegistersAsync(_unit, _out.Number, 1, ct))[0].Value;
                return Enumerable.Range(0, count).Select(i => (word & (1 << i)) != 0).ToArray();
        }
    }

    public ValueTask DisposeAsync()
    {
        _client.Dispose();
        return ValueTask.CompletedTask;
    }
}
