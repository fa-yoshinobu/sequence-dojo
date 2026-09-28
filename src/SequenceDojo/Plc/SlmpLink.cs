using PlcComm.Slmp;

namespace SequenceDojo.Plc;

/// <summary>三菱 MELSEC（SLMP）。入力先頭・出力先頭から連続 16 点をビット単位で読み書きする。</summary>
public sealed class SlmpLink : IPlcLink
{
    private readonly SlmpClient _client;
    private readonly SlmpDeviceAddress _in, _out;

    private SlmpLink(SlmpClient client, SlmpDeviceAddress input, SlmpDeviceAddress output, string endpoint)
    {
        _client = client;
        _in = input;
        _out = output;
        Endpoint = endpoint;
    }

    public string Endpoint { get; }

    public static async Task<IPlcLink> OpenAsync(PlcConfig c, CancellationToken ct)
    {
        var profile = SlmpPlcProfiles.Parse(c.Profile);
        var input = SlmpAddress.Parse(c.InputStart, profile);
        var output = SlmpAddress.Parse(c.OutputStart, profile);
        var transport = c.Transport.Equals("Udp", StringComparison.OrdinalIgnoreCase) ? SlmpTransportMode.Udp : SlmpTransportMode.Tcp;
        var options = new SlmpConnectionOptions(c.Host, profile, c.Port, transport, SlmpTargetAddress.OwnStation)
        {
            Timeout = TimeSpan.FromMilliseconds(c.TimeoutMs),
        };
        var client = await SlmpClientFactory.OpenAndConnectAsync(options, ct);
        var name = DisplayName(c.Profile);
        var endpoint = c.Simulator
            ? $"GX Simulator 3（{c.Host}:{c.Port}・{name}）"
            : $"SLMP {c.Host}:{c.Port}/{transport.ToString().ToUpperInvariant()}（{name}）";
        return new SlmpLink(client, input, output, endpoint);
    }

    public Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct) =>
        _client.WriteBitsSingleRequestAsync(_in, bits, ct);

    public async Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct) =>
        (await _client.ReadBitsSingleRequestAsync(_out, count, ct)).ToArray();

    public ValueTask DisposeAsync() => _client.DisposeAsync();

    public static IReadOnlyList<ProfileItem> Profiles() =>
        SlmpPlcProfiles.GetProfileDescriptors().Where(d => d.Connectable)
            .Select(d => new ProfileItem(d.CanonicalName, d.DisplayName)).ToList();

    public static string DisplayName(string canonical) =>
        SlmpPlcProfiles.GetProfileDescriptors().FirstOrDefault(d => d.CanonicalName == canonical)?.DisplayName ?? canonical;
}
