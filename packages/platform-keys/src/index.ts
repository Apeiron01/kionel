// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * Kionel platform signing-key boundary.
 *
 * A non-extractable browser CryptoKey is useful protection, but it is not proof
 * that a key lives in a Secure Enclave, StrongBox, TEE or TPM. This module keeps
 * those claims separate and requires independently verified attestation before
 * an enterprise policy accepts a hardware-backed identity.
 */

export type KeyAlgorithm = "ed25519" | "ecdsa-p256-sha256";
export type KeySecurityLevel =
  | "software-protected"
  | "tee"
  | "strongbox"
  | "secure-enclave"
  | "tpm";
export type KeyPersistence = "session" | "persistent";
export type AttestationStatus = "not-available" | "unverified" | "verified" | "rejected";
export type AttestationFormat =
  | "android-key-attestation"
  | "apple-app-attest"
  | "windows-tpm"
  | "vendor-managed";

export interface AttestationEvidence {
  format: AttestationFormat;
  certificateChain: readonly string[];
  statement?: Uint8Array;
}

export interface AttestationResult {
  status: AttestationStatus;
  format?: AttestationFormat;
  verifiedBy?: string;
  verifiedAt?: string;
  reason?: string;
}

export interface PlatformSigningIdentity {
  providerId: string;
  keyId: string;
  algorithm: KeyAlgorithm;
  publicKey: Uint8Array;
  securityLevel: KeySecurityLevel;
  persistence: KeyPersistence;
  requiresUserPresence?: boolean;
  attestation: AttestationResult;
  sign(data: Uint8Array): Promise<Uint8Array>;
}

export interface KeyPolicy {
  name: string;
  allowedAlgorithms: readonly KeyAlgorithm[];
  requirePersistent: boolean;
  requireHardwareBacked: boolean;
  requireVerifiedAttestation: boolean;
  allowedProviders?: readonly string[];
}

export interface PolicyVerdict {
  ok: boolean;
  reasons: string[];
}

export const PERSONAL_KEY_POLICY: KeyPolicy = Object.freeze({
  name: "kionel-personal",
  allowedAlgorithms: ["ed25519", "ecdsa-p256-sha256"] as const,
  requirePersistent: false,
  requireHardwareBacked: false,
  requireVerifiedAttestation: false,
});

export const LAB_PILOT_KEY_POLICY: KeyPolicy = Object.freeze({
  name: "kionel-lab-pilot",
  allowedAlgorithms: ["ed25519", "ecdsa-p256-sha256"] as const,
  requirePersistent: true,
  requireHardwareBacked: false,
  requireVerifiedAttestation: false,
});

export const ENTERPRISE_KEY_POLICY: KeyPolicy = Object.freeze({
  name: "kionel-enterprise",
  allowedAlgorithms: ["ecdsa-p256-sha256"] as const,
  requirePersistent: true,
  requireHardwareBacked: true,
  requireVerifiedAttestation: true,
});

const HARDWARE_LEVELS = new Set<KeySecurityLevel>(["tee", "strongbox", "secure-enclave", "tpm"]);

