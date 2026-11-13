using SequenceDojo.Plc;

namespace SequenceDojo.Tests;

public class ModbusAddressTests
{
    [Theory]
    [InlineData("C0", true, "C", 0)]
    [InlineData("C65520", true, "C", 65520)]
    [InlineData("DI65520", false, "DI", 65520)]
    [InlineData("HR65535", true, "HR", 65535)]
    [InlineData("IR65535", false, "IR", 65535)]
    public void ValidAddressesRespectTheAreaAndBitSpan(string address, bool write, string area, int number)
    {
        var result = ModbusLink.Parse(address, write);
        Assert.Equal(area, result.Area);
        Assert.Equal((ushort)number, result.Number);
    }

    [Theory]
    [InlineData("DI0")]
    [InlineData("IR0")]
    public void InputWriteAddressesCannotUseReadOnlyAreas(string address)
    {
        var error = Assert.Throws<ArgumentException>(() => ModbusLink.Parse(address, forWrite: true));
        Assert.Contains("読出し専用", error.Message);
    }

    [Theory]
    [InlineData("C65521")]
    [InlineData("DI65521")]
    [InlineData("HR65536")]
    [InlineData("C-1")]
    [InlineData("C")]
    [InlineData("c0")]
    [InlineData("D0")]
    [InlineData("")]
    public void OutOfRangeOrMalformedAddressesAreRejected(string address) =>
        Assert.Throws<ArgumentException>(() => ModbusLink.Parse(address, forWrite: false));
}
