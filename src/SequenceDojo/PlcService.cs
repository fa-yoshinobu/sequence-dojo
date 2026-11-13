using System.Diagnostics;
using SequenceDojo.Plc;

namespace SequenceDojo;

public sealed record PlcState(bool Connected, string? Error, bool[] Outputs, double ScanMs, PlcConfig Config, string? Endpoint);

/// <summary>作業盤の入力を PLC に書き込み、PLC の出力を読み出す周期ループ。</summary>
public sealed class PlcService : IAsyncDisposable
{
    public const int InputCount = 16;
    public const int OutputCount = 16;
    private static readonly TimeSpan SocketGrace = TimeSpan.FromSeconds(2);

    private readonly object _lock = new();
    private readonly SemaphoreSlim _lifecycle = new(1, 1);
    private readonly SemaphoreSlim _wake = new(0, 1);
    private readonly Func<PlcConfig, CancellationToken, Task<IPlcLink>> _openLink;
    private readonly TimeProvider _timeProvider;
    private readonly DiagnosticLog _diagnostics;
    private readonly bool[] _inputs = new bool[InputCount];
    private readonly bool[] _outputs = new bool[OutputCount];
    private PlcConfig _config = new();
    private IPlcLink? _link;
    private CancellationTokenSource? _loopCts;
    private Task? _loop;
    private string? _error;
    private double _scanMs;
    private int _socketCount;
    private long _noSocketsSince;
    private bool _disposed;

    public PlcService() : this(PlcLinks.OpenAsync) { }

    internal PlcService(Func<PlcConfig, CancellationToken, Task<IPlcLink>> openLink, TimeProvider? timeProvider = null, DiagnosticLog? diagnostics = null)
    {
        _openLink = openLink;
        _timeProvider = timeProvider ?? TimeProvider.System;
        _diagnostics = diagnostics ?? DiagnosticLog.Shared;
        _noSocketsSince = _timeProvider.GetTimestamp();
    }

    public event Action<PlcState>? StateChanged;

    public PlcState Snapshot()
    {
        lock (_lock)
            return new PlcState(_link != null, _error, (bool[])_outputs.Clone(), _scanMs, _config, _link?.Endpoint);
    }

    public void SetInputs(bool[] bits)
    {
        if (bits.Length != InputCount) return;
        lock (_lock) Array.Copy(bits, _inputs, InputCount);
    }

