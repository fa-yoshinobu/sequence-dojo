namespace SequenceDojo;

internal sealed record CoreProjectPayload(string RequestId, string Path, string Name, string Content)
{
    public string Type => "file-opened";
}

/// <summary>ブラウザの準備・再接続を待つ単一の読込み要求。画面側の完了通知まで保持する。</summary>
internal sealed class BrowserProjectOpens
{
    private readonly object _gate = new();
    private readonly HashSet<string> _readyClients = new(StringComparer.Ordinal);
    private CoreProjectPayload? _pending;
    private TaskCompletionSource? _completion;
    private string? _client;
    public event Action? Pending;

    public async Task OpenAsync(string path, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var payload = ProjectFiles.ReadPayload(path);
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_gate)
        {
            if (_pending != null) throw new InvalidOperationException("ファイルを読込み中です。");
            _pending = payload;
            _completion = completion;
        }
        try
        {
            Pending?.Invoke();
            await completion.Task.WaitAsync(ct);
        }
        finally
        {
            lock (_gate)
            {
                if (_pending?.RequestId == payload.RequestId)
                {
                    _pending = null;
                    _completion = null;
                    _client = null;
                }
            }
        }
    }

    public void Register(string client) { lock (_gate) _readyClients.Add(client); }

    public CoreProjectPayload? Claim(string client)
    {
        lock (_gate)
        {
            if (_pending == null || _client != null || !_readyClients.Contains(client)) return null;
            _client = client;
            return _pending;
        }
    }

    public bool Complete(string client, string requestId)
    {
        TaskCompletionSource? completion;
        lock (_gate)
        {
            if (_client != client || _pending?.RequestId != requestId) return false;
            completion = _completion;
            _pending = null;
            _completion = null;
            _client = null;
        }
        completion?.TrySetResult();
        return true;
    }

    public void Release(string client)
    {
        bool notify;
        lock (_gate)
        {
            _readyClients.Remove(client);
            notify = _client == client && _pending != null;
            if (notify) _client = null;
        }
        if (notify) Pending?.Invoke();
    }
}