export function evaluateKeyPolicy(identity: PlatformSigningIdentity, policy: KeyPolicy): PolicyVerdict {
  validateIdentity(identity);
  const reasons: string[] = [];
  if (!policy.allowedAlgorithms.includes(identity.algorithm)) {
    reasons.push(`${identity.algorithm} algoritması ${policy.name} politikası tarafından kabul edilmiyor`);
  }
  if (policy.requirePersistent && identity.persistence !== "persistent") {
    reasons.push("kalıcı cihaz anahtarı gerekli");
  }
  if (policy.requireHardwareBacked && !HARDWARE_LEVELS.has(identity.securityLevel)) {
    reasons.push("donanım destekli anahtar gerekli");
  }
  if (policy.requireVerifiedAttestation && identity.attestation.status !== "verified") {
    reasons.push("doğrulanmış platform anahtar kanıtı gerekli");
  }
  if (policy.allowedProviders && !policy.allowedProviders.includes(identity.providerId)) {
    reasons.push(`anahtar sağlayıcısı kabul edilmiyor: ${identity.providerId}`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function requireKeyPolicy(identity: PlatformSigningIdentity, policy: KeyPolicy): void {
  const verdict = evaluateKeyPolicy(identity, policy);
  if (!verdict.ok) throw new Error(`anahtar politikası başarısız (${policy.name}): ${verdict.reasons.join("; ")}`);
}

export interface LegacyEd25519Identity {
  pub: Uint8Array;
  priv: CryptoKey;
}

/** Browser keys are always reported as software-protected, even when non-extractable. */
export async function browserEd25519Identity(
  identity: LegacyEd25519Identity,
  persistence: KeyPersistence,
): Promise<PlatformSigningIdentity> {
  if (identity.pub.length !== 32) throw new Error("Ed25519 açık anahtarı 32 bayt olmalı");
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", owned(identity.pub)));
  return {
    providerId: "webcrypto",
    keyId: `webcrypto:${hex(digest.subarray(0, 16))}`,
    algorithm: "ed25519",
    publicKey: owned(identity.pub),
    securityLevel: "software-protected",
    persistence,
    requiresUserPresence: false,
    attestation: { status: "not-available" },
    async sign(data) {
      return new Uint8Array(await globalThis.crypto.subtle.sign("Ed25519", identity.priv, owned(data)));
    },
  };
}

export interface NativeKeyCapabilities {
  providerId: string;
  algorithms: readonly KeyAlgorithm[];
  securityLevels: readonly KeySecurityLevel[];
  supportsAttestation: boolean;
}

export interface NativeKeyRecord {
  providerId: string;
  keyId: string;
  algorithm: KeyAlgorithm;
  publicKey: Uint8Array;
  securityLevel: KeySecurityLevel;
  persistence: KeyPersistence;
  requiresUserPresence?: boolean;
  attestationEvidence?: AttestationEvidence;
}

export interface NativeProvisionRequest {
  alias: string;
  algorithm: "ecdsa-p256-sha256";
  requireUserPresence: boolean;
  attestationChallenge: Uint8Array;
}

/** Implemented by the signed native shell; private key material never crosses this bridge. */
export interface NativeKeyBridge {
  capabilities(): Promise<NativeKeyCapabilities>;
  provision(request: NativeProvisionRequest): Promise<NativeKeyRecord>;
  load(keyId: string): Promise<NativeKeyRecord | undefined>;
  sign(keyId: string, algorithm: KeyAlgorithm, data: Uint8Array): Promise<Uint8Array>;
  remove(keyId: string): Promise<void>;
}

/** Attestation verification belongs outside the client-controlled native bridge. */
export interface AttestationVerifier {
  verify(record: NativeKeyRecord, expectedChallenge: Uint8Array): Promise<AttestationResult>;
}

export interface AttestationTrustDecision {
  keyId: string;
  providerId: string;
  algorithm: KeyAlgorithm;
  securityLevel: KeySecurityLevel;
  requiresUserPresence?: boolean;
  publicKeySha256: string;
  result: AttestationResult;
}

/** Trusted enrollment state is checked against every security-relevant key field. */
export interface AttestationTrustStore {
  get(keyId: string): Promise<AttestationTrustDecision | undefined>;
  put(decision: AttestationTrustDecision): Promise<void>;
  remove(keyId: string): Promise<void>;
}

export class NativePlatformKeyProvider {
  readonly bridge: NativeKeyBridge;
  readonly verifier?: AttestationVerifier;
  readonly trustStore?: AttestationTrustStore;

  constructor(bridge: NativeKeyBridge, verifier?: AttestationVerifier, trustStore?: AttestationTrustStore) {
    this.bridge = bridge;
    this.verifier = verifier;
    this.trustStore = trustStore;
  }

  capabilities(): Promise<NativeKeyCapabilities> { return this.bridge.capabilities() }

  async provision(input: Omit<NativeProvisionRequest, "attestationChallenge">): Promise<PlatformSigningIdentity> {
    const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32));
    const record = await this.bridge.provision({ ...input, attestationChallenge: challenge });
    validateRecord(record);
    if (record.algorithm !== input.algorithm) throw new Error("native köprü istenmeyen algoritmada anahtar üretti");

    let attestation: AttestationResult = record.attestationEvidence
      ? { status: "unverified", format: record.attestationEvidence.format }
      : { status: "not-available" };
    if (record.attestationEvidence && this.verifier) {
      attestation = normalizeVerification(await this.verifier.verify(record, challenge), record.attestationEvidence.format);
      if (attestation.status === "verified") await this.trustStore?.put(await trustDecision(record, attestation));
    }
    return this.identity(record, attestation);
  }

  async load(keyId: string): Promise<PlatformSigningIdentity | undefined> {
    validateKeyId(keyId);
    const record = await this.bridge.load(keyId);
    if (!record) return undefined;
    validateRecord(record);
    const trusted = await this.trustStore?.get(record.keyId);
    if (trusted && !(await trustDecisionMatches(record, trusted))) {
      throw new Error("enrollment güven kaydı bu platform anahtarına bağlı değil");
    }
    const attestation = trusted
      ? normalizeVerification(trusted.result, record.attestationEvidence?.format)
      : record.attestationEvidence
        ? { status: "unverified" as const, format: record.attestationEvidence.format }
        : { status: "not-available" as const };
    return this.identity(record, attestation);
  }

  async remove(keyId: string): Promise<void> {
    validateKeyId(keyId);
    await this.bridge.remove(keyId);
    await this.trustStore?.remove(keyId);
  }

  private identity(record: NativeKeyRecord, attestation: AttestationResult): PlatformSigningIdentity {
    return {
      ...record,
      publicKey: owned(record.publicKey),
      attestation,
      sign: async (data) => {
        const signature = await this.bridge.sign(record.keyId, record.algorithm, owned(data));
        const expected = record.algorithm === "ed25519" ? 64 : 64;
        if (signature.length !== expected) throw new Error(`native imza ${expected} bayt olmalı`);
        return owned(signature);
      },
    };
  }
}

export const IMPLEMENTED_WIRE_VERSIONS: readonly (1 | 2)[] = Object.freeze([1, 2]);

/** Prevents P-256 platform identities from being mislabeled as v1 Ed25519 identities. */
export function requireWireCompatibility(identity: PlatformSigningIdentity, wireVersion: 1 | 2): void {
  const expected: KeyAlgorithm = wireVersion === 1 ? "ed25519" : "ecdsa-p256-sha256";
  if (identity.algorithm !== expected) {
    throw new Error(`Kionel v${wireVersion} ${expected} kimliği gerektiriyor; anahtar ${identity.algorithm}`);
  }
  if (!IMPLEMENTED_WIRE_VERSIONS.some((version) => version === wireVersion)) {
    throw new Error(`Kionel v${wireVersion} anahtar sözleşmesi tanımlı fakat wire uygulaması henüz mevcut değil`);
  }
}

function validateIdentity(identity: PlatformSigningIdentity): void {
  validateKeyId(identity.keyId);
  if (!identity.providerId || identity.providerId.length > 128) throw new Error("geçersiz anahtar sağlayıcısı");
  validatePublicKey(identity.algorithm, identity.publicKey);
  if (identity.requiresUserPresence !== undefined && typeof identity.requiresUserPresence !== "boolean") {
    throw new Error("geçersiz kullanıcı varlığı politikası");
  }
  if (identity.attestation.status === "verified") {
    if (!identity.attestation.verifiedBy || !validIsoDate(identity.attestation.verifiedAt)) {
      throw new Error("doğrulanmış anahtar kanıtında doğrulayıcı ve zaman zorunlu");
    }
  }
}

function validateRecord(record: NativeKeyRecord): void {
  validateKeyId(record.keyId);
  if (!record.providerId || record.providerId.length > 128) throw new Error("geçersiz native sağlayıcı");
  if (record.securityLevel === "software-protected") throw new Error("native donanım sağlayıcısı yazılım anahtarı döndürdü");
  if (record.persistence !== "persistent") throw new Error("native platform anahtarı kalıcı olmalı");
  if (record.requiresUserPresence !== undefined && typeof record.requiresUserPresence !== "boolean") {
    throw new Error("native kullanıcı varlığı politikası geçersiz");
  }
  validatePublicKey(record.algorithm, record.publicKey);
  const evidence = record.attestationEvidence;
  if (evidence && (evidence.certificateChain.length === 0 || evidence.certificateChain.length > 12)) {
    throw new Error("platform kanıtı sertifika zinciri 1..12 öğe olmalı");
  }
}

function validatePublicKey(algorithm: KeyAlgorithm, key: Uint8Array): void {
  if (algorithm === "ed25519" && key.length !== 32) throw new Error("Ed25519 açık anahtarı 32 bayt olmalı");
  if (algorithm === "ecdsa-p256-sha256" && (key.length !== 65 || key[0] !== 4)) {
    throw new Error("P-256 açık anahtarı 65 bayt sıkıştırılmamış SEC1 biçiminde olmalı");
  }
}

function normalizeVerification(result: AttestationResult, format?: AttestationFormat): AttestationResult {
  if (result.status !== "verified" && result.status !== "rejected") {
    throw new Error("harici kanıt doğrulayıcı yalnızca verified veya rejected döndürebilir");
  }
  const normalized = { ...result, format: result.format ?? format };
  if (normalized.status === "verified" && (!normalized.verifiedBy || !validIsoDate(normalized.verifiedAt))) {
    throw new Error("doğrulayıcı kararı kimlik ve ISO zaman damgası içermeli");
  }
  return normalized;
}

function validIsoDate(value?: string): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return Number.isFinite(Date.parse(value));
}

async function trustDecision(record: NativeKeyRecord, result: AttestationResult): Promise<AttestationTrustDecision> {
  return {
    keyId: record.keyId,
    providerId: record.providerId,
    algorithm: record.algorithm,
    securityLevel: record.securityLevel,
    requiresUserPresence: record.requiresUserPresence,
    publicKeySha256: hex(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", owned(record.publicKey)))),
    result: { ...result },
  };
}

async function trustDecisionMatches(record: NativeKeyRecord, decision: AttestationTrustDecision): Promise<boolean> {
  const expected = await trustDecision(record, decision.result);
  return expected.keyId === decision.keyId &&
    expected.providerId === decision.providerId &&
    expected.algorithm === decision.algorithm &&
    expected.securityLevel === decision.securityLevel &&
    expected.requiresUserPresence === decision.requiresUserPresence &&
    expected.publicKeySha256 === decision.publicKeySha256;
}

function validateKeyId(keyId: string): void {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(keyId)) throw new Error("geçersiz platform keyId");
}

function owned(value: Uint8Array): Uint8Array<ArrayBuffer> { return new Uint8Array(value) }
function hex(value: Uint8Array): string { return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("") }
