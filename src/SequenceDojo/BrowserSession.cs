using System.Net;
using System.Security.Cryptography;
using System.Text;

namespace SequenceDojo;

/// <summary>起動ごとの認証情報。URL・JavaScript・ログへトークンを渡さない。</summary>
public sealed class BrowserSession
{
    internal BrowserProjectOpens ProjectOpens { get; } = new();

    public const string CookieName = "SequenceDojoSession";
    internal string Token { get; } = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    internal string Origin { get; set; } = "";

    internal bool Matches(string? value) => value?.Length == Token.Length
        && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(value), Encoding.ASCII.GetBytes(Token));

    internal bool Allows(HttpContext context) => context.Request.Headers.Origin.Count == 1
        && string.Equals(context.Request.Headers.Origin[0], Origin, StringComparison.Ordinal)
        && Matches(context.Request.Cookies[CookieName]);

    // External browsers cannot receive native WebView cookies. A temporary local page POSTs the
    // token in the request body, then the server installs the same HttpOnly cookie and redirects.
    internal string BootstrapHtml() => $"""
        <!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer">
        <title>シーケンス道場 3D を開いています</title>
        <form method="post" action="{WebUtility.HtmlEncode(Origin)}/session">
          <input type="hidden" name="token" value="{Token}">
          <button type="submit">シーケンス道場 3D を開く</button>
        </form><script>document.forms[0].submit();</script>
        """;
}
