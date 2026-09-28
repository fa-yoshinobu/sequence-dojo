using System.Diagnostics;
using SequenceDojo.Plc;

namespace SequenceDojo;

public sealed record PlcState(bool Connected, string? Error, bool[] Outputs, double ScanMs, PlcConfig Config, string? Endpoint);

/// <summary>作業盤の入力を PLC に書き込み、PLC の出力を読み出す周期ループ。通信方式は <see cref="IPlcLink"/> で切り替える。</summary>
public sealed class PlcService : IAsyncDisposable
{
    public const int InputCount = 16;
    public const int OutputCount = 16; // 標準割付で使うのは 14 点

    private readonly object _lock = new();
    private readonly bool[] _inputs = new bool[InputCount];
    private readonly bool[] _outputs = new bool[OutputCount];
    private PlcConfig _config = new();
    private IPlcLink? _link;
    private CancellationTokenSource? _loopCts;
    private Task? _loop;
    private string? _error;
    private double _scanMs;

    public event Action<PlcState>? StateChanged;

    public PlcState Snapshot()
    {
        lock (_lock)
            return new PlcState(_link != null, _error, (bool[])_outputs.Clone(), _scanMs, _config, _link?.Endpoint);
    }

    public void SetInputs(bool[] bits)
    {
        lock (_lock)
            Array.Copy(bits, _inputs, Math.Min(bits.Length, InputCount));
    }

    public async Task ConnectAsync(PlcConfig config)
    {
        await DisconnectAsync();
        lock (_lock) { _config = config; _error = null; }
        try
        {
            var effective = PlcLinks.Normalize(config);
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            var link = await PlcLinks.OpenAsync(effective, cts.Token);
            lock (_lock) _link = link;
            _loopCts = new CancellationTokenSource();
            _loop = Task.Run(() => RunLoopAsync(link, effective.IntervalMs, _loopCts.Token));
        }
        catch (Exception ex)
        {
            lock (_lock) _error = $"接続失敗: {Describe(ex)}";
        }
        Publish();
    }

    public async Task DisconnectAsync()
    {
        _loopCts?.Cancel();
        if (_loop != null)
        {
            try { await _loop; } catch { /* ループ側で記録済み */ }
        }
        _loop = null;
        _loopCts = null;
        IPlcLink? link;
        lock (_lock) { link = _link; _link = null; Array.Clear(_outputs); }
        if (link != null)
        {
            try { await link.DisposeAsync(); } catch { }
        }
        Publish();
    }

    private async Task RunLoopAsync(IPlcLink link, int intervalMs, CancellationToken ct)
    {
        bool[]? lastWritten = null;
        var sw = new Stopwatch();
        while (!ct.IsCancellationRequested)
        {
            sw.Restart();
            try
            {
                bool[] inputs;
                lock (_lock) inputs = (bool[])_inputs.Clone();
                if (lastWritten == null || !inputs.AsSpan().SequenceEqual(lastWritten))
                {
                    await link.WriteInputsAsync(inputs, ct);
                    lastWritten = inputs;
                }
                var outputs = await link.ReadOutputsAsync(OutputCount, ct);
                bool changed;
                lock (_lock)
                {
                    int n = Math.Min(outputs.Length, OutputCount);
                    changed = !outputs.AsSpan(0, n).SequenceEqual(_outputs.AsSpan(0, n)) || _error != null;
                    Array.Copy(outputs, _outputs, n);
                    _error = null;
                    _scanMs = sw.Elapsed.TotalMilliseconds;
                }
                if (changed) Publish();
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                lock (_lock) _error = $"通信エラー: {Describe(ex)}";
                Publish();
                lastWritten = null;
                await Task.Delay(1000, ct).ContinueWith(_ => { });
            }
            var wait = intervalMs - (int)sw.ElapsedMilliseconds;
            if (wait > 0) await Task.Delay(wait, ct).ContinueWith(_ => { });
        }
    }

    // 例外の内側まで見て、原因がわかる文を返す
    private static string Describe(Exception ex)
    {
        if (ex is OperationCanceledException) return "応答がありません（タイムアウト）";
        var inner = ex.InnerException;
        return inner != null && inner.Message != ex.Message ? $"{ex.Message}（{inner.Message}）" : ex.Message;
    }

    private void Publish() => StateChanged?.Invoke(Snapshot());

    public async ValueTask DisposeAsync() => await DisconnectAsync();
}