    /// <summary>認証済み画面の接続数。イベントはここで発火せず、通信ループで反映する。</summary>
    public void SetSocketCount(int count)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(count);
        lock (_lock)
        {
            if (_socketCount == 0 && _timeProvider.GetElapsedTime(_noSocketsSince) >= SocketGrace)
                Array.Clear(_inputs);
            if (_socketCount > 0 && count == 0) _noSocketsSince = _timeProvider.GetTimestamp();
            bool boundaryChanged = (_socketCount == 0) != (count == 0);
            _socketCount = count;
            if (boundaryChanged && _wake.CurrentCount == 0) _wake.Release();
        }
    }

    public async Task ConnectAsync(PlcConfig config)
    {
        await _lifecycle.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            await DisconnectCoreAsync();
            lock (_lock) { _config = config; _error = null; }
            try
            {
                var effective = PlcLinks.Normalize(config);
                var link = await OpenAsync(effective, CancellationToken.None);
                lock (_lock) _link = link;
                _diagnostics.Write($"PLCへ接続しました: {link.Endpoint}");
                _loopCts = new CancellationTokenSource();
                var token = _loopCts.Token;
                _loop = Task.Run(() => RunLoopAsync(link, effective, token));
            }
            catch (Exception ex)
            {
                lock (_lock) _error = $"接続失敗: {Describe(ex)}";
                _diagnostics.Write($"PLC接続失敗: {config.Protocol} {config.Host}:{config.Port}", ex);
            }
            Publish();
        }
        finally { _lifecycle.Release(); }
    }

    public async Task DisconnectAsync()
    {
        await _lifecycle.WaitAsync();
        try { await DisconnectCoreAsync(); }
        finally { _lifecycle.Release(); }
    }

    private async Task DisconnectCoreAsync()
    {
        string? endpoint;
        lock (_lock) endpoint = _link?.Endpoint ?? (_loop != null ? $"{_config.Host}:{_config.Port}" : null);
        _loopCts?.Cancel();
        if (_loop != null)
        {
            try { await _loop; }
            catch (OperationCanceledException) when (_loopCts?.IsCancellationRequested == true) { }
            catch (Exception ex)
            {
                lock (_lock) _error = $"通信ループ終了: {Describe(ex)}";
                _diagnostics.Write($"PLC通信ループの終了に失敗: {endpoint}", ex);
            }
        }
        _loop = null;
        _loopCts?.Dispose();
        _loopCts = null;
        IPlcLink? link;
        lock (_lock) { link = _link; _link = null; Array.Clear(_outputs); }
        if (link != null) await CloseAsync(link, clearInputs: true);
        if (endpoint != null) _diagnostics.Write($"PLC通信を終了しました: {endpoint}");
        Publish();
    }

    private async Task<IPlcLink> OpenAsync(PlcConfig config, CancellationToken ct)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        return await _openLink(config, timeout.Token);
    }

    private async Task CloseAsync(IPlcLink link, bool clearInputs)
    {
        try
        {
            if (clearInputs)
            {
                // The polling token is cancelled; the final OFF write needs its own bounded token.
                using var timeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(PlcLinks.Normalize(_config).TimeoutMs));
                await link.WriteInputsAsync(new bool[InputCount], timeout.Token);
            }
        }
        catch (Exception ex)
        {
            lock (_lock) _error = $"入力OFF書込み失敗: {Describe(ex)}";
            _diagnostics.Write($"PLC入力OFF書込みに失敗: {link.Endpoint}", ex);
        }
        finally
        {
            try { await link.DisposeAsync(); }
            catch (Exception ex)
            {
                lock (_lock) _error = $"切断失敗: {Describe(ex)}";
                _diagnostics.Write($"PLC切断に失敗: {link.Endpoint}", ex);
            }
        }
    }

    private async Task RunLoopAsync(IPlcLink initialLink, PlcConfig config, CancellationToken ct)
    {
        IPlcLink? link = initialLink;
        bool[]? lastWritten = null;
        var sw = new Stopwatch();
        long lastPublished = _timeProvider.GetTimestamp();
        while (!ct.IsCancellationRequested)
        {
            sw.Restart();
            try
            {
                if (link == null)
                {
                    link = await OpenAsync(config, ct);
                    lock (_lock) _link = link;
                    _diagnostics.Write($"PLCへ再接続しました: {link.Endpoint}");
                }
                bool[] inputs;
                lock (_lock)
                {
                    if (_socketCount == 0 && _timeProvider.GetElapsedTime(_noSocketsSince) >= SocketGrace)
                        Array.Clear(_inputs);
                    inputs = (bool[])_inputs.Clone();
                }
                if (ct.IsCancellationRequested) break;
                if (lastWritten == null || !inputs.AsSpan().SequenceEqual(lastWritten))
                {
                    // Cancelling an in-flight protocol request may close its transport before the final OFF.
                    using var writeTimeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(config.TimeoutMs));
                    await link.WriteInputsAsync(inputs, writeTimeout.Token);
                    lastWritten = inputs;
                }
                if (ct.IsCancellationRequested) break;
                using var readTimeout = new CancellationTokenSource(TimeSpan.FromMilliseconds(config.TimeoutMs));
                var outputs = await link.ReadOutputsAsync(OutputCount, readTimeout.Token);
                bool changed;
                lock (_lock)
                {
                    int n = Math.Min(outputs.Length, OutputCount);
                    changed = !outputs.AsSpan(0, n).SequenceEqual(_outputs.AsSpan(0, n)) || _error != null;
                    Array.Copy(outputs, _outputs, n);
                    _error = null;
                    _scanMs = sw.Elapsed.TotalMilliseconds;
                }
                if (changed || _timeProvider.GetElapsedTime(lastPublished) >= TimeSpan.FromSeconds(1))
                {
                    Publish();
                    lastPublished = _timeProvider.GetTimestamp();
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                lock (_lock) { _error = $"通信エラー: {Describe(ex)}"; _link = null; }
                _diagnostics.Write($"PLC通信エラー: {link?.Endpoint ?? $"{config.Host}:{config.Port}"}", ex);
                if (link != null) await CloseAsync(link, clearInputs: true);
                link = null;
                lastWritten = null;
                Publish();
                try { await Task.Delay(1000, ct); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
                continue;
            }
            int wait = config.IntervalMs - (int)sw.ElapsedMilliseconds;
            lock (_lock)
            {
                if (_socketCount == 0)
                {
                    double remaining = (SocketGrace - _timeProvider.GetElapsedTime(_noSocketsSince)).TotalMilliseconds;
                    if (remaining > 0) wait = Math.Min(wait, (int)Math.Ceiling(remaining));
                }
            }
            if (wait > 0)
            {
                try { await _wake.WaitAsync(wait, ct); }
                catch (OperationCanceledException) when (ct.IsCancellationRequested) { break; }
            }
        }
    }

    private static string Describe(Exception ex)
    {
        if (ex is OperationCanceledException) return "応答がありません（タイムアウト）";
        var inner = ex.InnerException;
        return inner != null && inner.Message != ex.Message ? $"{ex.Message}（{inner.Message}）" : ex.Message;
    }

    private void Publish() => StateChanged?.Invoke(Snapshot());

    public async ValueTask DisposeAsync()
    {
        await _lifecycle.WaitAsync();
        try
        {
            if (_disposed) return;
            _disposed = true;
            await DisconnectCoreAsync();
        }
        finally { _lifecycle.Release(); }
    }
}
