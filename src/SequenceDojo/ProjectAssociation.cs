using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace SequenceDojo;

internal interface IAssociationStore
{
    string? Read(string key, string name = "");
    void Write(string key, string value, string name = "");
    void DeleteValue(string key, string name = "");
    void DeleteTree(string key);
}

/// <summary>現在の利用者の関連付けだけを扱い、解除時には以前の既定値を戻す。</summary>
internal sealed class ProjectAssociation(IAssociationStore store, Action? changed = null)
{
    internal const string ProgId = "SequenceDojo.Project";
    private const string Previous = "PreviousProgId";

    public void Register(string executable)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(executable);
        if (executable.Contains('"')) throw new ArgumentException("実行ファイルのパスが不正です。", nameof(executable));
        executable = Path.GetFullPath(executable);
        string? current = store.Read(ProjectFiles.Extension);
        if (!string.Equals(current, ProgId, StringComparison.OrdinalIgnoreCase)) store.Write(ProgId, current ?? "", Previous);
        store.Write(ProgId, "シーケンス道場ファイル");
        store.Write(ProgId + @"\DefaultIcon", $"\"{executable}\",0");
        store.Write(ProgId + @"\shell\open\command", $"\"{executable}\" \"%1\"");
        store.Write(ProjectFiles.Extension, ProgId);
        changed?.Invoke();
    }

    public void Unregister()
    {
        if (string.Equals(store.Read(ProjectFiles.Extension), ProgId, StringComparison.OrdinalIgnoreCase))
        {
            string? previous = store.Read(ProgId, Previous);
            if (string.IsNullOrEmpty(previous)) store.DeleteValue(ProjectFiles.Extension);
            else store.Write(ProjectFiles.Extension, previous);
        }
        store.DeleteTree(ProgId);
        changed?.Invoke();
    }

    public static ProjectAssociation ForCurrentUser() => new(new UserRegistry(),
        () => SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero));

    private sealed class UserRegistry : IAssociationStore
    {
        private const string Root = @"Software\Classes\";
        public string? Read(string key, string name = "")
        {
            using var entry = Registry.CurrentUser.OpenSubKey(Root + key);
            return entry?.GetValue(name) as string;
        }
        public void Write(string key, string value, string name = "")
        {
            using var entry = Registry.CurrentUser.CreateSubKey(Root + key);
            entry.SetValue(name, value, RegistryValueKind.String);
        }
        public void DeleteValue(string key, string name = "")
        {
            using var entry = Registry.CurrentUser.OpenSubKey(Root + key, writable: true);
            entry?.DeleteValue(name, throwOnMissingValue: false);
        }
        public void DeleteTree(string key) => Registry.CurrentUser.DeleteSubKeyTree(Root + key, throwOnMissingSubKey: false);
    }

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
