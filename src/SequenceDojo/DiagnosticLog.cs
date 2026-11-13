using System.Text;
using System.Text.RegularExpressions;

namespace SequenceDojo;

/// <summary>起動・通信・画面の診断記録。記録失敗でアプリを停止させない。</summary>
internal sealed class DiagnosticLog
{
    private static readonly Regex TokenPattern = new(@"\b[0-9a-fA-F]{64}\b", RegexOptions.CultureInvariant);
    private static readonly Regex HtmlPattern = new(@"<(?:!doctype|html|form|input)\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private readonly object _gate = new();
    private readonly HashSet<string> _secrets = new(StringComparer.Ordinal);
    private readonly int _maxFileBytes;
    private readonly int _maxFiles;

    public static DiagnosticLog Shared { get; } = new(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SequenceDojo", "logs"));

    public DiagnosticLog(string directory, int maxFileBytes = 256 * 1024, int maxFiles = 4)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(maxFileBytes, 128);
        ArgumentOutOfRangeException.ThrowIfLessThan(maxFiles, 1);
        DirectoryPath = directory;
        _maxFileBytes = maxFileBytes;
        _maxFiles = maxFiles;
    }

    public string DirectoryPath { get; }

    public string GetExistingDirectoryPath()
    {
        Directory.CreateDirectory(DirectoryPath);
        return StoragePath.ResolveExisting(DirectoryPath);
    }

    public void RegisterSecret(string? secret)
    {
        if (string.IsNullOrEmpty(secret)) return;
        lock (_gate) _secrets.Add(secret);
    }

    public void Write(string context, Exception? error = null)
    {
        lock (_gate)
        {
            try
            {
                string text = context + (error == null ? "" : "\n" + error);
                foreach (string secret in _secrets) text = text.Replace(secret, "[redacted]", StringComparison.Ordinal);
                text = TokenPattern.Replace(text, "[redacted]");
                if (HtmlPattern.IsMatch(text)) text = "[HTML content omitted]";
                text = $"{DateTimeOffset.Now:O} {text}".Replace("\r\n", "\n").Replace('\r', '\n');
                // Encoder.Convert truncates only between complete UTF-8 characters.
                var bytes = new byte[Math.Min(_maxFileBytes - 1, Encoding.UTF8.GetByteCount(text)) + 1];
                Encoding.UTF8.GetEncoder().Convert(text.AsSpan(), bytes.AsSpan(0, bytes.Length - 1), true,
                    out _, out int count, out _);
                bytes[count++] = (byte)'\n';
                Directory.CreateDirectory(DirectoryPath);
                string current = Path.Combine(DirectoryPath, "sequence-dojo.log");
                if (File.Exists(current) && new FileInfo(current).Length + count > _maxFileBytes)
                {
                    for (int i = _maxFiles - 1; i >= 1; i--)
                    {
                        string source = Path.Combine(DirectoryPath, i == 1 ? "sequence-dojo.log" : $"sequence-dojo.{i - 1}.log");
                        if (File.Exists(source)) File.Move(source, Path.Combine(DirectoryPath, $"sequence-dojo.{i}.log"), overwrite: true);
                    }
                    if (_maxFiles == 1) File.Delete(current);
                }
                using var stream = new FileStream(current, FileMode.Append, FileAccess.Write, FileShare.Read);
                stream.Write(bytes.AsSpan(0, count));
            }
            catch (Exception)
            {
                // 診断ログ自体の失敗は再度ログに送らず、元の処理を継続する。
            }
        }
    }
}
