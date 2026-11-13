namespace SequenceDojo;

internal static class Program
{
    /// <summary>
    /// シーケンス道場 3D を起動する。アプリ内でサーバーを動かし、専用ウィンドウ（WebView2）に画面を表示する。
    /// ウィンドウを閉じるとサーバーも終了する。
    /// </summary>
    [STAThread]
    private static void Main(string[] args)
    {
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => ReportUnexpected("画面スレッドの未処理例外", e.Exception);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => ReportUnexpected("背景スレッドの未処理例外",
            e.ExceptionObject as Exception ?? new Exception(e.ExceptionObject?.ToString()), fatal: e.IsTerminating);
        TaskScheduler.UnobservedTaskException += (_, e) =>
        {
            e.SetObserved();
            ReportUnexpected("未観測タスクの例外", e.Exception);
        };
        DiagnosticLog.Shared.Write("アプリを起動しました");
        try { Run(args); }
        catch (Exception error)
        {
            Environment.ExitCode = 1;
            ReportUnexpected("アプリの実行または終了処理に失敗", error);
        }
        finally { DiagnosticLog.Shared.Write("アプリを終了しました"); }
    }

    private static void Run(string[] args)
    {
        ApplicationConfiguration.Initialize();

        // 2 重起動しない（設定の保存先が分かれないように）。起動済みならそのウィンドウを前面に出す
        using var mutex = new Mutex(true, @"Local\SequenceDojo3D", out var first);
        string? file = args.FirstOrDefault(argument => !argument.StartsWith('-'));
        if (!first)
        {
            if (file != null)
            {
                try
                {
                    if (!SingleInstanceHandoff.SendAsync(SingleInstanceHandoff.UserPipeName, Path.GetFullPath(file)).GetAwaiter().GetResult())
                        throw new IOException("起動済みのアプリがファイルを受け付けませんでした。");
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or OperationCanceledException)
                {
                    DiagnosticLog.Shared.Write("起動済みアプリへのファイル引継ぎに失敗", error);
                    MessageBox.Show($"ファイルを渡せませんでした。\n{error.Message}", "シーケンス道場 3D", MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
            BringExistingToFront();
            return;
        }
        LegacyExtractionCleanup.Run();
        var requests = new ProjectOpenQueue();
        if (file != null)
        {
            try { requests.Enqueue(file); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
            {
                DiagnosticLog.Shared.Write("起動時のプロジェクト受付に失敗", error);
                MessageBox.Show(error.Message, "シーケンス道場 3D", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
        using var handoff = new SingleInstanceHandoff(SingleInstanceHandoff.UserPipeName, requests.Enqueue);

        WebApplication web;
        string url;
        try
        {
            // 引数はファイルとして扱うので、サーバーには渡さない
            (web, url) = WebServer.StartAsync([]).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            DiagnosticLog.Shared.Write("画面サーバーの起動に失敗", ex);
            MessageBox.Show($"サーバーを起動できませんでした。\n\n{ex.Message}", "シーケンス道場 3D",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            // 起動時に渡された *.sdojo（エクスプローラーでのドラッグ＆ドロップやファイルの関連付け）を開く
            Application.Run(new MainForm(url, web.Services.GetRequiredService<BrowserSession>(), requests));
        }
        finally
        {
            // Stop PLC writes before draining browser requests, including an external browser left open.
            try { web.Services.GetRequiredService<PlcService>().DisposeAsync().AsTask().GetAwaiter().GetResult(); }
            finally
            {
                try { web.StopAsync().GetAwaiter().GetResult(); }
                finally { web.DisposeAsync().AsTask().GetAwaiter().GetResult(); }
            }
        }
    }

    private static void ReportUnexpected(string context, Exception error, bool fatal = false)
    {
        DiagnosticLog.Shared.Write(context, error);
        void ShowError() => MessageBox.Show($"予期しないエラーが発生しました。\n{error.Message}\n\n詳細は「設定 → 診断ログのフォルダーを開く」で確認できます。",
            "シーケンス道場 3D", MessageBoxButtons.OK, MessageBoxIcon.Error);
        try
        {
            // A terminating background exception must display its notice before this handler returns.
            if (fatal) { ShowError(); return; }
            var form = Application.OpenForms.Cast<Form>().FirstOrDefault();
            if (form is { IsHandleCreated: true } && form.InvokeRequired) form.BeginInvoke((Action)ShowError);
            else ShowError();
        }
        catch (Exception notificationError)
        {
            DiagnosticLog.Shared.Write("エラー通知を表示できませんでした", notificationError);
        }
    }

    private static void BringExistingToFront()
    {
        var me = System.Diagnostics.Process.GetCurrentProcess();
        var other = System.Diagnostics.Process.GetProcessesByName(me.ProcessName)
            .FirstOrDefault(p => p.Id != me.Id && p.MainWindowHandle != IntPtr.Zero);
        if (other == null) return;
        ShowWindow(other.MainWindowHandle, 9); // SW_RESTORE
        // ファイル選択や確認のダイアログが開いていれば、そちらを前面に出す（隠れていると操作できないように見えるため）
        var popup = GetLastActivePopup(other.MainWindowHandle);
        SetForegroundWindow(popup != IntPtr.Zero ? popup : other.MainWindowHandle);
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern IntPtr GetLastActivePopup(IntPtr hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
