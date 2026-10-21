/**
 * Windows TPM remote key attestation verifier.
 *
 * This runs on the enrollment side, never inside the client's native host: the
 * host is the thing being attested, so it cannot be the thing that decides the
 * attestation passed. The verifier re-derives every binding itself —
 * challenge, key name, key attributes, AIK chain — and fails closed on
 * anything it cannot prove.
 *
 * What it proves: the certified P-256 public key was created inside a TPM whose
 * AIK chains to a configured trust anchor, cannot be exported, and was certified
 * against this enrollment's one-time challenge.
 * What it does NOT prove: that the local machine is otherwise trustworthy, or
 * that the caller of the native host is the application you think it is.
 */
import { X509Certificate, createHash, verify as verifySignature } from "node:crypto";
import type { AttestationResult, AttestationVerifier, NativeKeyRecord } from "@kionel/platform-keys";
import { parseAnchors, validateCertificateChain } from "@kionel/attestation-core";
import {
  TpmAlg, TpmParseError, parseAttest, parseEccPublic, parseSignature, requireDeviceKeyAttributes,
} from "./tpm.ts";

export * from "./tpm.ts";

const STATEMENT_MAGIC = "KIONTPM1";
const STATEMENT_HEADER = 14;
const MAX_BLOB = 8192;

export interface WindowsAttestationStatement {
  /** TPMS_ATTEST produced by TPM2_Certify. */
  certifyInfo: Uint8Array;
  /** TPMT_SIGNATURE over certifyInfo, made by the AIK. */
  signature: Uint8Array;
  /** TPMT_PUBLIC of the certified device key. */
  pubArea: Uint8Array;
}

export function encodeAttestationStatement(s: WindowsAttestationStatement): Uint8Array {
  for (const [name, blob] of Object.entries(s)) {
    if (blob.length === 0 || blob.length > MAX_BLOB) throw new TpmParseError("invalid-blob", `${name} must be 1..${MAX_BLOB} bytes`);
  }
  const out = new Uint8Array(STATEMENT_HEADER + s.certifyInfo.length + s.signature.length + s.pubArea.length);
  out.set(new TextEncoder().encode(STATEMENT_MAGIC));
  const view = new DataView(out.buffer);
  view.setUint16(8, s.certifyInfo.length);
  view.setUint16(10, s.signature.length);
  view.setUint16(12, s.pubArea.length);
  out.set(s.certifyInfo, STATEMENT_HEADER);
  out.set(s.signature, STATEMENT_HEADER + s.certifyInfo.length);
  out.set(s.pubArea, STATEMENT_HEADER + s.certifyInfo.length + s.signature.length);
  return out;
}

