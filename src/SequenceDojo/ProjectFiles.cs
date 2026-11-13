using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;

namespace SequenceDojo;

/// <summary>
/// プロジェクトファイル（*.sdojo）の保存・読込。画面（JavaScript）とは WebView2 のメッセージでやり取りする。
/// 画面 → アプリ: ready / file-open / file-save（path が null なら保存先を選ばせる）
/// アプリ → 画面: file-opened / file-saved / file-error / save-request（閉じる前の保存）
/// </summary>
public sealed class ProjectFiles
{
    public const string Extension = ".sdojo";
    private const string Filter = "シーケンス道場ファイル (*.sdojo)|*.sdojo|すべてのファイル (*.*)|*.*";
    internal const long MaxBytes = 5 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly Form _owner;
    private readonly CoreWebView2 _core;
    private readonly NativePageAccess _pageAccess;
    private string? _pendingOpen;
    private string? _lastDir;
    private readonly Dictionary<string, TaskCompletionSource> _openCompletions = [];

    /// <summary>保存が済んだとき（閉じる前の保存の続きに使う）。引数は成功したか。</summary>
    public event Action<bool>? SaveCompleted;
    public event Action? Ready;
    public bool IsReady { get; private set; }

    public ProjectFiles(Form owner, CoreWebView2 core, string? startupFile, string expectedOrigin)
    {
        _owner = owner;
        _core = core;
        _pageAccess = new NativePageAccess(expectedOrigin);
        _pendingOpen = startupFile;
        core.WebMessageReceived += OnMessage;
        core.NavigationStarting += (_, e) =>
        {
            if (e.Cancel || !_pageAccess.Allows(e.Uri)) return;
            IsReady = false;
            foreach (var pending in _openCompletions.Values)
                pending.TrySetException(new IOException("画面の再読込みでファイル読込みを中断しました。"));
        };
    }

    /// <summary>画面に保存を頼む（閉じる前の「保存する」）。結果は <see cref="SaveCompleted"/>。</summary>
    public void RequestSave() => Post(new { type = "save-request" });

    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!_pageAccess.Allows(e.Source)) return;
        string? type = null, path = null, name = null, content = null, requestId = null;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return;
            type = root.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String ? t.GetString() : null;
            path = root.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
            name = root.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
            requestId = root.TryGetProperty("requestId", out var id) && id.ValueKind == JsonValueKind.String ? id.GetString() : null;
            content = root.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
        }
        catch (JsonException) { return; }

        // ファイル選択ダイアログはイベントの外で出す
        switch (type)
        {
            case "ready":
                IsReady = true;
                Ready?.Invoke();
                if (_pendingOpen != null) { var f = _pendingOpen; _pendingOpen = null; _owner.BeginInvoke(() => OpenPath(f)); }
                break;
            case "file-open-completed" when requestId != null:
                if (_openCompletions.TryGetValue(requestId, out var completion)) completion.TrySetResult();
                break;
            case "file-open":
                _owner.BeginInvoke(ShowOpenDialog);
                break;
            case "file-save" when content != null:
                _owner.BeginInvoke(() => Save(path, name, content));
                break;
        }
    }

    private void ShowOpenDialog()
    {
        using var dlg = new OpenFileDialog { Filter = Filter, InitialDirectory = InitialDir(), Title = "ファイルを開く" };
        if (dlg.ShowDialog(_owner) == DialogResult.OK) OpenPath(dlg.FileName);
    }

    public void OpenPath(string path)
    {
        try
        {
            var payload = ReadPayload(path);
            _lastDir = Path.GetDirectoryName(payload.Path);
            Post(payload);
        }
        catch (Exception ex)
        {
            Post(new { type = "file-error", message = $"ファイルを開けませんでした。\n{path}\n{ex.Message}" });
        }
    }

    internal static string ValidatePath(string path)
    {
        string fullPath = Path.GetFullPath(path);
        if (!string.Equals(Path.GetExtension(fullPath), Extension, StringComparison.OrdinalIgnoreCase))
            throw new IOException("開けるファイルは *.sdojo だけです。");
        if (new FileInfo(fullPath).Length > MaxBytes) throw new IOException("ファイルが大きすぎます（5 MB まで）。");
        return fullPath;
    }

    internal static string ReadContent(string path)
    {
        path = ValidatePath(path);
        // Deny concurrent writers while checking and reading the same file handle.
        using var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (file.Length > MaxBytes) throw new IOException("ファイルが大きすぎます（5 MB まで）。");
        using var reader = new StreamReader(file, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        return reader.ReadToEnd();
    }

    internal static CoreProjectPayload ReadPayload(string path)
    {
        path = ValidatePath(path);
        return new CoreProjectPayload(Guid.NewGuid().ToString("N"), path, Path.GetFileName(path), ReadContent(path));
    }

    public async Task OpenAndWaitAsync(string path, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var payload = ReadPayload(path);
        var completion = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        _openCompletions.Add(payload.RequestId, completion);
        try
        {
            ct.ThrowIfCancellationRequested();
            _lastDir = Path.GetDirectoryName(payload.Path);
            Post(payload);
            await completion.Task.WaitAsync(ct);
        }
        finally { _openCompletions.Remove(payload.RequestId); }
    }

    private void Save(string? path, string? name, string content)
    {
        if (string.IsNullOrEmpty(path) || !Directory.Exists(Path.GetDirectoryName(path)))
        {
            using var dlg = new SaveFileDialog
            {
                Filter = Filter,
                DefaultExt = Extension.TrimStart('.'),
                AddExtension = true,
                FileName = string.IsNullOrWhiteSpace(name) ? "シーケンス道場" + Extension : name,
                InitialDirectory = InitialDir(),
                Title = "名前を付けて保存",
            };
            if (dlg.ShowDialog(_owner) != DialogResult.OK)
            {
                SaveCompleted?.Invoke(false);
                return;
            }
            path = dlg.FileName;
        }
        try
        {
            // 書きかけのファイルを残さないよう、一時ファイルに書いてから置き換える
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, content, new UTF8Encoding(false));
            File.Move(tmp, path, overwrite: true);
            _lastDir = Path.GetDirectoryName(path);
            Post(new { type = "file-saved", path, name = Path.GetFileName(path) });
            SaveCompleted?.Invoke(true);
        }
        catch (Exception ex)
        {
            Post(new { type = "file-error", message = $"保存できませんでした。\n{path}\n{ex.Message}" });
            SaveCompleted?.Invoke(false);
        }
    }

    private string InitialDir() =>
        _lastDir ?? Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);

    private void Post(object message) => _core.PostWebMessageAsJson(JsonSerializer.Serialize(message, Json));
}
