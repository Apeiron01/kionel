/**
 * Apple App Attest doğrulayıcısı (Secure Enclave cihaz anahtarı).
 *
 * Enrollment tarafında çalışır. Apple'ın attestation nesnesi CBOR'dur ve içinde
 * bir X.509 zinciri, cihazın ürettiği `authData` ve nonce'u taşıyan bir sertifika
 * eklentisi bulunur (OID 1.2.840.113635.100.8.2).
 *
 * Kanıtladığı: P-256 anahtar bu cihazın Secure Enclave'inde üretildi, dışarı
 * çıkamaz, Apple'ın App Attest köküne zincirlenir, bu enrollment'ın tek
 * kullanımlık challenge'ına ve BU uygulamanın kimliğine bağlıdır.
 * Kanıtlamadığı: uygulamanın çalışma anında ele geçirilmemiş olduğu.
 *
 * Kaynak: Apple, "Validating Apps That Connect to Your Server".
 */
import { X509Certificate, createHash } from "node:crypto";
import type { AttestationResult, AttestationVerifier, NativeKeyRecord } from "@kionel/platform-keys";
import {
  DerClass, DerError, DerReader, asOctetString, explicit, findExtension, oidBytes, parseAnchors,
  sec1PublicKey, sequenceReader, validateCertificateChain, type CertificateInput,
} from "@kionel/attestation-core";
import { CborError, cborArray, cborBytes, cborMap, cborText, decodeCbor } from "./cbor.ts";

export * from "./cbor.ts";

/** Apple'ın nonce eklentisi. */
export const APPLE_NONCE_OID = oidBytes("1.2.840.113635.100.8.2");

const AAGUID_PRODUCTION = new TextEncoder().encode("appattest\0\0\0\0\0\0\0");
const AAGUID_DEVELOPMENT = new TextEncoder().encode("appattestdevelop");
const AUTH_DATA_MIN = 32 + 1 + 4 + 16 + 2;

export interface AppleAttestationPolicy {
  verifierId: string;
  /** Apple App Attest Root CA. Boş bırakılırsa her kanıt reddedilir. */
  trustAnchors: readonly CertificateInput[];
  /** "TEAMID.bundle.identifier" — rpIdHash bunun SHA-256'sı olmalı. */
  appId: string;
  /** Geliştirme ortamı attestation'ı üretimde kabul edilmemelidir. */
  allowDevelopmentEnvironment?: boolean;
  maxChainLength?: number;
  now?: () => Date;
}

export interface AppleAuthenticatorData {
  rpIdHash: Uint8Array;
  flags: number;
  counter: number;
  aaguid: Uint8Array;
  credentialId: Uint8Array;
}

export function parseAuthenticatorData(bytes: Uint8Array): AppleAuthenticatorData {
  if (bytes.length < AUTH_DATA_MIN) throw new CborError("authdata-truncated", "authData kesik");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const credentialIdLength = view.getUint16(53);
  if (bytes.length !== AUTH_DATA_MIN + credentialIdLength) {
    throw new CborError("authdata-length", "authData uzunluğu credentialId ile tutmuyor");
  }
  return {
    rpIdHash: bytes.subarray(0, 32),
    flags: bytes[32],
    counter: view.getUint32(33),
    aaguid: bytes.subarray(37, 53),
    credentialId: bytes.subarray(55, 55 + credentialIdLength),
  };
}

/** Eklenti içeriği: SEQUENCE { [1] EXPLICIT OCTET STRING nonce }. */
export function parseNonceExtension(der: Uint8Array): Uint8Array {
  const reader = new DerReader(der, "AppleNonceExtension");
  const fields = sequenceReader(reader.next(), "AppleNonceExtension");
  reader.end();
  const field = fields.next();
  if (field.tagClass !== DerClass.Context || field.tag !== 1) {
    throw new DerError("unexpected-tag", "Apple nonce eklentisi [1] alanı taşımıyor");
  }
  const nonce = asOctetString(explicit(field, "AppleNonce"), "AppleNonce");
  fields.end();
  if (nonce.length !== 32) throw new DerError("nonce-size", "Apple nonce 32 bayt olmalı");
  return nonce;
}

export class AppleAppAttestVerifier implements AttestationVerifier {
  readonly policy: AppleAttestationPolicy;
  private readonly anchors: X509Certificate[];
  private readonly rpIdHash: Uint8Array;

