/**
 * Android key attestation extension (OID 1.3.6.1.4.1.11129.2.1.17).
 *
 * The leaf certificate of a Keystore attestation chain carries a KeyDescription
 * describing how the key was created and what the hardware will allow it to do.
 * The single most important thing this file exposes is the split between
 * `softwareEnforced` and `teeEnforced`: only the latter is guaranteed by the
 * secure hardware. A verifier that reads a property from the wrong list is
 * trusting the very software the attestation exists to distrust.
 */
import {
  DerClass, DerError, DerReader, asBoolean, asEnumerated, asInteger, asIntegerSet,
  asOctetString, explicit, oidBytes, sequenceReader, type DerTlv,
} from "@kionel/attestation-core";

export const ATTESTATION_OID = oidBytes("1.3.6.1.4.1.11129.2.1.17");

export const SecurityLevel = { Software: 0, TrustedEnvironment: 1, StrongBox: 2 } as const;
export const KeyOrigin = { Generated: 0, Derived: 1, Imported: 2, Unknown: 3 } as const;
export const VerifiedBootState = { Verified: 0, SelfSigned: 1, Unverified: 2, Failed: 3 } as const;
export const KeyPurpose = { Encrypt: 0, Decrypt: 1, Sign: 2, Verify: 3 } as const;
export const KeyAlgorithm = { Rsa: 1, Ec: 3 } as const;
export const EcCurve = { P224: 0, P256: 1, P384: 2, P521: 3 } as const;
export const Digest = { None: 0, Sha1: 2, Sha2_224: 3, Sha2_256: 4 } as const;

/** AuthorizationList tags used by the enterprise policy. */
const Tag = {
  Purpose: 1, Algorithm: 2, KeySize: 3, Digest: 5, EcCurve: 10,
  NoAuthRequired: 503, AllApplications: 600, Origin: 702, RootOfTrust: 704,
  OsVersion: 705, OsPatchLevel: 706, AttestationApplicationId: 709,
} as const;

export interface RootOfTrust {
  verifiedBootKey: Uint8Array;
  deviceLocked: boolean;
  verifiedBootState: number;
  verifiedBootHash?: Uint8Array;
}

export interface AuthorizationList {
  purpose?: number[];
  algorithm?: number;
  keySize?: number;
  digest?: number[];
  ecCurve?: number;
  origin?: number;
  osVersion?: number;
  osPatchLevel?: number;
  noAuthRequired: boolean;
  /** Tag 600. Present means any app on the device may use the key. */
  allApplications: boolean;
  attestationApplicationId?: Uint8Array;
  rootOfTrust?: RootOfTrust;
}

export interface KeyDescription {
  attestationVersion: number;
  attestationSecurityLevel: number;
  keymasterVersion: number;
  keymasterSecurityLevel: number;
  attestationChallenge: Uint8Array;
  uniqueId: Uint8Array;
  softwareEnforced: AuthorizationList;
  teeEnforced: AuthorizationList;
}

export function parseKeyDescription(der: Uint8Array): KeyDescription {
  const root = new DerReader(der, "KeyDescription");
  const fields = sequenceReader(root.next(), "KeyDescription");
  root.end();

  const description: KeyDescription = {
    attestationVersion: asInteger(fields.next(), "attestationVersion"),
    attestationSecurityLevel: asEnumerated(fields.next(), "attestationSecurityLevel"),
    keymasterVersion: asInteger(fields.next(), "keymasterVersion"),
    keymasterSecurityLevel: asEnumerated(fields.next(), "keymasterSecurityLevel"),
    attestationChallenge: asOctetString(fields.next(), "attestationChallenge"),
    uniqueId: asOctetString(fields.next(), "uniqueId"),
    softwareEnforced: parseAuthorizationList(fields.next(), "softwareEnforced"),
    teeEnforced: parseAuthorizationList(fields.next(), "teeEnforced"),
  };
  fields.end();

  for (const level of [description.attestationSecurityLevel, description.keymasterSecurityLevel]) {
    if (level > SecurityLevel.StrongBox) throw new DerError("unknown-security-level", "unknown attestation security level");
  }
  return description;
}

function parseAuthorizationList(tlv: DerTlv, what: string): AuthorizationList {
  const reader = sequenceReader(tlv, what);
  const list: AuthorizationList = { noAuthRequired: false, allApplications: false };
  let previous = -1;

  while (!reader.atEnd) {
    const field = reader.next();
    if (field.tagClass !== DerClass.Context || !field.constructed) {
      throw new DerError("unexpected-tag", `${what} contains a non-context field`);
    }
    // DER SEQUENCE fields are ordered; repeats would let a forger shadow a value.
    if (field.tag <= previous) throw new DerError("unordered-authorization", `${what} tags are out of order or repeated`);
    previous = field.tag;

    switch (field.tag) {
      case Tag.Purpose: list.purpose = asIntegerSet(explicit(field, what), what); break;
      case Tag.Algorithm: list.algorithm = asInteger(explicit(field, what), what); break;
      case Tag.KeySize: list.keySize = asInteger(explicit(field, what), what); break;
      case Tag.Digest: list.digest = asIntegerSet(explicit(field, what), what); break;
      case Tag.EcCurve: list.ecCurve = asInteger(explicit(field, what), what); break;
      case Tag.NoAuthRequired: list.noAuthRequired = true; break;
      case Tag.AllApplications: list.allApplications = true; break;
      case Tag.Origin: list.origin = asInteger(explicit(field, what), what); break;
      case Tag.OsVersion: list.osVersion = asInteger(explicit(field, what), what); break;
      case Tag.OsPatchLevel: list.osPatchLevel = asInteger(explicit(field, what), what); break;
      case Tag.AttestationApplicationId: list.attestationApplicationId = asOctetString(explicit(field, what), what); break;
      case Tag.RootOfTrust: list.rootOfTrust = parseRootOfTrust(explicit(field, what)); break;
      default: break; // unknown authorizations are ignored, never trusted
    }
  }
  return list;
}

function parseRootOfTrust(tlv: DerTlv): RootOfTrust {
  const reader = sequenceReader(tlv, "RootOfTrust");
  const rootOfTrust: RootOfTrust = {
    verifiedBootKey: asOctetString(reader.next(), "verifiedBootKey"),
    deviceLocked: asBoolean(reader.next(), "deviceLocked"),
    verifiedBootState: asEnumerated(reader.next(), "verifiedBootState"),
  };
  if (!reader.atEnd) rootOfTrust.verifiedBootHash = asOctetString(reader.next(), "verifiedBootHash");
  reader.end();
  if (rootOfTrust.verifiedBootState > VerifiedBootState.Failed) {
    throw new DerError("unknown-boot-state", "unknown verified boot state");
  }
  return rootOfTrust;
}
