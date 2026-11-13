namespace SequenceDojo.Tests;

public class NativePageAccessTests
{
    [Theory]
    [InlineData("http://localhost:5087/", true)]
    [InlineData("http://LOCALHOST:5087/index.html#section", true)]
    [InlineData("http://localhost:5087/js/../index.html", true)]
    [InlineData("http://localhost:5088/", false)]
    [InlineData("https://localhost:5087/", false)]
    [InlineData("http://127.0.0.1:5087/", false)]
    [InlineData("http://localhost.evil.invalid:5087/", false)]
    [InlineData("http://localhost:5087@evil.invalid/", false)]
    [InlineData("https://evil.invalid/", false)]
    [InlineData("file:///C:/fixture/attack.html", false)]
    [InlineData("data:text/html,attack", false)]
    [InlineData("about:blank", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("/index.html", false)]
    [InlineData(null, false)]
    public void NativePermissionsRequireTheExactConfiguredWebOrigin(string? source, bool allowed) =>
        Assert.Equal(allowed, new NativePageAccess("http://localhost:5087").Allows(source));

    [Theory]
    [InlineData("https://example.invalid/help", true)]
    [InlineData("http://example.invalid/help", true)]
    [InlineData("file:///C:/fixture/attack.exe", false)]
    [InlineData("ms-settings:windowsupdate", false)]
    [InlineData("javascript:alert(1)", false)]
    [InlineData("custom-protocol:payload", false)]
    public void ExternalNavigationAllowsOnlyWebLinks(string source, bool allowed) =>
        Assert.Equal(allowed, NativePageAccess.IsWebLink(source));
}
