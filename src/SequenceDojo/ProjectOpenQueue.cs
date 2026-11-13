namespace SequenceDojo;

/// <summary>起動中・読込み中の重複要求をまとめ、画面の準備完了後に順番に処理する。</summary>
internal sealed class ProjectOpenQueue
{
    private readonly object _gate = new();
    private readonly Queue<string> _paths = new();
    private readonly HashSet<string> _pending = new(StringComparer.OrdinalIgnoreCase);
    private bool _closed;
    public event Action? Available;

    public bool Enqueue(string path)
    {
        path = ProjectFiles.ValidatePath(path);
        lock (_gate)
        {
            if (_closed) return false;
            if (!_pending.Add(path)) return true;
            _paths.Enqueue(path);
        }
        Available?.Invoke();
        return true;
    }

    public bool TryTake(out string path)
    {
        lock (_gate) return _paths.TryDequeue(out path!);
    }

    public void Complete(string path) { lock (_gate) _pending.Remove(path); }
    public void Close()
    {
        lock (_gate) { _closed = true; _paths.Clear(); _pending.Clear(); }
    }
}
