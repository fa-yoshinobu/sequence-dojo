namespace SequenceDojo;

/// <summary>ネイティブ権限を渡す画面のオリジンを固定する。</summary>
internal sealed class NativePageAccess(string expectedOrigin)
{
    private readonly Uri _origin = new(expectedOrigin, UriKind.Absolute);

    public bool Allows(string? source) => Uri.TryCreate(source, UriKind.Absolute, out var uri)
        && IsWebLink(source)
        && string.Equals(uri.Scheme, _origin.Scheme, StringComparison.OrdinalIgnoreCase)
        && string.Equals(uri.Host, _origin.Host, StringComparison.OrdinalIgnoreCase)
        && uri.Port == _origin.Port;

    public static bool IsWebLink(string? source) => Uri.TryCreate(source, UriKind.Absolute, out var uri)
        && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
}
