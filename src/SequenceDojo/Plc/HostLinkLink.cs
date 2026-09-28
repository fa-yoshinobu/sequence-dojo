using PlcComm.KvHostLink;

namespace SequenceDojo.Plc;

/// <summary>KEYENCE KV（上位リンク）。入力先頭・出力先頭から連続 16 点をビット単位で読み書きする。</summary>
public sealed class HostLinkLink : IPlcLink
{
    private readonly KvHostLinkClient _client;
    private readonly string _in, _out;

    private HostLinkLink(KvHostLinkClient client, string input, string output, string endpoint)
    {
        _client = client;
        _in = input;
        _out = output;
        Endpoint = endpoint;
    }

    public string Endpoint { get; }

    public static async Task<IPlcLink> OpenAsync(PlcConfig c, CancellationToken ct)
    {
        var transport = c.Transport.Equals("Udp", StringComparison.OrdinalIgnoreCase) ? HostLinkTransportMode.Udp : HostLinkTransportMode.Tcp;
        var options = new KvHostLinkConnectionOptions(c.Host, c.Port, transport, c.Profile, TimeSpan.FromMilliseconds(c.TimeoutMs));
        var client = await KvHostLinkClientFactory.OpenAndConnectAsync(options, ct);
        try
        {
            // 運転モードの読出しで上位リンクの応答を確認する（運転状態は変えない）
            await client.ConfirmOperatingModeAsync(ct);
        }
        catch
        {
            await client.DisposeAsync();
            throw;
        }
        var name = DisplayName(c.Profile);
        var endpoint = c.Simulator
            ? $"KV STUDIO シミュレータ（{c.Host}:{c.Port}・{name}）"
            : $"上位リンク {c.Host}:{c.Port}/{transport.ToString().ToUpperInvariant()}（{name}）";
        return new HostLinkLink(client, c.InputStart, c.OutputStart, endpoint);
    }

    public Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct) =>
        _client.WriteBitsSingleRequestAsync(_in, bits, ct);

    public async Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct) =>
        (await _client.ReadBitsSingleRequestAsync(_out, count, ct)).ToArray();

    public ValueTask DisposeAsync() => _client.DisposeAsync();

    public static IReadOnlyList<ProfileItem> Profiles() =>
        KvHostLinkPlcProfiles.GetProfileDescriptors().Where(d => d.Connectable)
            .Select(d => new ProfileItem(d.CanonicalName, d.DisplayName)).ToList();

    public static string DisplayName(string canonical) =>
        KvHostLinkPlcProfiles.GetProfileDescriptors().FirstOrDefault(d => d.CanonicalName == canonical)?.DisplayName ?? canonical;
}
