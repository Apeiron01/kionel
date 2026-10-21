using System.Numerics;
using Kionel.WindowsKeyHost;

var failures = new List<string>();
Check(KeyHost.ContainerFromAlias("lab-terminal-7") == "Kionel.lab-terminal-7.v2", "container mapping");
Check(KeyHost.ContainerFromKeyId("windows-tpm:Kionel.lab-terminal-7.v2") == "Kionel.lab-terminal-7.v2", "keyId mapping");
ExpectHostError(() => KeyHost.ContainerFromAlias("../escape"), "unsafe alias");
ExpectHostError(() => KeyHost.ContainerFromKeyId("software:Kionel.lab.v2"), "foreign provider keyId");

byte[] sample = Enumerable.Range(0, 65).Select(i => (byte)i).ToArray();
string encoded = KeyHost.EncodeBase64Url(sample);
Check(KeyHost.DecodeBase64Url(encoded, 65, 65, "sample").SequenceEqual(sample), "canonical base64url round trip");
ExpectHostError(() => KeyHost.DecodeBase64Url(encoded + "=", 65, 65, "sample"), "padded base64url");

BigInteger order = BigInteger.Parse("0FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551", System.Globalization.NumberStyles.AllowHexSpecifier);
byte[] signature = new byte[64];
signature[31] = 1;
(order - 1).TryWriteBytes(signature.AsSpan(32), out _, isUnsigned: true, isBigEndian: true);
KeyHost.NormalizeLowS(signature);
Check(signature.AsSpan(32, 31).IndexOfAnyExcept((byte)0) < 0 && signature[63] == 1, "high-S normalization");
ExpectHostError(() => KeyHost.NormalizeLowS(new byte[63]), "signature length");

if (failures.Count > 0)
{
    Console.Error.WriteLine(string.Join(Environment.NewLine, failures));
    return 1;
}
Console.WriteLine("Kionel Windows key host codec/security tests passed (no TPM mutation).");
return 0;

void Check(bool condition, string name)
{
    if (!condition) failures.Add($"FAIL: {name}");
}

void ExpectHostError(Action action, string name)
{
    try { action(); failures.Add($"FAIL: {name} did not fail closed"); }
    catch (HostException) { }
}
