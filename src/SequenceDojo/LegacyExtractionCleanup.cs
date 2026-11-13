namespace SequenceDojo;

/// <summary>旧版が展開した画面一式だけを回収し、使用中のネイティブ展開先は残す。</summary>
internal static class LegacyExtractionCleanup
{
    public static void Run() => Run(Path.GetTempPath(),
        (AppContext.GetData("NATIVE_DLL_SEARCH_DIRECTORIES") as string ?? "")
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries).Append(AppContext.BaseDirectory));

    internal static void Run(string tempDirectory, IEnumerable<string> activeDirectories)
    {
        try
        {
            string temp = Path.TrimEndingDirectorySeparator(Path.GetFullPath(tempDirectory));
            string root = Path.GetFullPath(Path.Combine(temp, ".net", "SequenceDojo"));
            if (!IsWithin(root, temp) || HasLinkedAncestor(root) || !Directory.Exists(root)) return;
            string[] active = activeDirectories.Select(Path.GetFullPath).ToArray();
            foreach (string candidate in Directory.EnumerateDirectories(root))
            {
                try
                {
                    string path = Path.GetFullPath(candidate);
                    string name = Path.GetFileName(path);
                    // .NET bundle IDs are 12 URL-safe Base64 characters (HostModel Bundle/Manifest.cs).
                    if (name.Length != 12 || !name.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_')
                        || !string.Equals(Path.GetDirectoryName(path), root, StringComparison.OrdinalIgnoreCase)
                        || !IsWithin(path, root) || active.Any(item => IsWithin(item, path))
                        || ContainsLink(path)) continue;
                    // Recheck the root immediately before a recursive removal; never follow a junction.
                    if (HasLinkedAncestor(path)) continue;
                    Directory.Delete(path, recursive: true);
                }
                catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
                {
                    DiagnosticLog.Shared.Write("旧展開フォルダの削除", error);
                }
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException)
        {
            DiagnosticLog.Shared.Write("旧展開フォルダの確認", error);
        }
    }

    private static bool IsWithin(string path, string root) =>
        path.Equals(root, StringComparison.OrdinalIgnoreCase)
        || path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);

    private static bool HasLinkedAncestor(string path)
    {
        for (DirectoryInfo? directory = new(path); directory != null; directory = directory.Parent)
            if (directory.Exists && (directory.Attributes & FileAttributes.ReparsePoint) != 0) return true;
        return false;
    }

    private static bool ContainsLink(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) return true;
        foreach (string item in Directory.EnumerateFileSystemEntries(path))
        {
            var attributes = File.GetAttributes(item);
            if ((attributes & FileAttributes.ReparsePoint) != 0) return true;
            if ((attributes & FileAttributes.Directory) != 0 && ContainsLink(item)) return true;
        }
        return false;
    }
}
