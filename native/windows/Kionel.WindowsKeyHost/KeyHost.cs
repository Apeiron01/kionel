using System.Numerics;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Kionel.WindowsKeyHost;

public sealed record CapabilitiesResponse(
    string ProviderId,
    string[] Algorithms,
    string[] SecurityLevels,
    bool SupportsAttestation,
    string AttestationStatus
);

public sealed record ProvisionRequest
{
    public required string Alias { get; init; }
    public required string Algorithm { get; init; }
    public required bool RequireUserPresence { get; init; }
    public required string AttestationChallenge { get; init; }
}

public sealed record KeyRequest
{
    public required string KeyId { get; init; }
}

public sealed record SignRequest
{
    public required string KeyId { get; init; }
    public required string Algorithm { get; init; }
    public required string Data { get; init; }
}

public sealed record RemoveRequest
{
    public required string KeyId { get; init; }
    public required string ConfirmKeyId { get; init; }
}

public sealed record NativeKeyResponse(
    string ProviderId,
    string KeyId,
    string Algorithm,
    string PublicKey,
    string SecurityLevel,
    string Persistence,
    bool RequiresUserPresence
);

public sealed record SignatureResponse(string Signature);
public sealed record RemoveResponse(bool Removed);

public static partial class KeyHost
{
    public const string ProviderId = "windows-cng-platform";
    public const string Algorithm = "ecdsa-p256-sha256";
    public const string KeyIdPrefix = "windows-tpm:";
    public const string ContainerPrefix = "Kionel.";
    private const int MaxSignBytes = 1024 * 1024;
    private static readonly CngProvider PlatformProvider = CngProvider.MicrosoftPlatformCryptoProvider;
    private static readonly BigInteger P256Order = BigInteger.Parse(
        "0FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
        System.Globalization.NumberStyles.AllowHexSpecifier
    );

    [GeneratedRegex("^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$", RegexOptions.CultureInvariant)]
    private static partial Regex AliasPattern();

    public static CapabilitiesResponse Capabilities()
    {
        RequireWindows();
        try { _ = CngKey.Exists("Kionel.__capability-probe__.v2", PlatformProvider); }
        catch (CryptographicException)
        {
            throw new HostException("tpm-unavailable", "Microsoft Platform Crypto Provider is unavailable; software fallback is forbidden");
        }
        return new(ProviderId, [Algorithm], ["tpm"], false, "not-implemented");
    }

    public static NativeKeyResponse Provision(ProvisionRequest request)
    {
        RequireWindows();
        ValidateAlgorithm(request.Algorithm);
        _ = DecodeBase64Url(request.AttestationChallenge, 32, 32, "attestation challenge");
        string container = ContainerFromAlias(request.Alias);
        if (CngKey.Exists(container, PlatformProvider)) throw new HostException("key-exists", "a Kionel key already exists for this alias");

        var parameters = new CngKeyCreationParameters
        {
            Provider = PlatformProvider,
            ExportPolicy = CngExportPolicies.None,
            KeyUsage = CngKeyUsages.Signing,
            KeyCreationOptions = CngKeyCreationOptions.None,
            UIPolicy = new CngUIPolicy(
                request.RequireUserPresence ? CngUIProtectionLevels.ForceHighProtection : CngUIProtectionLevels.None,
                "Kionel device identity",
                "Hardware-backed Kionel Enterprise signing key",
                "Authorize a Kionel signed operation",
                "Create Kionel device identity"
            ),
        };

        CngKey? key = null;
        try
        {
            key = CngKey.Create(CngAlgorithm.ECDsaP256, container, parameters);
            ValidateKey(key, request.RequireUserPresence);
            return Record(key);
        }
        catch (HostException)
        {
            DeleteFailedProvision(key);
            throw;
        }
        catch (CryptographicException)
        {
            DeleteFailedProvision(key);
            throw new HostException("tpm-unavailable", "TPM P-256 key creation failed; software fallback is forbidden");
        }
        catch (Exception)
        {
            DeleteFailedProvision(key);
            throw new HostException("provision-failed", "TPM provisioning failed closed");
        }
        finally { key?.Dispose(); }
    }

