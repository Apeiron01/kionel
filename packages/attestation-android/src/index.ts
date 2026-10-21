/**
 * Android Keystore / StrongBox key attestation verifier.
 *
 * Runs on the enrollment side. Unlike the Windows TPM path, the producing side
 * needs no special machine: any Android device with StrongBox emits a chain
 * that terminates at Google's published hardware attestation root.
 *
 * What it proves: the P-256 key was generated inside the device's secure
 * hardware, has never left it, is restricted to signing, was created against
 * this enrollment's one-time challenge, and the device booted verified with a
 * locked bootloader.
 * What it does NOT prove: that the app holding the key is uncompromised at
 * runtime, or that the user is who the enterprise thinks they are.
 */
import { X509Certificate } from "node:crypto";
import type {
  AttestationResult, AttestationVerifier, KeySecurityLevel, NativeKeyRecord,
} from "@kionel/platform-keys";
import {
  DerError, findExtension, parseAnchors, sec1PublicKey, validateCertificateChain, type CertificateInput,
} from "@kionel/attestation-core";
import {
  ATTESTATION_OID, Digest, EcCurve, KeyAlgorithm, KeyOrigin, KeyPurpose, SecurityLevel,
  VerifiedBootState, parseKeyDescription, type AuthorizationList, type KeyDescription,
} from "./key-description.ts";
import {
  normalizeSerial, revocationStatusReason, validateRevocationSnapshot, type AndroidRevocationSnapshot,
} from "./status-list.ts";

export * from "./key-description.ts";
export * from "./status-list.ts";
export * from "./trust-material.ts";

export type HardwareLevel = "tee" | "strongbox";

export interface AndroidAttestationPolicy {
  /** Recorded in the trust decision so a bad verifier release can be traced. */
  verifierId: string;
  /**
   * Google hardware attestation roots, in PEM or DER. Empty rejects everything:
   * without a pinned root any self-made chain would verify against itself.
   */
  trustAnchors: readonly CertificateInput[];
  /** Lowest acceptable hardware level. StrongBox is a discrete secure element; TEE is not. */
  minimumSecurityLevel?: HardwareLevel;
  /**
   * Google's status list, fetched by trusted control-plane code and supplied
   * offline. Verification fails closed when this snapshot is absent or stale.
   */
  revocationStatus: AndroidRevocationSnapshot;
  /**
   * Expected `attestationApplicationId` bytes. Note this field lives in
   * softwareEnforced: Android's keystore daemon fills it, not the secure
   * hardware. Useful defence in depth, not a hardware guarantee.
   */
  expectedApplicationId?: Uint8Array;
  /** Default true: reject unlocked bootloaders and non-verified boot states. */
  requireVerifiedBoot?: boolean;
  maxChainLength?: number;
  now?: () => Date;
}

const LEVEL_RANK: Record<HardwareLevel, number> = { tee: SecurityLevel.TrustedEnvironment, strongbox: SecurityLevel.StrongBox };
const RECORD_LEVEL: Partial<Record<KeySecurityLevel, number>> = {
  tee: SecurityLevel.TrustedEnvironment,
  strongbox: SecurityLevel.StrongBox,
};

export class AndroidKeyAttestationVerifier implements AttestationVerifier {
  readonly policy: Readonly<AndroidAttestationPolicy>;
  private readonly anchors: X509Certificate[];
  private readonly revocationStatus: AndroidRevocationSnapshot;
  private readonly expectedApplicationId?: Uint8Array;

  constructor(policy: AndroidAttestationPolicy) {
    if (!/^[a-z0-9][a-z0-9._/-]{2,63}$/.test(policy.verifierId)) throw new Error("verifierId geçersiz");
    const maxChainLength = policy.maxChainLength ?? 6;
    if (!Number.isSafeInteger(maxChainLength) || maxChainLength < 1 || maxChainLength > 12) {
      throw new Error("attestation zinciri sınırı 1..12 olmalı");
    }
    validateRevocationSnapshot(policy.revocationStatus);
    this.revocationStatus = {
      ...policy.revocationStatus,
      blockedSerials: new Set(policy.revocationStatus.blockedSerials),
    };
    this.expectedApplicationId = policy.expectedApplicationId
      ? new Uint8Array(policy.expectedApplicationId)
      : undefined;
    this.policy = Object.freeze({
      minimumSecurityLevel: "strongbox",
      requireVerifiedBoot: true,
      ...policy,
      trustAnchors: Object.freeze([...policy.trustAnchors]),
      revocationStatus: {
        ...this.revocationStatus,
        blockedSerials: new Set(this.revocationStatus.blockedSerials),
      },
      expectedApplicationId: this.expectedApplicationId,
      maxChainLength,
    });
    this.anchors = parseAnchors(policy.trustAnchors);
  }

