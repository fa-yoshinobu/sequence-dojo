using SequenceDojo.Plc;

namespace SequenceDojo.Tests;

public class PlcConfigTests
{
    [Theory]
    [InlineData("IqF", "melsec:iq-f")]
    [InlineData("IqR", "melsec:iq-r")]
    [InlineData("IqL", "melsec:iq-l")]
    [InlineData("QnU", "melsec:qnu")]
    [InlineData("QnUDV", "melsec:qnudv")]
    [InlineData("LCpu", "melsec:lcpu")]
    [InlineData("", "melsec:iq-f")]
    [InlineData(" melsec:iq-r ", "melsec:iq-r")]
    public void LegacyMelsecProfilesAreNormalized(string legacy, string expected) =>
        Assert.Equal(expected, PlcLinks.Normalize(new PlcConfig(Profile: legacy)).Profile);

    [Theory]
    [InlineData("melsec", "IqR", PlcLinks.GxSimulatorPort)]
    [InlineData("melsec", "IqL", PlcLinks.GxSimulatorPort)]
    [InlineData("keyence", "keyence:kv-8000", PlcLinks.KvSimulatorPort)]
    [InlineData("keyence", "keyence:kv-8000-xym", PlcLinks.KvSimulatorPort)]
    [InlineData("keyence", "keyence:kv-x500", PlcLinks.KvSimulatorPort)]
    [InlineData("keyence", "keyence:kv-x500-xym", PlcLinks.KvSimulatorPort)]
    public void SupportedSimulatorsReplaceHostPortAndTransport(string protocol, string profile, int port)
    {
        var original = new PlcConfig(Protocol: protocol, Profile: profile, Host: "192.0.2.10", Port: 1234, Transport: "Udp", Simulator: true);
        var normalized = PlcLinks.Normalize(original);
        Assert.Equal("127.0.0.1", normalized.Host);
        Assert.Equal(port, normalized.Port);
        Assert.Equal("Tcp", normalized.Transport);
        Assert.True(normalized.Simulator);
        Assert.Equal("192.0.2.10", original.Host);
        Assert.Equal(1234, original.Port);
    }

    [Theory]
    [InlineData("melsec", "IqF")]
    [InlineData("keyence", "keyence:kv-7000")]
    [InlineData("modbus", "")]
    public void UnsupportedSimulatorsKeepTheExplicitEndpoint(string protocol, string profile)
    {
        var normalized = PlcLinks.Normalize(new PlcConfig(Protocol: protocol, Profile: profile, Host: "192.0.2.10", Port: 1234, Simulator: true));
        Assert.False(normalized.Simulator);
        Assert.Equal("192.0.2.10", normalized.Host);
        Assert.Equal(1234, normalized.Port);
    }

    [Theory]
    [InlineData(-1, -1, 10, 100)]
    [InlineData(5001, 10001, 5000, 10000)]
    [InlineData(30, 1000, 30, 1000)]
    public void IntervalsTimeoutsAndAddressesAreNormalized(int interval, int timeout, int expectedInterval, int expectedTimeout)
    {
        var config = PlcLinks.Normalize(new PlcConfig(Protocol: " MODBUS ", Host: " localhost ", InputStart: " c12 ", OutputStart: " hr34 ", IntervalMs: interval, TimeoutMs: timeout));
        Assert.Equal("modbus", config.Protocol);
        Assert.Equal("localhost", config.Host);
        Assert.Equal("C12", config.InputStart);
        Assert.Equal("HR34", config.OutputStart);
        Assert.Equal(expectedInterval, config.IntervalMs);
        Assert.Equal(expectedTimeout, config.TimeoutMs);
    }
}
