using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace SequenceDojo;

/// <summary>画面を表示するメインウィンドウ。WebView2（Edge）で wwwroot の画面を表示する。</summary>
public sealed class MainForm : Form
{
    private const string AppTitle = "シーケンス道場 3D";
    private readonly WebView2 _view = new() { Dock = DockStyle.Fill };
    private readonly string _url;
    private readonly string? _startupFile;
    private ProjectFiles? _files;
    private bool _closeConfirmed;     // 未保存の確認が済んだ（またはファイルを保存した）
    private bool _closeAfterSave;     // 「保存する」を選んだあと、保存が済んだら閉じる

    public MainForm(string url, string? startupFile = null)
    {
        _url = url;
        _startupFile = startupFile;
        Text = AppTitle;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1400, 880);
        MinimumSize = new Size(960, 600);
        BackColor = Color.FromArgb(14, 18, 24);
        Controls.Add(_view);
        Load += async (_, _) => await InitAsync();
        FormClosing += OnFormClosing;
    }

    private async Task InitAsync()
    {
        try
        {
            // 設定（localStorage など）はユーザーごとの AppData に保存する
            var dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SequenceDojo", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, dataDir);
            await _view.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            FallBackToBrowser("この PC には Microsoft Edge WebView2 ランタイムが入っていないため、既定のブラウザで開きます。");
            return;
        }
        catch (Exception ex)
        {
            FallBackToBrowser($"画面の表示部品（WebView2）を初期化できなかったため、既定のブラウザで開きます。\n（{ex.Message}）");
            return;
        }

        var core = _view.CoreWebView2;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? AppTitle : core.DocumentTitle;
        // 外部リンクや新しいウィンドウは既定のブラウザで開く
        core.NewWindowRequested += (_, e) => { e.Handled = true; OpenExternal(e.Uri); };
        // alert / confirm は「localhost:5087 の内容」と出てしまうので、アプリ名のメッセージボックスに置き換える
        core.Settings.AreDefaultScriptDialogsEnabled = false;
        core.ScriptDialogOpening += OnScriptDialog;
        // プロジェクトファイル（*.sdojo）の保存・読込
        _files = new ProjectFiles(this, core, _startupFile);
        _files.SaveCompleted += ok =>
        {
            if (!_closeAfterSave) return;
            _closeAfterSave = false;
            if (ok) { _closeConfirmed = true; Close(); }
        };
        _view.Source = new Uri(_url);
    }

    // 保存していない変更があれば、閉じる前に確認する
    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_closeConfirmed || _files == null || _view.CoreWebView2 == null
            || e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing) return;
        e.Cancel = true;
        BeginInvoke(async () =>
        {
            string dirty;
            try { dirty = await _view.CoreWebView2.ExecuteScriptAsync("window.__dojoDirty ? window.__dojoDirty() : false"); }
            catch { dirty = "false"; }
            if (dirty != "true")
            {
                _closeConfirmed = true;
                Close();
                return;
            }
            switch (MessageBox.Show(this, "保存していない変更があります。保存しますか？", AppTitle,
                        MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning))
            {
                case DialogResult.Yes:
                    _closeAfterSave = true;
                    _files.RequestSave();
                    break;
                case DialogResult.No:
                    _closeConfirmed = true;
                    Close();
                    break;
            }
        });
    }

    private void OnScriptDialog(object? sender, CoreWebView2ScriptDialogOpeningEventArgs e)
    {
        // イベント中にモーダルを出すと再入するので、遅延させてから表示する
        var deferral = e.GetDeferral();
        BeginInvoke(() =>
        {
            try
            {
                switch (e.Kind)
                {
                    case CoreWebView2ScriptDialogKind.Alert:
                        MessageBox.Show(this, e.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                        e.Accept();
                        break;
                    case CoreWebView2ScriptDialogKind.Confirm:
                        if (MessageBox.Show(this, e.Message, AppTitle, MessageBoxButtons.OKCancel, MessageBoxIcon.Question) == DialogResult.OK)
                            e.Accept();
                        break;
                    default:
                        e.Accept();
                        break;
                }
            }
            finally
            {
                deferral.Complete();
            }
        });
    }

    private void FallBackToBrowser(string message)
    {
        Controls.Remove(_view);
        Controls.Add(new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.Gainsboro,
            Font = new Font("Yu Gothic UI", 11f),
            Text = $"{message}\n\n{_url}\n\nこのウィンドウを閉じるとアプリが終了します。",
        });
        OpenExternal(_url);
    }

    private static void OpenExternal(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { /* 開けなくても続行 */ }
    }
}
