namespace SequenceDojo.Plc;

/// <summary>
/// 通信先 PLC との接続。作業盤の入力 16 点を書き込み、出力を読み出すだけの最小限の窓口。
/// 実装: MELSEC（SLMP）/ KEYENCE（上位リンク）/ Modbus TCP
/// </summary>
public interface IPlcLink : IAsyncDisposable
{
    /// <summary>画面に表示する接続先の説明（例: SLMP 192.168.3.250:5000/TCP（iQ-F））</summary>
    string Endpoint { get; }

    Task WriteInputsAsync(IReadOnlyList<bool> bits, CancellationToken ct);

    Task<bool[]> ReadOutputsAsync(int count, CancellationToken ct);
}

/// <summary>接続設定（画面から JSON で受け取る）。入力は入力先頭から 16 点、出力は出力先頭から 16 点。</summary>
public sealed record PlcConfig(
    string Protocol = "melsec",          // melsec / keyence / modbus
    string Profile = "melsec:iq-f",      // ライブラリの正規名（melsec:iq-f、keyence:kv-8000 など）。modbus では未使用
    string Host = "192.168.3.250",
    int Port = 5000,
    string Transport = "Tcp",            // Tcp / Udp（modbus は Tcp 固定）
    string InputStart = "X0",
    string OutputStart = "Y0",
    int IntervalMs = 30,
    int UnitId = 1,                      // Modbus の Unit ID
    bool Simulator = false,              // GX Simulator 3 / KV STUDIO シミュレータに接続
    int TimeoutMs = 1000);

public static class PlcLinks
{
    public const string GxSimulatorHost = "127.0.0.1";
    public const int GxSimulatorPort = 5511;
    public const string KvSimulatorHost = "127.0.0.1";
    public const int KvSimulatorPort = 8501;

    /// <summary>GX Simulator 3 が SLMP で応答する機種</summary>
    public static bool SupportsGxSimulator(string profile) => profile is "melsec:iq-r" or "melsec:iq-l";

    /// <summary>KV STUDIO シミュレータが上位リンクで応答する機種</summary>
    public static bool SupportsKvSimulator(string profile) =>
        profile is "keyence:kv-8000" or "keyence:kv-8000-xym" or "keyence:kv-x500" or "keyence:kv-x500-xym";

    /// <summary>旧形式の機種名（IqF など）やシミュレータ指定を解決した、実際に接続する設定</summary>
    public static PlcConfig Normalize(PlcConfig c)
    {
        var protocol = (c.Protocol ?? "melsec").Trim().ToLowerInvariant();
        var profile = protocol == "melsec" ? LegacyProfile(c.Profile) : c.Profile?.Trim() ?? "";
        c = c with
        {
            Protocol = protocol,
            Profile = profile,
            Host = c.Host?.Trim() ?? "",
            InputStart = c.InputStart?.Trim().ToUpperInvariant() ?? "",
            OutputStart = c.OutputStart?.Trim().ToUpperInvariant() ?? "",
            IntervalMs = Math.Clamp(c.IntervalMs, 10, 5000),
            TimeoutMs = Math.Clamp(c.TimeoutMs, 100, 10000),
        };
        if (!c.Simulator) return c;
        if (protocol == "melsec" && SupportsGxSimulator(profile))
            return c with { Host = GxSimulatorHost, Port = GxSimulatorPort, Transport = "Tcp" };
        if (protocol == "keyence" && SupportsKvSimulator(profile))
            return c with { Host = KvSimulatorHost, Port = KvSimulatorPort, Transport = "Tcp" };
        return c with { Simulator = false };
    }

    // 以前の保存形式（SlmpPlcProfile の列挙名）を正規名へ
    private static string LegacyProfile(string? p) => (p ?? "").Trim() switch
    {
        "IqF" => "melsec:iq-f",
        "IqR" => "melsec:iq-r",
        "IqL" => "melsec:iq-l",
        "QnU" => "melsec:qnu",
        "QnUDV" => "melsec:qnudv",
        "LCpu" => "melsec:lcpu",
        "" => "melsec:iq-f",
        var s => s,
    };

    public static async Task<IPlcLink> OpenAsync(PlcConfig config, CancellationToken ct)
    {
        var c = Normalize(config);
        IPlcLink link = c.Protocol switch
        {
            "melsec" => await SlmpLink.OpenAsync(c, ct),
            "keyence" => await HostLinkLink.OpenAsync(c, ct),
            "modbus" => await ModbusLink.OpenAsync(c, ct),
            _ => throw new ArgumentException($"未対応の通信方式です: {c.Protocol}"),
        };
        try
        {
            // 応答を 1 回確認してから接続済みにする（UDP やソケットだけの接続で成功扱いにしない）
            await link.ReadOutputsAsync(16, ct);
            return link;
        }
        catch
        {
            await link.DisposeAsync();
            throw;
        }
    }

    /// <summary>画面の機種選択肢</summary>
    public static object Catalog() => new
    {
        melsec = SlmpLink.Profiles(),
        keyence = HostLinkLink.Profiles(),
        gxSimulator = SlmpLink.Profiles().Select(p => p.Name).Where(SupportsGxSimulator),
        kvSimulator = HostLinkLink.Profiles().Select(p => p.Name).Where(SupportsKvSimulator),
    };
}

public sealed record ProfileItem(string Name, string DisplayName);