export function decodeAttestationStatement(bytes: Uint8Array): WindowsAttestationStatement {
  if (bytes.length < STATEMENT_HEADER) throw new TpmParseError("truncated", "attestation statement is truncated");
  if (new TextDecoder().decode(bytes.subarray(0, 8)) !== STATEMENT_MAGIC) {
    throw new TpmParseError("bad-magic", "attestation statement magic does not match");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lengths = [view.getUint16(8), view.getUint16(10), view.getUint16(12)];
  if (lengths.some((n) => n === 0 || n > MAX_BLOB)) throw new TpmParseError("invalid-blob", "attestation statement declares an invalid blob length");
  if (STATEMENT_HEADER + lengths[0] + lengths[1] + lengths[2] !== bytes.length) {
    throw new TpmParseError("length-mismatch", "attestation statement length does not match its header");
  }
  let at = STATEMENT_HEADER;
  const slice = (n: number) => bytes.subarray(at, (at += n));
  return { certifyInfo: slice(lengths[0]), signature: slice(lengths[1]), pubArea: slice(lengths[2]) };
}

export interface WindowsAttestationPolicy {
  /** Recorded in the trust decision so a bad verifier release can be traced. */
  verifierId: string;
  /** PEM roots for the TPM vendor or enterprise attestation CA. Empty = every attestation is rejected. */
  trustAnchorsPem: readonly string[];
  maxChainLength?: number;
  /** Reject keys that do not force Windows user interaction on every use. */
  requireUserPresence?: boolean;
  now?: () => Date;
}

export class WindowsTpmAttestationVerifier implements AttestationVerifier {
  readonly policy: WindowsAttestationPolicy;
  private readonly anchors: X509Certificate[];

  constructor(policy: WindowsAttestationPolicy) {
    if (!/^[a-z0-9][a-z0-9._/-]{2,63}$/.test(policy.verifierId)) throw new Error("verifierId geçersiz");
    const maxChainLength = policy.maxChainLength ?? 6;
    if (!Number.isSafeInteger(maxChainLength) || maxChainLength < 1 || maxChainLength > 12) {
      throw new Error("attestation zinciri sınırı 1..12 olmalı");
    }
    this.policy = { ...policy, maxChainLength };
    this.anchors = parseAnchors(policy.trustAnchorsPem);
  }

  async verify(record: NativeKeyRecord, expectedChallenge: Uint8Array): Promise<AttestationResult> {
    const now = this.policy.now?.() ?? new Date();
    try {
      const reason = this.check(record, expectedChallenge, now);
      if (reason) return rejected(reason);
    } catch (error) {
      // Fail closed: an unparsed blob is an untrusted blob.
      return rejected(error instanceof TpmParseError ? error.code : "verifier-error");
    }
    return {
      status: "verified",
      format: "windows-tpm",
      verifiedBy: this.policy.verifierId,
      verifiedAt: isoSeconds(now),
    };
  }

  /** Returns a rejection reason, or undefined when every binding holds. */
  private check(record: NativeKeyRecord, expectedChallenge: Uint8Array, now: Date): string | undefined {
    if (expectedChallenge.length !== 32) return "challenge-size";
    if (record.securityLevel !== "tpm") return "not-a-tpm-key";
    if (record.persistence !== "persistent") return "key-not-persistent";
    if (this.policy.requireUserPresence && record.requiresUserPresence !== true) return "user-presence-required";

    const evidence = record.attestationEvidence;
    if (!evidence || evidence.format !== "windows-tpm") return "missing-windows-tpm-evidence";
    if (!evidence.statement) return "missing-attestation-statement";
    if (this.anchors.length === 0) return "no-trust-anchor-configured";
    if (evidence.certificateChain.length > this.policy.maxChainLength!) return "chain-too-long";

    const { certifyInfo, signature, pubArea } = decodeAttestationStatement(evidence.statement);

    // 1. The certified key must be a non-exportable P-256 signing key...
    const pub = parseEccPublic(pubArea);
    requireDeviceKeyAttributes(pub.attributes);
    // ...and must be the exact key the record claims.
    if (!sameBytes(pub.sec1, record.publicKey)) return "public-key-mismatch";

    // 2. TPM2_Certify must name that key and carry this enrollment's challenge.
    const attest = parseAttest(certifyInfo);
    if (!sameBytes(attest.extraData, expectedChallenge)) return "challenge-mismatch";
    const expectedName = tpmName(pubArea);
    if (!sameBytes(attest.certifiedName, expectedName)) return "certified-name-mismatch";

    // 3. The AIK must chain to an anchor we configured, not one the client supplied.
    const chain = validateCertificateChain(evidence.certificateChain, {
      anchors: this.anchors,
      now,
      maxLength: this.policy.maxChainLength!,
    });
    if (!chain.ok) return chain.reason;

    // 4. The AIK must actually have signed this attestation.
    if (!verifyTpmSignature(certifyInfo, signature, chain.leaf)) return "attestation-signature-invalid";
    return undefined;
  }
}

/** TPM2B_NAME = nameAlg || digest(pubArea). Binds the attestation to one exact key blob. */
export function tpmName(pubArea: Uint8Array): Uint8Array {
  const digest = createHash("sha256").update(pubArea).digest();
  const name = new Uint8Array(2 + digest.length);
  new DataView(name.buffer).setUint16(0, TpmAlg.Sha256);
  name.set(digest, 2);
  return name;
}

function verifyTpmSignature(certifyInfo: Uint8Array, signature: Uint8Array, aik: X509Certificate): boolean {
  const parsed = parseSignature(signature);
  const key = aik.publicKey; // already a KeyObject; re-wrapping it throws
  if (parsed.alg === "ecdsa") {
    if (key.asymmetricKeyType !== "ec") return false;
    const rs = new Uint8Array(64);
    rs.set(parsed.r, 32 - parsed.r.length);
    rs.set(parsed.s, 64 - parsed.s.length);
    return verifySignature("sha256", certifyInfo, { key, dsaEncoding: "ieee-p1363" }, rs);
  }
  if (key.asymmetricKeyType !== "rsa") return false;
  return verifySignature("sha256", certifyInfo, key, parsed.sig);
}

function rejected(reason: string): AttestationResult {
  return { status: "rejected", format: "windows-tpm", reason };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function isoSeconds(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}
