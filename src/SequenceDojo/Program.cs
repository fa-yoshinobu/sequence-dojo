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
        ApplicationConfiguration.Initialize();

        // 2 重起動しない（設定の保存先が分かれないように）。起動済みならそのウィンドウを前面に出す
        using var mutex = new Mutex(true, @"Local\SequenceDojo3D", out var first);
        if (!first)
        {
            BringExistingToFront();
            return;
        }

        WebApplication web;
        string url;
        try
        {
            // 引数はファイルとして扱うので、サーバーには渡さない
            (web, url) = WebServer.StartAsync([]).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            MessageBox.Show($"サーバーを起動できませんでした。\n\n{ex.Message}", "シーケンス道場 3D",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        try
        {
            // 起動時に渡された *.sdojo（エクスプローラーでのドラッグ＆ドロップやファイルの関連付け）を開く
            var file = args.FirstOrDefault(a => !a.StartsWith('-') && File.Exists(a));
            Application.Run(new MainForm(url, file));
        }
        finally
        {
            // PLC との通信も含めて止める
            web.StopAsync().GetAwaiter().GetResult();
            web.DisposeAsync().AsTask().GetAwaiter().GetResult();
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