    public static NativeKeyResponse? Load(KeyRequest request)
    {
        RequireWindows();
        string container = ContainerFromKeyId(request.KeyId);
        if (!CngKey.Exists(container, PlatformProvider)) return null;
        try
        {
            using CngKey key = CngKey.Open(container, PlatformProvider, CngKeyOpenOptions.None);
            ValidateKey(key, expectedUserPresence: null);
            return Record(key);
        }
        catch (CryptographicException)
        {
            throw new HostException("key-load-failed", "TPM key could not be opened");
        }
    }

    public static SignatureResponse Sign(SignRequest request)
    {
        RequireWindows();
        ValidateAlgorithm(request.Algorithm);
        byte[] data = DecodeBase64Url(request.Data, 0, MaxSignBytes, "signing data");
        string container = ContainerFromKeyId(request.KeyId);
        if (!CngKey.Exists(container, PlatformProvider)) throw new HostException("key-not-found", "TPM key does not exist");
        try
        {
            using CngKey key = CngKey.Open(container, PlatformProvider, CngKeyOpenOptions.None);
            ValidateKey(key, expectedUserPresence: null);
            using var signer = new ECDsaCng(key) { HashAlgorithm = CngAlgorithm.Sha256 };
            byte[] signature = signer.SignData(data, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
            NormalizeLowS(signature);
            if (!signer.VerifyData(data, signature, HashAlgorithmName.SHA256, DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
                throw new HostException("signature-self-check", "TPM signature self-check failed");
            return new(EncodeBase64Url(signature));
        }
        catch (HostException) { throw; }
        catch (CryptographicException)
        {
            throw new HostException("sign-failed", "TPM signing failed");
        }
        finally
        {
            CryptographicOperations.ZeroMemory(data);
        }
    }

    public static RemoveResponse Remove(RemoveRequest request)
    {
        RequireWindows();
        if (!CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(request.KeyId),
            System.Text.Encoding.UTF8.GetBytes(request.ConfirmKeyId)))
            throw new HostException("confirmation-mismatch", "key removal confirmation does not match");
        string container = ContainerFromKeyId(request.KeyId);
        if (!CngKey.Exists(container, PlatformProvider)) return new(false);
        try
        {
            using CngKey key = CngKey.Open(container, PlatformProvider, CngKeyOpenOptions.None);
            ValidateKey(key, expectedUserPresence: null);
            key.Delete();
            return new(true);
        }
        catch (CryptographicException)
        {
            throw new HostException("key-remove-failed", "TPM key removal failed");
        }
    }

    public static void NormalizeLowS(byte[] signature)
    {
        if (signature.Length != 64) throw new HostException("signature-format", "P-256 signature must be 64-byte P1363");
        BigInteger s = new(signature.AsSpan(32, 32), isUnsigned: true, isBigEndian: true);
        if (s <= BigInteger.Zero || s >= P256Order) throw new HostException("signature-format", "P-256 signature scalar is out of range");
        if (s <= P256Order / 2) return;
        BigInteger normalized = P256Order - s;
        signature.AsSpan(32, 32).Clear();
        if (!normalized.TryWriteBytes(signature.AsSpan(32, 32), out int written, isUnsigned: true, isBigEndian: true))
            throw new HostException("signature-format", "P-256 signature normalization failed");
        if (written < 32) signature.AsSpan(32, 32).RotateRight(32 - written);
    }

    public static string ContainerFromAlias(string alias)
    {
        if (alias is null || !AliasPattern().IsMatch(alias)) throw new HostException("invalid-alias", "alias must match the Kionel safe identifier policy");
        return $"{ContainerPrefix}{alias}.v2";
    }

    public static string ContainerFromKeyId(string keyId)
    {
        if (keyId is null || !keyId.StartsWith(KeyIdPrefix, StringComparison.Ordinal))
            throw new HostException("invalid-key-id", "keyId is outside the Kionel Windows TPM namespace");
        string container = keyId[KeyIdPrefix.Length..];
        if (!container.StartsWith(ContainerPrefix, StringComparison.Ordinal) ||
            !container.EndsWith(".v2", StringComparison.Ordinal) || container.Length > 96 ||
            !AliasPattern().IsMatch(container[ContainerPrefix.Length..^3]))
            throw new HostException("invalid-key-id", "keyId is outside the Kionel Windows TPM namespace");
        return container;
    }

    public static string EncodeBase64Url(ReadOnlySpan<byte> value) =>
        Convert.ToBase64String(value).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public static byte[] DecodeBase64Url(string value, int minimum, int maximum, string field)
    {
        if (value is null || value.Contains('=') || !value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
            throw new HostException("invalid-base64url", $"{field} is not canonical base64url");
        try
        {
            string padded = value.Replace('-', '+').Replace('_', '/');
            padded += new string('=', (4 - padded.Length % 4) % 4);
            byte[] decoded = Convert.FromBase64String(padded);
            if (decoded.Length < minimum || decoded.Length > maximum || EncodeBase64Url(decoded) != value)
                throw new HostException("invalid-base64url", $"{field} has an invalid size or encoding");
            return decoded;
        }
        catch (FormatException)
        {
            throw new HostException("invalid-base64url", $"{field} is not canonical base64url");
        }
    }

    private static NativeKeyResponse Record(CngKey key)
    {
        using var publicOnly = new ECDsaCng(key);
        ECParameters parameters = publicOnly.ExportParameters(false);
        if (parameters.Q.X is not { Length: 32 } x || parameters.Q.Y is not { Length: 32 } y)
            throw new HostException("public-key-format", "TPM returned a non-canonical P-256 public key");
        byte[] sec1 = new byte[65];
        sec1[0] = 4;
        x.CopyTo(sec1, 1);
        y.CopyTo(sec1, 33);
        bool userPresence = (key.UIPolicy.ProtectionLevel & CngUIProtectionLevels.ForceHighProtection) != 0;
        return new(ProviderId, $"{KeyIdPrefix}{key.KeyName}", Algorithm, EncodeBase64Url(sec1), "tpm", "persistent", userPresence);
    }

    private static void ValidateKey(CngKey key, bool? expectedUserPresence)
    {
        if (key.Provider != PlatformProvider) throw new HostException("provider-mismatch", "key is not owned by Microsoft Platform Crypto Provider");
        if (key.AlgorithmGroup != CngAlgorithmGroup.ECDsa || key.KeySize != 256) throw new HostException("algorithm-mismatch", "key is not P-256 ECDSA");
        if ((key.KeyUsage & CngKeyUsages.Signing) == 0) throw new HostException("usage-mismatch", "key is not authorized for signing");
        if (key.ExportPolicy != CngExportPolicies.None) throw new HostException("export-policy", "key export policy is not fail-closed");
        bool actualPresence = (key.UIPolicy.ProtectionLevel & CngUIProtectionLevels.ForceHighProtection) != 0;
        if (expectedUserPresence.HasValue && actualPresence != expectedUserPresence.Value)
            throw new HostException("presence-policy", "key user-presence policy does not match the request");
    }

    private static void ValidateAlgorithm(string algorithm)
    {
        if (algorithm != Algorithm) throw new HostException("algorithm-mismatch", "only ecdsa-p256-sha256 is supported");
    }

    private static void RequireWindows()
    {
        if (!OperatingSystem.IsWindows()) throw new HostException("unsupported-platform", "Windows CNG host only runs on Windows");
    }

    private static void DeleteFailedProvision(CngKey? key)
    {
        if (key is null) return;
        try { key.Delete(); }
        catch (CryptographicException)
        {
            throw new HostException("provision-cleanup-failed", "failed TPM provisioning left a key requiring administrator cleanup");
        }
    }
}

internal static class SpanExtensions
{
    public static void RotateRight(this Span<byte> value, int count)
    {
        if (count <= 0) return;
        value[..(value.Length - count)].CopyTo(value[count..]);
        value[..count].Clear();
    }
}
