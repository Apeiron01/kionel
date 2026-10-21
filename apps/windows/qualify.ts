/** Explicit Windows TPM diagnostic/qualification tool. */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { NativePlatformKeyProvider, evaluateKeyPolicy, ENTERPRISE_KEY_POLICY } from "@kionel/platform-keys";
import { PinnedWindowsHostTransport, WindowsTpmBridge, windowsHostArtifactSha256 } from "@kionel/platform-keys-windows";

const args = new Set(process.argv.slice(2));
const provision = args.has("--provision");
const requireUserPresence = args.has("--user-presence");
if (requireUserPresence && !provision) throw new Error("--user-presence requires --provision");
const hostArgument = process.argv.find((value) => value.startsWith("--host="))?.slice("--host=".length);
const hostPath = resolve(hostArgument ?? "native/windows/Kionel.WindowsKeyHost/bin/Release/net8.0-windows/Kionel.WindowsKeyHost.dll");
const hostHash = await windowsHostArtifactSha256(hostPath);
const bridge = new WindowsTpmBridge(new PinnedWindowsHostTransport({ hostPath, expectedSha256: hostHash }));
const capabilities = await bridge.capabilities();

if (!provision) {
  console.log(JSON.stringify({
    schema: "kionel-windows-tpm-diagnostic/v1",
    checkedAt: new Date().toISOString(),
    hostSha256: hostHash,
    capabilities,
    keyMutation: false,
    enterpriseReady: false,
    reason: "TPM provider detected; run with --provision for disposable sign/verify test. Remote attestation is not implemented.",
  }, null, 2));
  process.exit(0);
}

const alias = `qualification-${randomBytes(10).toString("hex")}`;
const provider = new NativePlatformKeyProvider(bridge);
let keyId: string | undefined;
let report: Record<string, unknown> | undefined;
try {
  const identity = await provider.provision({ alias, algorithm: "ecdsa-p256-sha256", requireUserPresence });
  keyId = identity.keyId;
  const challenge = new Uint8Array(randomBytes(64));
  const signature = await identity.sign(challenge);
  const verifyKey = await crypto.subtle.importKey("raw", new Uint8Array(identity.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const verified = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" }, verifyKey, new Uint8Array(signature), new Uint8Array(challenge),
  );
  const s = BigInt(`0x${Buffer.from(signature.subarray(32)).toString("hex")}`);
  const order = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  const lowS = s > 0n && s <= order / 2n;
  if (!verified || !lowS) throw new Error("TPM P-256 signature verification or low-S check failed");
  const enterprise = evaluateKeyPolicy(identity, ENTERPRISE_KEY_POLICY);
  report = {
    schema: "kionel-windows-tpm-qualification/v1",
    checkedAt: new Date().toISOString(),
    hostSha256: hostHash,
    providerId: identity.providerId,
    keyId: identity.keyId,
    securityLevel: identity.securityLevel,
    persistence: identity.persistence,
    requireUserPresence: identity.requiresUserPresence,
    signatureFormat: "ieee-p1363-low-s",
    signVerifyPassed: verified,
    attestationStatus: identity.attestation.status,
    enterpriseReady: enterprise.ok,
    enterprisePolicyReasons: enterprise.reasons,
  };
} finally {
  if (keyId) await provider.remove(keyId);
}
if (!report) throw new Error("Windows TPM qualification did not produce a report");
console.log(JSON.stringify({ ...report, disposableKeyRemoved: true }, null, 2));
