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
    private const long MaxBytes = 5 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly Form _owner;
    private readonly CoreWebView2 _core;
    private string? _pendingOpen;
    private string? _lastDir;

    /// <summary>保存が済んだとき（閉じる前の保存の続きに使う）。引数は成功したか。</summary>
    public event Action<bool>? SaveCompleted;

    public ProjectFiles(Form owner, CoreWebView2 core, string? startupFile)
    {
        _owner = owner;
        _core = core;
        _pendingOpen = startupFile;
        core.WebMessageReceived += OnMessage;
    }

    /// <summary>画面に保存を頼む（閉じる前の「保存する」）。結果は <see cref="SaveCompleted"/>。</summary>
    public void RequestSave() => Post(new { type = "save-request" });

    private void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string? type = null, path = null, name = null, content = null;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            path = root.TryGetProperty("path", out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
            name = root.TryGetProperty("name", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null;
            content = root.TryGetProperty("content", out var c) && c.ValueKind == JsonValueKind.String ? c.GetString() : null;
        }
        catch (JsonException) { return; }

        // ファイル選択ダイアログはイベントの外で出す
        switch (type)
        {
            case "ready":
                if (_pendingOpen != null) { var f = _pendingOpen; _pendingOpen = null; _owner.BeginInvoke(() => OpenPath(f)); }
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
            var info = new FileInfo(path);
            if (info.Length > MaxBytes) throw new IOException("ファイルが大きすぎます（5 MB まで）。");
            var content = File.ReadAllText(path, Encoding.UTF8);
            _lastDir = info.DirectoryName;
            Post(new { type = "file-opened", path = info.FullName, name = info.Name, content });
        }
        catch (Exception ex)
        {
            Post(new { type = "file-error", message = $"ファイルを開けませんでした。\n{path}\n{ex.Message}" });
        }
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
