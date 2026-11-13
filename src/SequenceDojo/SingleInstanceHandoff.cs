using System.Buffers.Binary;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace SequenceDojo;

/// <summary>同じ利用者の起動済みアプリへ、ファイルのパスだけを渡す。</summary>
internal sealed class SingleInstanceHandoff : IAsyncDisposable, IDisposable
{
    private const int MaxPathBytes = 128 * 1024;
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _listener;
    private int _disposed;

    public static string UserPipeName
    {
        get { using var identity = WindowsIdentity.GetCurrent(); return NameForIdentity(identity.User!.Value); }
    }
    internal static string NameForIdentity(string identity) => "SequenceDojo3D-" +
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity)))[..32];

    public SingleInstanceHandoff(string pipeName, Func<string, bool> receive)
    {
        _listener = Task.Run(async () =>
        {
            while (!_stop.IsCancellationRequested)
            {
                try
                {
                    await using var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut, 1,
                        PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                    await pipe.WaitForConnectionAsync(_stop.Token);
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
                    timeout.CancelAfter(TimeSpan.FromSeconds(5));
                    var prefix = new byte[4];
                    await pipe.ReadExactlyAsync(prefix, timeout.Token);
                    int length = BinaryPrimitives.ReadInt32LittleEndian(prefix);
                    if (length <= 0 || length > MaxPathBytes) continue;
                    var bytes = new byte[length];
                    await pipe.ReadExactlyAsync(bytes, timeout.Token);
                    bool accepted;
                    try { accepted = receive(new UTF8Encoding(false, true).GetString(bytes)); }
                    catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
                    {
                        System.Diagnostics.Debug.WriteLine(error);
                        accepted = false;
                    }
                    await pipe.WriteAsync(new byte[] { accepted ? (byte)1 : (byte)0 }, timeout.Token);
                    await pipe.FlushAsync(timeout.Token);
                }
                catch (OperationCanceledException) when (_stop.IsCancellationRequested) { break; }
                catch (Exception error) when (error is IOException or OperationCanceledException)
                {
                    System.Diagnostics.Debug.WriteLine(error);
                }
            }
        });
    }

    public static async Task<bool> SendAsync(string pipeName, string path, CancellationToken ct = default)
    {
        var bytes = Encoding.UTF8.GetBytes(path);
        if (bytes.Length is 0 or > MaxPathBytes) return false;
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        await using var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut,
            PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        await pipe.ConnectAsync(timeout.Token);
        var prefix = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(prefix, bytes.Length);
        await pipe.WriteAsync(prefix, timeout.Token);
        await pipe.WriteAsync(bytes, timeout.Token);
        await pipe.FlushAsync(timeout.Token);
        var reply = new byte[1];
        await pipe.ReadExactlyAsync(reply, timeout.Token);
        return reply[0] == 1;
    }

    public void Dispose() => DisposeAsync().AsTask().GetAwaiter().GetResult();

    public async ValueTask DisposeAsync()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0) return;
        _stop.Cancel();
        await _listener;
        _stop.Dispose();
    }
}
