/**
 * TPM 2.0 structure parsing for remote key attestation.
 *
 * Only the structures a key-certification verifier needs are implemented, and
 * every field is bounds-checked. A parser that guesses is a parser that can be
 * fed a forged blob, so unknown algorithms, trailing bytes and out-of-range
 * lengths are hard failures rather than defaults.
 *
 * Reference: TCG TPM 2.0 Structures, Part 2 (TPMS_ATTEST, TPMT_PUBLIC,
 * TPMT_SIGNATURE). Same wire shapes WebAuthn uses for its "tpm" statement.
 */

export const TPM_GENERATED_VALUE = 0xff544347;
export const TPM_ST_ATTEST_CERTIFY = 0x8017;

export const TpmAlg = {
  Rsa: 0x0001,
  Sha256: 0x000b,
  Null: 0x0010,
  Rsassa: 0x0014,
  Ecdsa: 0x0018,
  Ecc: 0x0023,
} as const;

export const TPM_ECC_NIST_P256 = 0x0003;

/** TPMA_OBJECT bits that decide whether a key can ever leave its TPM. */
export const ObjectAttr = {
  FixedTpm: 1 << 1,
  StClear: 1 << 2,
  FixedParent: 1 << 4,
  SensitiveDataOrigin: 1 << 5,
  UserWithAuth: 1 << 6,
  AdminWithPolicy: 1 << 7,
  NoDa: 1 << 10,
  EncryptedDuplication: 1 << 12,
  Restricted: 1 << 16,
  Decrypt: 1 << 17,
  Sign: 1 << 18,
} as const;

export class TpmParseError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TpmParseError";
  }
}

class Reader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private pos = 0;

  constructor(bytes: Uint8Array, private readonly what: string) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private need(count: number): number {
    if (count < 0 || this.pos + count > this.bytes.length) {
      throw new TpmParseError("truncated", `${this.what} is truncated`);
    }
    const at = this.pos;
    this.pos += count;
    return at;
  }

  u16(): number { return this.view.getUint16(this.need(2)) }
  u32(): number { return this.view.getUint32(this.need(4)) }
  u64(): bigint { return this.view.getBigUint64(this.need(8)) }
  u8(): number { return this.bytes[this.need(1)] }
  take(count: number): Uint8Array { return this.bytes.subarray(this.need(count), this.pos) }

  /** TPM2B_*: 16-bit length prefix. */
  sized(limit: number): Uint8Array {
    const size = this.u16();
    if (size > limit) throw new TpmParseError("oversized-field", `${this.what} contains an oversized ${size}-byte field`);
    return this.take(size);
  }

  end(): void {
    if (this.pos !== this.bytes.length) {
      throw new TpmParseError("trailing-bytes", `${this.what} has ${this.bytes.length - this.pos} trailing bytes`);
    }
  }
}

export interface TpmAttest {
  /** TPM2B_NAME of the AIK that signed this attestation. */
  qualifiedSigner: Uint8Array;
  /** Must carry the enrollment challenge; this is what stops replay. */
  extraData: Uint8Array;
  /** TPM2B_NAME of the certified key: nameAlg || digest(pubArea). */
  certifiedName: Uint8Array;
  certifiedQualifiedName: Uint8Array;
  firmwareVersion: bigint;
  resetCount: number;
  restartCount: number;
}

export function parseAttest(bytes: Uint8Array): TpmAttest {
  const r = new Reader(bytes, "TPMS_ATTEST");
  if (r.u32() !== TPM_GENERATED_VALUE) {
    throw new TpmParseError("not-tpm-generated", "attestation blob does not start with TPM_GENERATED_VALUE");
  }
  if (r.u16() !== TPM_ST_ATTEST_CERTIFY) {
    throw new TpmParseError("wrong-attest-type", "attestation is not a TPM2_Certify statement");
  }
  const qualifiedSigner = r.sized(128);
  const extraData = r.sized(256);
  r.u64();                       // clock
  const resetCount = r.u32();
  const restartCount = r.u32();
  r.u8();                        // safe
  const firmwareVersion = r.u64();
  const certifiedName = r.sized(128);
  const certifiedQualifiedName = r.sized(128);
  r.end();
  return { qualifiedSigner, extraData, certifiedName, certifiedQualifiedName, firmwareVersion, resetCount, restartCount };
}