  constructor(policy: AppleAttestationPolicy) {
    if (!/^[a-z0-9][a-z0-9._/-]{2,63}$/.test(policy.verifierId)) throw new Error("verifierId geçersiz");
    if (!/^[A-Z0-9]{10}\.[A-Za-z0-9.-]{1,150}$/.test(policy.appId)) throw new Error("appId TEAMID.bundle.id biçiminde olmalı");
    const maxChainLength = policy.maxChainLength ?? 6;
    if (!Number.isSafeInteger(maxChainLength) || maxChainLength < 1 || maxChainLength > 12) {
      throw new Error("attestation zinciri sınırı 1..12 olmalı");
    }
    this.policy = { ...policy, maxChainLength };
    this.anchors = parseAnchors(policy.trustAnchors);
    this.rpIdHash = sha256(new TextEncoder().encode(policy.appId));
  }

  async verify(record: NativeKeyRecord, expectedChallenge: Uint8Array): Promise<AttestationResult> {
    const now = this.policy.now?.() ?? new Date();
    try {
      const reason = this.check(record, expectedChallenge, now);
      if (reason) return rejected(reason);
    } catch (error) {
      // Fail closed: çözülemeyen nesne kanıt değildir.
      return rejected(error instanceof CborError || error instanceof DerError ? error.code : "verifier-error");
    }
    return {
      status: "verified",
      format: "apple-app-attest",
      verifiedBy: this.policy.verifierId,
      verifiedAt: `${now.toISOString().slice(0, 19)}Z`,
    };
  }

  private check(record: NativeKeyRecord, expectedChallenge: Uint8Array, now: Date): string | undefined {
    if (expectedChallenge.length < 16 || expectedChallenge.length > 64) return "challenge-size";
    if (record.securityLevel !== "secure-enclave") return "not-a-secure-enclave-key";
    if (record.persistence !== "persistent") return "key-not-persistent";

    const evidence = record.attestationEvidence;
    if (!evidence || evidence.format !== "apple-app-attest") return "missing-apple-evidence";
    if (!evidence.statement) return "missing-attestation-object";

    // 1. CBOR nesnesi: fmt, attStmt.x5c, authData.
    const object = cborMap(decodeCbor(evidence.statement), "attestationObject");
    if (cborText(object.get("fmt"), "fmt") !== "apple-appattest") return "unexpected-attestation-format";
    const statement = cborMap(object.get("attStmt") ?? new Map(), "attStmt");
    const authData = cborBytes(object.get("authData"), "authData");
    const x5c = cborArray(statement.get("x5c"), "x5c").map((entry) => cborBytes(entry, "x5c girdisi"));

    // 2. Zincir Apple köküne çıkmalı; kanıtın içindeki kök kendini doğrular.
    const chain = validateCertificateChain(x5c, {
      anchors: this.anchors,
      now,
      maxLength: this.policy.maxChainLength!,
    });
    if (!chain.ok) return chain.reason;

    // 3. Sertifikalanan anahtar, kaydın iddia ettiği anahtar olmalı.
    const leafKey = sec1PublicKey(chain.leaf);
    if (!leafKey) return "leaf-not-p256";
    if (!sameBytes(leafKey, record.publicKey)) return "public-key-mismatch";

    // 4. nonce = SHA256(authData || SHA256(challenge)) — challenge'ı VE authData'yı
    //    aynı anda bağlar; ikisinden biri değişirse eklentideki nonce tutmaz.
    const expectedNonce = sha256(concat(authData, sha256(expectedChallenge)));
    const extension = findExtension(new Uint8Array(chain.leaf.raw), APPLE_NONCE_OID);
    if (!extension) return "missing-nonce-extension";
    if (!sameBytes(parseNonceExtension(extension), expectedNonce)) return "nonce-mismatch";

    // 5. authData: uygulama kimliği, sayaç, ortam ve anahtar kimliği.
    const parsed = parseAuthenticatorData(authData);
    if (!sameBytes(parsed.rpIdHash, this.rpIdHash)) return "app-id-mismatch";
    if (parsed.counter !== 0) return "counter-not-zero";
    const development = sameBytes(parsed.aaguid, AAGUID_DEVELOPMENT);
    if (development && !this.policy.allowDevelopmentEnvironment) return "development-attestation-rejected";
    if (!development && !sameBytes(parsed.aaguid, AAGUID_PRODUCTION)) return "unknown-attestation-environment";
    // Apple'da anahtar kimliği açık anahtarın özetidir; uydurulamaz.
    if (!sameBytes(parsed.credentialId, sha256(leafKey))) return "credential-id-mismatch";
    return undefined;
  }
}

/** App Attest anahtar kimliği: açık anahtarın SHA-256'sı. */
export function appleKeyId(sec1: Uint8Array): Uint8Array {
  return sha256(sec1);
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

function rejected(reason: string): AttestationResult {
  return { status: "rejected", format: "apple-app-attest", reason };
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
