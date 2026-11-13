using System.Diagnostics;

namespace SequenceDojo.Tests;

public sealed class LegacyExtractionCleanupTests : IDisposable
{
    private readonly string _temp = Directory.CreateTempSubdirectory("dojo-cleanup-test-").FullName;
    private string Root => Path.Combine(_temp, ".net", "SequenceDojo");

    [Fact]
    public void DeletesOnlyOldHashDirectoriesAndKeepsBothActiveLocations()
    {
        string old = Hash("oldHash1234_");
        string current = Hash("current12345");
        string native = Hash("native123456");
        string other = Hash("user-folder");
        LegacyExtractionCleanup.Run(_temp, [current, Path.Combine(native, "runtimes", "win-x64", "native")]);
        Assert.False(Directory.Exists(old));
        Assert.True(Directory.Exists(current));
        Assert.True(Directory.Exists(native));
        Assert.True(Directory.Exists(other));
        Assert.True(Directory.Exists(Root));
    }

    [Fact]
    public void LinkedChildAndNestedJunctionAreNotTraversedOrDeleted()
    {
        string outside = Path.Combine(_temp, "keep");
        Directory.CreateDirectory(outside);
        string sentinel = Path.Combine(outside, "sentinel.txt");
        File.WriteAllText(sentinel, "keep");
        Directory.CreateDirectory(Root);
        string child = Path.Combine(Root, "linked123456");
        string nested = Path.Combine(Hash("nested123456"), "link");
        Junction(child, outside);
        Junction(nested, outside);
        try
        {
            LegacyExtractionCleanup.Run(_temp, []);
            Assert.True(File.Exists(sentinel));
            Assert.True(Directory.Exists(child));
            Assert.True(Directory.Exists(nested));
        }
        finally { Directory.Delete(child); Directory.Delete(nested); }
    }

    [Fact]
    public void LinkedApplicationRootIsSkipped()
    {
        string outside = Path.Combine(_temp, "keep");
        string hash = Path.Combine(outside, "oldHash1234_");
        Directory.CreateDirectory(hash);
        Directory.CreateDirectory(Path.GetDirectoryName(Root)!);
        Junction(Root, outside);
        try
        {
            LegacyExtractionCleanup.Run(_temp, []);
            Assert.True(Directory.Exists(hash));
        }
        finally { Directory.Delete(Root); }
    }

    private string Hash(string name)
    {
        string path = Path.Combine(Root, name);
        Directory.CreateDirectory(path);
        File.WriteAllText(Path.Combine(path, "index.html"), "old asset");
        return path;
    }

    private static void Junction(string path, string target)
    {
        var info = new ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true };
        info.ArgumentList.Add("/c"); info.ArgumentList.Add("mklink"); info.ArgumentList.Add("/J");
        info.ArgumentList.Add(path); info.ArgumentList.Add(target);
        using var process = Process.Start(info)!;
        Assert.True(process.WaitForExit(5000));
        Assert.Equal(0, process.ExitCode);
    }

    public void Dispose()
    {
        string path = Path.GetFullPath(_temp);
        Assert.StartsWith(Path.GetFullPath(Path.GetTempPath()), path, StringComparison.OrdinalIgnoreCase);
        Assert.StartsWith("dojo-cleanup-test-", Path.GetFileName(path));
        Directory.Delete(path, recursive: true);
    }
}