export interface TpmEccPublic {
  nameAlg: number;
  attributes: number;
  /** Uncompressed SEC1 point rebuilt from the TPM's x/y. */
  sec1: Uint8Array;
}

/**
 * Parses TPMT_PUBLIC restricted to the one shape Kionel provisions: a P-256
 * ECDSA-SHA256 signing key. Any other object type is rejected rather than
 * described, because the verifier must not accept a key it cannot reason about.
 */
export function parseEccPublic(bytes: Uint8Array): TpmEccPublic {
  const r = new Reader(bytes, "TPMT_PUBLIC");
  if (r.u16() !== TpmAlg.Ecc) throw new TpmParseError("not-ecc", "certified key is not an ECC object");
  const nameAlg = r.u16();
  if (nameAlg !== TpmAlg.Sha256) throw new TpmParseError("unsupported-name-alg", "only SHA-256 key names are accepted");
  const attributes = r.u32();
  r.sized(64); // authPolicy

  if (r.u16() !== TpmAlg.Null) throw new TpmParseError("unexpected-symmetric", "signing key declares a symmetric algorithm");
  if (r.u16() !== TpmAlg.Ecdsa) throw new TpmParseError("unsupported-scheme", "certified key scheme is not ECDSA");
  if (r.u16() !== TpmAlg.Sha256) throw new TpmParseError("unsupported-scheme-hash", "certified key scheme hash is not SHA-256");
  if (r.u16() !== TPM_ECC_NIST_P256) throw new TpmParseError("unsupported-curve", "certified key curve is not NIST P-256");
  if (r.u16() !== TpmAlg.Null) throw new TpmParseError("unexpected-kdf", "signing key declares a KDF");

  const x = r.sized(32);
  const y = r.sized(32);
  r.end();

  const sec1 = new Uint8Array(65);
  sec1[0] = 4;
  sec1.set(x, 33 - x.length); // TPM may drop leading zeros; left-pad into place
  sec1.set(y, 65 - y.length);
  return { nameAlg, attributes, sec1 };
}

export type TpmSignature =
  | { alg: "ecdsa"; hashAlg: number; r: Uint8Array; s: Uint8Array }
  | { alg: "rsassa"; hashAlg: number; sig: Uint8Array };

export function parseSignature(bytes: Uint8Array): TpmSignature {
  const reader = new Reader(bytes, "TPMT_SIGNATURE");
  const alg = reader.u16();
  const hashAlg = reader.u16();
  if (hashAlg !== TpmAlg.Sha256) throw new TpmParseError("unsupported-signature-hash", "attestation signature hash is not SHA-256");
  if (alg === TpmAlg.Ecdsa) {
    const r = reader.sized(32);
    const s = reader.sized(32);
    reader.end();
    return { alg: "ecdsa", hashAlg, r, s };
  }
  if (alg === TpmAlg.Rsassa) {
    const sig = reader.sized(1024);
    reader.end();
    return { alg: "rsassa", hashAlg, sig };
  }
  throw new TpmParseError("unsupported-signature-alg", "attestation signature algorithm is not ECDSA or RSASSA");
}

/**
 * Attributes a Kionel enterprise device key must carry. `fixedTPM` + `fixedParent`
 * + `sensitiveDataOrigin` is what "the private key was born in this TPM and
 * cannot leave it" actually means on the wire.
 */
export function requireDeviceKeyAttributes(attributes: number): void {
  const required = ObjectAttr.FixedTpm | ObjectAttr.FixedParent | ObjectAttr.SensitiveDataOrigin | ObjectAttr.Sign;
  const forbidden = ObjectAttr.Restricted | ObjectAttr.Decrypt | ObjectAttr.EncryptedDuplication | ObjectAttr.StClear;
  const missing = required & ~attributes;
  if (missing !== 0) {
    throw new TpmParseError("weak-key-attributes", `certified key is missing TPMA_OBJECT bits 0x${missing.toString(16)}`);
  }
  const present = forbidden & attributes;
  if (present !== 0) {
    throw new TpmParseError("forbidden-key-attributes", `certified key sets forbidden TPMA_OBJECT bits 0x${present.toString(16)}`);
  }
}