  async verify(record: NativeKeyRecord, expectedChallenge: Uint8Array): Promise<AttestationResult> {
    const now = this.policy.now?.() ?? new Date();
    try {
      const reason = this.check(record, expectedChallenge, now);
      if (reason) return rejected(reason);
    } catch (error) {
      // Fail closed: anything that will not parse is not evidence.
      return rejected(error instanceof DerError ? error.code : "verifier-error");
    }
    return {
      status: "verified",
      format: "android-key-attestation",
      verifiedBy: this.policy.verifierId,
      verifiedAt: `${now.toISOString().slice(0, 19)}Z`,
    };
  }

  private check(record: NativeKeyRecord, expectedChallenge: Uint8Array, now: Date): string | undefined {
    if (expectedChallenge.length < 16 || expectedChallenge.length > 64) return "challenge-size";
    if (record.persistence !== "persistent") return "key-not-persistent";
    const required = LEVEL_RANK[this.policy.minimumSecurityLevel!];
    const claimed = RECORD_LEVEL[record.securityLevel];
    if (claimed === undefined || claimed < required) return "insufficient-security-level";

    const evidence = record.attestationEvidence;
    if (!evidence || evidence.format !== "android-key-attestation") return "missing-android-evidence";

    if (evidence.certificateChain.length > this.policy.maxChainLength!) return "chain-too-long";

    // Android does not guarantee that the trusted attestation extension is in
    // the supplied leaf. Walk from the root side and use only the first
    // occurrence; attacker-prepended certificates cannot choose the device key.
    let supplied: X509Certificate[];
    try {
      supplied = evidence.certificateChain.map((value) => new X509Certificate(value));
    } catch {
      return "certificate-parse-failed";
    }
    let attestationIndex = -1;
    let extension: Uint8Array | undefined;
    for (let index = supplied.length - 1; index >= 0; index--) {
      const candidate = findExtension(new Uint8Array(supplied[index].raw), ATTESTATION_OID);
      if (candidate) {
        attestationIndex = index;
        extension = candidate;
        break;
      }
    }
    if (attestationIndex < 0 || !extension) return "missing-attestation-extension";

    const chain = validateCertificateChain(evidence.certificateChain.slice(attestationIndex), {
      anchors: this.anchors,
      now,
      maxLength: this.policy.maxChainLength!,
    });
    if (!chain.ok) return chain.reason;

    const statusReason = revocationStatusReason(this.revocationStatus, now);
    if (statusReason) return statusReason;
    if (chain.chain.some((cert) => this.revocationStatus.blockedSerials.has(normalizeSerial(cert.serialNumber)))) {
      return "attestation-key-revoked";
    }

    // chain.leaf is now the certificate carrying the trusted extension.
    const leafKey = sec1PublicKey(chain.leaf);
    if (!leafKey) return "attested-key-not-p256";
    if (!sameBytes(leafKey, record.publicKey)) return "public-key-mismatch";
    return this.checkKeyDescription(parseKeyDescription(extension), expectedChallenge, claimed);
  }

  /** Exported behaviour, tested directly: every property below is a rejection reason. */
  checkKeyDescription(kd: KeyDescription, expectedChallenge: Uint8Array, claimedLevel: number): string | undefined {
    const required = LEVEL_RANK[this.policy.minimumSecurityLevel!];
    if (!sameBytes(kd.attestationChallenge, expectedChallenge)) return "challenge-mismatch";
    if (kd.attestationSecurityLevel < required || kd.keymasterSecurityLevel < required) return "attestation-level-too-low";
    // A record claiming StrongBox while the hardware only signed for TEE is a lie.
    if (kd.keymasterSecurityLevel < claimedLevel) return "security-level-overclaimed";

    // Everything that matters must be hardware-enforced. Properties a compromised
    // Android userspace can write live in softwareEnforced and are never trusted.
    const tee = kd.teeEnforced;
    if (tee.origin !== KeyOrigin.Generated) return "key-not-generated-in-hardware";
    if (tee.algorithm !== KeyAlgorithm.Ec) return "key-not-ec";
    if (tee.keySize !== 256 || tee.ecCurve !== EcCurve.P256) return "key-not-p256";
    if (!tee.purpose || tee.purpose.length !== 1 || tee.purpose[0] !== KeyPurpose.Sign) return "key-purpose-not-sign-only";
    if (!tee.digest?.includes(Digest.Sha2_256)) return "key-digest-not-sha256";
    if (tee.allApplications || kd.softwareEnforced.allApplications) return "key-shared-with-all-apps";

    if (this.policy.requireVerifiedBoot) {
      const root = tee.rootOfTrust;
      if (!root) return "missing-root-of-trust";
      if (!root.deviceLocked) return "bootloader-unlocked";
      if (root.verifiedBootState !== VerifiedBootState.Verified) return "boot-state-not-verified";
    }

    const expectedApp = this.expectedApplicationId;
    if (expectedApp) {
      const actual = appId(kd.softwareEnforced) ?? appId(tee);
      if (!actual || !sameBytes(actual, expectedApp)) return "application-id-mismatch";
    }
    return undefined;
  }
}

function appId(list: AuthorizationList): Uint8Array | undefined {
  return list.attestationApplicationId;
}

function rejected(reason: string): AttestationResult {
  return { status: "rejected", format: "android-key-attestation", reason };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
