// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import { describe, expect, it } from "vitest";
import {
  ENTERPRISE_KEY_POLICY, LAB_PILOT_KEY_POLICY, PERSONAL_KEY_POLICY, NativePlatformKeyProvider,
  browserEd25519Identity, evaluateKeyPolicy, requireKeyPolicy, requireWireCompatibility,
  type AttestationTrustDecision, type AttestationTrustStore, type AttestationVerifier,
  type NativeKeyBridge, type NativeKeyRecord,
} from "./index.ts";

describe("platform key policies", () => {
  it("labels a non-extractable browser key as software-protected", async () => {
    const pair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"]) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const identity = await browserEd25519Identity({ pub, priv: pair.privateKey }, "persistent");

    expect(evaluateKeyPolicy(identity, PERSONAL_KEY_POLICY).ok).toBe(true);
    expect(evaluateKeyPolicy(identity, LAB_PILOT_KEY_POLICY).ok).toBe(true);
    expect(evaluateKeyPolicy(identity, ENTERPRISE_KEY_POLICY)).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining([
        expect.stringContaining("algoritması"),
        "donanım destekli anahtar gerekli",
        "doğrulanmış platform anahtar kanıtı gerekli",
      ]),
    });
    expect(identity.securityLevel).toBe("software-protected");
    expect(identity.attestation.status).toBe("not-available");
    await expect(identity.sign(new Uint8Array([1, 2, 3]))).resolves.toHaveLength(64);
  });

  it("accepts verified P-256 hardware identity for enterprise", async () => {
    const record = p256Record();
    const bridge = mockBridge(record);
    const verifier: AttestationVerifier = {
      async verify(_record, challenge) {
        expect(challenge).toHaveLength(32);
        return { status: "verified", verifiedBy: "kionel-enrollment-v1", verifiedAt: "2026-08-03T12:00:00.000Z" };
      },
    };
    let stored: AttestationTrustDecision | undefined;
    const trustStore: AttestationTrustStore = {
      async get() { return stored },
      async put(decision) { stored = decision },
      async remove() { stored = undefined },
    };
    const provider = new NativePlatformKeyProvider(bridge, verifier, trustStore);
    const identity = await provider.provision({ alias: "lab-terminal-7", algorithm: "ecdsa-p256-sha256", requireUserPresence: true });

    expect(evaluateKeyPolicy(identity, ENTERPRISE_KEY_POLICY)).toEqual({ ok: true, reasons: [] });
    expect(stored?.publicKeySha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(identity.sign(new Uint8Array([9]))).resolves.toHaveLength(64);
    const loaded = await provider.load(record.keyId);
    expect(loaded?.attestation.status).toBe("verified");
    expect(() => requireKeyPolicy(loaded!, ENTERPRISE_KEY_POLICY)).not.toThrow();
  });

  it("fails closed when hardware attestation is not independently verified", async () => {
    const provider = new NativePlatformKeyProvider(mockBridge(p256Record()));
    const identity = await provider.provision({ alias: "terminal", algorithm: "ecdsa-p256-sha256", requireUserPresence: false });
    expect(identity.attestation.status).toBe("unverified");
    expect(() => requireKeyPolicy(identity, ENTERPRISE_KEY_POLICY)).toThrow("doğrulanmış platform anahtar kanıtı gerekli");
  });

  it("rejects an enrollment decision moved to different key material", async () => {
    const record = p256Record();
    const trustStore: AttestationTrustStore = {
      async get() {
        return {
          keyId: record.keyId,
          providerId: record.providerId,
          algorithm: record.algorithm,
          securityLevel: record.securityLevel,
          publicKeySha256: "00".repeat(32),
          result: { status: "verified", verifiedBy: "test", verifiedAt: "2026-08-03T12:00:00.000Z" },
        };
      },
      async put() {},
      async remove() {},
    };
    const provider = new NativePlatformKeyProvider(mockBridge(record), undefined, trustStore);
    await expect(provider.load(record.keyId)).rejects.toThrow("bu platform anahtarına bağlı değil");
  });

  it("rejects malformed native key material", async () => {
    const record = p256Record();
    record.publicKey = new Uint8Array(64);
    const provider = new NativePlatformKeyProvider(mockBridge(record));
    await expect(provider.provision({ alias: "bad", algorithm: "ecdsa-p256-sha256", requireUserPresence: false }))
      .rejects.toThrow("65 bayt");
  });

  it("prevents P-256 identity use on v1 and accepts it on v2", async () => {
    const identity = await new NativePlatformKeyProvider(mockBridge(p256Record())).provision({
      alias: "terminal", algorithm: "ecdsa-p256-sha256", requireUserPresence: false,
    });
    expect(() => requireWireCompatibility(identity, 1)).toThrow("v1 ed25519");
    expect(() => requireWireCompatibility(identity, 2)).not.toThrow();
  });
});

function p256Record(): NativeKeyRecord {
  const publicKey = new Uint8Array(65);
  publicKey[0] = 4;
  return {
    providerId: "test-secure-enclave",
    keyId: "native:test-key-1",
    algorithm: "ecdsa-p256-sha256",
    publicKey,
    securityLevel: "secure-enclave",
    persistence: "persistent",
    attestationEvidence: { format: "vendor-managed", certificateChain: ["test-leaf", "test-root"] },
  };
}

function mockBridge(record: NativeKeyRecord): NativeKeyBridge {
  return {
    async capabilities() {
      return { providerId: record.providerId, algorithms: [record.algorithm], securityLevels: [record.securityLevel], supportsAttestation: true };
    },
    async provision() { return record },
    async load(keyId) { return keyId === record.keyId ? record : undefined },
    async sign() { return new Uint8Array(64) },
    async remove() {},
  };
}
