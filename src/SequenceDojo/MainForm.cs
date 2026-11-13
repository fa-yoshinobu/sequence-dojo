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
    private readonly BrowserSession _session;
    private string? _browserBootstrap;
    private readonly ProjectOpenQueue _requests;
    private readonly CancellationTokenSource _closing = new();
    private readonly ToolStripMenuItem _settingsMenu = new("設定");
    private bool _openingFile;
    private bool _browserMode;
    private bool _closePromptPending;
    private ProjectFiles? _files;
    private bool _closeConfirmed;     // 未保存の確認が済んだ（またはファイルを保存した）
    private bool _closeAfterSave;     // 「保存する」を選んだあと、保存が済んだら閉じる

    public MainForm(string url, BrowserSession session, string? startupFile = null)
        : this(url, session, new ProjectOpenQueue())
    {
        if (startupFile != null) _requests.Enqueue(startupFile);
    }

    internal MainForm(string url, BrowserSession session, ProjectOpenQueue requests)
    {
        _url = url;
        _session = session;
        _requests = requests;
        _requests.Available += ScheduleOpenRequests;
        HandleCreated += (_, _) => ScheduleOpenRequests();
        Text = AppTitle;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(1400, 880);
        MinimumSize = new Size(960, 600);
        BackColor = Color.FromArgb(14, 18, 24);
        Controls.Add(_view);
        var menu = new MenuStrip();
        menu.Items.Add(_settingsMenu);
        _settingsMenu.DropDownItems.Add("*.sdojo の関連付けを登録", null, (_, _) => ChangeAssociation(true));
        _settingsMenu.DropDownItems.Add("*.sdojo の関連付けを解除", null, (_, _) => ChangeAssociation(false));
        MainMenuStrip = menu;
        Controls.Add(menu);
        Load += async (_, _) => await InitAsync();
        FormClosing += OnFormClosing;
        FormClosed += (_, _) =>
        {
            _closing.Cancel();
            _requests.Close();
            _requests.Available -= ScheduleOpenRequests;
            if (_browserBootstrap == null) return;
            try { File.Delete(_browserBootstrap); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException) { Debug.WriteLine(error); }
        };
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
            if (_closing.IsCancellationRequested || IsDisposed) return;
            FallBackToBrowser("この PC には Microsoft Edge WebView2 ランタイムが入っていないため、既定のブラウザで開きます。");
            return;
        }
        catch (Exception ex)
        {
            if (_closing.IsCancellationRequested || IsDisposed) return;
            FallBackToBrowser($"画面の表示部品（WebView2）を初期化できなかったため、既定のブラウザで開きます。\n（{ex.Message}）");
            return;
        }

        if (_closing.IsCancellationRequested || IsDisposed) return;
        var core = _view.CoreWebView2;
        // Native cookie injection keeps the per-launch secret out of URLs, script globals and logs.
        var cookie = core.CookieManager.CreateCookie(BrowserSession.CookieName, _session.Token, "localhost", "/");
        cookie.IsHttpOnly = true;
        cookie.SameSite = CoreWebView2CookieSameSiteKind.Strict;
        core.CookieManager.AddOrUpdateCookie(cookie);
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.DocumentTitleChanged += (_, _) => Text = string.IsNullOrWhiteSpace(core.DocumentTitle) ? AppTitle : core.DocumentTitle;
        // 外部リンクや新しいウィンドウは既定のブラウザで開く
        var pageAccess = new NativePageAccess(_session.Origin);
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (e.IsUserInitiated && NativePageAccess.IsWebLink(e.Uri)) OpenExternal(e.Uri);
        };
        core.NavigationStarting += (_, e) =>
        {
            if (pageAccess.Allows(e.Uri)) return;
            e.Cancel = true;
            if (e.IsUserInitiated && NativePageAccess.IsWebLink(e.Uri)) OpenExternal(e.Uri);
        };
        // alert / confirm は「localhost:5087 の内容」と出てしまうので、アプリ名のメッセージボックスに置き換える
        core.Settings.AreDefaultScriptDialogsEnabled = false;
        core.ScriptDialogOpening += OnScriptDialog;
        // プロジェクトファイル（*.sdojo）の保存・読込
        _files = new ProjectFiles(this, core, null, _session.Origin);
        _files.Ready += ScheduleOpenRequests;
        _files.SaveCompleted += ok =>
        {
            if (!_closeAfterSave) return;
            _closeAfterSave = false;
            if (ok) { _closeConfirmed = true; Close(); }
            else ScheduleOpenRequests();
        };
        _view.Source = new Uri(_url);
    }

    // 保存していない変更があれば、閉じる前に確認する
    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_closeConfirmed || _files == null || _view.CoreWebView2 == null
            || e.CloseReason is CloseReason.WindowsShutDown or CloseReason.TaskManagerClosing)
        {
            _closing.Cancel();
            _requests.Close();
            return;
        }
        e.Cancel = true;
        if (_closePromptPending) return;
        _closePromptPending = true;
        BeginInvoke(async () =>
        {
            try
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
            }
            finally { _closePromptPending = false; ScheduleOpenRequests(); }
        });
    }

    private void ScheduleOpenRequests()
    {
        if (IsDisposed || Disposing || !IsHandleCreated || _closing.IsCancellationRequested) return;
        try { BeginInvoke(ProcessOpenRequests); }
        catch (InvalidOperationException error) { Debug.WriteLine(error); }
    }

    private async void ProcessOpenRequests()
    {
        if (_openingFile || _closePromptPending || _closeAfterSave || (!_browserMode && _files?.IsReady != true) || _closing.IsCancellationRequested) return;
        _openingFile = true;
        try
        {
            while (!_closing.IsCancellationRequested && _requests.TryTake(out string path))
            {
                try
                {
                    if (_browserMode) await _session.ProjectOpens.OpenAsync(path, _closing.Token);
                    else await _files!.OpenAndWaitAsync(path, _closing.Token);
                }
                catch (OperationCanceledException) when (_closing.IsCancellationRequested) { return; }
                catch (Exception error)
                {
                    Debug.WriteLine(error);
                    if (!_closing.IsCancellationRequested) MessageBox.Show(this, error.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
                finally { _requests.Complete(path); }
            }
        }
        finally { _openingFile = false; }
    }

    private void ChangeAssociation(bool register)
    {
        try
        {
            var association = ProjectAssociation.ForCurrentUser();
            if (register) association.Register(Application.ExecutablePath);
            else association.Unregister();
            MessageBox.Show(this, register ? "現在の利用者に関連付けを登録しました。" : "このアプリの関連付けを解除しました。",
                AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.Security.SecurityException or ArgumentException)
        {
            Debug.WriteLine(error);
            MessageBox.Show(this, error.Message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private void OnScriptDialog(object? sender, CoreWebView2ScriptDialogOpeningEventArgs e)
    {
        // イベント中にモーダルを出すと再入するので、遅延させてから表示する
        var deferral = e.GetDeferral();
        BeginInvoke(() =>
        {
            try
            {
                if (_closing.IsCancellationRequested || IsDisposed) return;
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
        _browserMode = true;
        Controls.Remove(_view);
        Controls.Add(new Label
        {
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.Gainsboro,
            Font = new Font("Yu Gothic UI", 11f),
            Text = $"{message}\n\n{_url}\n\nこのウィンドウを閉じるとアプリが終了します。",
        });
        try
        {
            _browserBootstrap = Path.Combine(Path.GetTempPath(), $"SequenceDojo-browser-{Guid.NewGuid():N}.html");
            File.WriteAllText(_browserBootstrap, _session.BootstrapHtml(), new System.Text.UTF8Encoding(false));
            OpenExternal(StoragePath.ResolveExisting(_browserBootstrap));
            ScheduleOpenRequests();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception)
        {
            MessageBox.Show(this, $"ブラウザ起動の準備ができませんでした。\n{error.Message}", AppTitle,
                MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static void OpenExternal(string uri)
    {
        try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { /* 開けなくても続行 */ }
    }
}
