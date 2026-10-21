// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * RFC 3161 trusted timestamps.
 *
 * Why this exists: a Kionel receipt is signed by two devices, and its `at` field
 * is whatever those devices' clocks said. Two parties who agree with each other
 * can back-date it. For "this file was delivered" that is usually fine; for a
 * chain-of-custody claim it is the weakest link in the whole product, and an
 * opposing lawyer closes it with one question. A TSA countersignature replaces
 * "we say it was Tuesday" with "an independent authority attested Tuesday".
 *
 * Design decision that matters: the token stamps the *already-signed* receipt
 * bytes and is carried alongside them, never inside them. That is how CAdES-T
 * timestamps a signature, and it means adding a timestamp does not change any
 * canonical byte, does not invalidate an existing signature, and does not need
 * a protocol version bump. A receipt with a timestamp and the same receipt
 * without one verify identically at the signature layer.
 *
 * Everything here is fail-closed. A token we cannot fully parse is not a
 * weaker timestamp, it is not a timestamp.
 */

import {
  DerClass, DerError, DerReader, DerTag,
  asGeneralizedTime, asInteger, asOctetString, asOid,
  expect as expectTag, explicit, readerOf, sequenceReader,
  parseAnchors, validateCertificateChain, type CertificateInput,
} from "@kionel/attestation-core";
import { X509Certificate, createHash, createVerify } from "node:crypto";
import { TimestampError, fail, tlv } from "./request.ts";

export { TimestampError, buildTimestampRequest, unwrapTimestampResponse } from "./request.ts";

export const OID = {
  /** id-ct-TSTInfo — the eContentType a timestamp token must carry. */
  tstInfo: "1.2.840.113549.1.9.16.1.4",
  signedData: "1.2.840.113549.1.7.2",
  sha256: "2.16.840.1.101.3.4.2.1",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  ecdsaSha256: "1.2.840.10045.4.3.2",
  rsaSha256: "1.2.840.113549.1.1.11",
  rsaEncryption: "1.2.840.113549.1.1.1",
} as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface TstInfo {
  policy: string;
  imprint: Uint8Array;
  serialNumber: Uint8Array;
  genTime: Date;
  /** Half-width of the authority's asserted accuracy, in milliseconds. */
  accuracyMs: number;
  nonce?: Uint8Array;
}

export interface TimestampToken {
  info: TstInfo;
  /** DER certificates carried in the token, leaf first is not guaranteed. */
  certificates: readonly X509Certificate[];
  /** The certificate that actually signed, resolved from SignerIdentifier. */
  signer: X509Certificate;
  signatureAlgorithm: string;
  signature: Uint8Array;
  /** DER SET OF Attribute — what the signature is actually computed over. */
  signedAttributes: Uint8Array;
  messageDigestAttribute: Uint8Array;
}

export function parseTimestampToken(der: Uint8Array): TimestampToken {
  const contentInfo = sequenceReader(new DerReader(der, "ContentInfo").next(), "ContentInfo");
  if (asOid(contentInfo.next(), "ContentInfo") !== OID.signedData) {
    fail("not-signed-data", "Zaman damgası jetonu CMS SignedData değil");
  }
  const signedData = sequenceReader(explicit(contentInfo.next(), "ContentInfo.content"), "SignedData");
  contentInfo.end();

  const version = asInteger(signedData.next(), "SignedData.version");
  if (version !== 1 && version !== 3) fail("bad-version", `SignedData sürümü desteklenmiyor (${version})`);

  // digestAlgorithms — SHA-256 only. A token we cannot re-hash is not a token.
  const digestAlgorithms = readerOf(
    expectTag(signedData.next(), DerClass.Universal, DerTag.Set, true, "digestAlgorithms"), "digestAlgorithms");
  let sawSha256 = false;
  while (!digestAlgorithms.atEnd) {
    if (asOid(sequenceReader(digestAlgorithms.next(), "DigestAlgorithm").next(), "DigestAlgorithm") === OID.sha256) sawSha256 = true;
  }
  if (!sawSha256) fail("unsupported-digest", "Zaman damgası SHA-256 kullanmıyor");

  // encapContentInfo
  const encap = sequenceReader(signedData.next(), "EncapsulatedContentInfo");
  if (asOid(encap.next(), "eContentType") !== OID.tstInfo) {
    fail("not-tst-info", "İçerik türü id-ct-TSTInfo değil");
  }
  if (encap.atEnd) fail("detached-content", "Zaman damgası TSTInfo içermiyor");
  const eContent = asOctetString(explicit(encap.next(), "eContent"), "eContent");
  encap.end();

  const certificates: X509Certificate[] = [];
  let signerInfos: DerReader | undefined;
  while (!signedData.atEnd) {
    const next = signedData.next();
    if (next.tagClass === DerClass.Context && next.tag === 0) {
      const set = readerOf(next, "certificates");
      while (!set.atEnd) {
        const cert = set.next();
        certificates.push(new X509Certificate(Buffer.from(reencode(cert.tag, cert.tagClass, cert.constructed, cert.value))));
      }
    } else if (next.tagClass === DerClass.Universal && next.tag === DerTag.Set) {
      signerInfos = readerOf(next, "signerInfos");
    }
    // [1] crls is ignored on purpose: revocation for a TSA is handled by the
    // anchor policy, not by whatever the token chose to carry.
  }
  if (!signerInfos) fail("no-signer", "Zaman damgasında SignerInfo yok");
  if (!certificates.length) fail("no-certificate", "Zaman damgası TSA sertifikasını taşımıyor — çevrimdışı doğrulanamaz");

  const signerInfo = sequenceReader(signerInfos!.next(), "SignerInfo");
  if (!signerInfos!.atEnd) fail("multiple-signers", "Zaman damgası birden fazla imzacı taşıyor");

  asInteger(signerInfo.next(), "SignerInfo.version");
  const sid = signerInfo.next();
  const signer = resolveSigner(sid, certificates);
  if (asOid(sequenceReader(signerInfo.next(), "SignerInfo.digestAlgorithm").next(), "digestAlgorithm") !== OID.sha256) {
    fail("unsupported-digest", "SignerInfo SHA-256 kullanmıyor");
  }

  const attributesTlv = signerInfo.next();
  if (attributesTlv.tagClass !== DerClass.Context || attributesTlv.tag !== 0) {
    fail("no-signed-attributes", "Zaman damgası signedAttrs taşımıyor");
  }
  // The signature covers the attributes re-tagged as a SET, per RFC 5652 §5.4.
  const signedAttributes = Uint8Array.from(tlv(0x31, attributesTlv.value));
  const attributes = collectAttributes(attributesTlv.value);

  const contentType = attributes.get(OID.contentType);
  if (!contentType || asOid(new DerReader(contentType, "contentType").next(), "contentType") !== OID.tstInfo) {
    fail("attribute-mismatch", "signedAttrs içindeki içerik türü TSTInfo değil");
  }
  const messageDigestAttribute = attributes.get(OID.messageDigest);
  if (!messageDigestAttribute) fail("no-message-digest", "signedAttrs message-digest taşımıyor");

  const signatureAlgorithm = asOid(sequenceReader(signerInfo.next(), "signatureAlgorithm").next(), "signatureAlgorithm");
  const signature = asOctetString(signerInfo.next(), "signature");

  return {
    info: parseTstInfo(eContent),
    certificates,
    signer,
    signatureAlgorithm,
    signature,
    signedAttributes,
    messageDigestAttribute: asOctetString(new DerReader(messageDigestAttribute!, "messageDigest").next(), "messageDigest"),
  };
}

function parseTstInfo(der: Uint8Array): TstInfo {
  const reader = sequenceReader(new DerReader(der, "TSTInfo").next(), "TSTInfo");
  if (asInteger(reader.next(), "TSTInfo.version") !== 1) fail("bad-tst-version", "TSTInfo sürümü 1 değil");
  const policy = asOid(reader.next(), "TSTInfo.policy");

  const imprintReader = sequenceReader(reader.next(), "MessageImprint");
  if (asOid(sequenceReader(imprintReader.next(), "MessageImprint.alg").next(), "MessageImprint.alg") !== OID.sha256) {
    fail("unsupported-digest", "MessageImprint SHA-256 değil");
  }
  const imprint = asOctetString(imprintReader.next(), "MessageImprint.hash");
  if (imprint.length !== 32) fail("bad-imprint", "MessageImprint 32 bayt değil");

  const serialTlv = expectTag(reader.next(), DerClass.Universal, DerTag.Integer, false, "TSTInfo.serialNumber");
  const genTime = asGeneralizedTime(reader.next(), "TSTInfo.genTime");

  let accuracyMs = 0;
  let nonce: Uint8Array | undefined;
  while (!reader.atEnd) {
    const next = reader.next();
    if (next.tagClass === DerClass.Universal && next.tag === DerTag.Sequence) {
      accuracyMs = parseAccuracy(next.value);
    } else if (next.tagClass === DerClass.Universal && next.tag === DerTag.Integer) {
      nonce = next.value;
    }
    // ordering (BOOLEAN), tsa ([0]) and extensions ([1]) carry no weight here.
  }

  return { policy, imprint, serialNumber: serialTlv.value, genTime, accuracyMs, nonce };
}

function parseAccuracy(der: Uint8Array): number {
  const reader = new DerReader(der, "Accuracy");
  let ms = 0;
  while (!reader.atEnd) {
    const next = reader.next();
    if (next.tagClass === DerClass.Universal && next.tag === DerTag.Integer) {
      ms += intOf(next.value) * 1000; // seconds
    } else if (next.tagClass === DerClass.Context && next.tag === 0) {
      ms += intOf(next.value); // millis
    } else if (next.tagClass === DerClass.Context && next.tag === 1) {
      ms += intOf(next.value) / 1000; // micros
    }
  }
  return ms;
}

const intOf = (bytes: Uint8Array): number => {
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
};

/** Rebuilds a TLV's on-the-wire bytes from a parsed node. */
function reencode(tag: number, tagClass: number, constructed: boolean, value: Uint8Array): number[] {
  if (tag >= 0x1f) fail("high-tag", "Yüksek etiket numarası bu bağlamda desteklenmiyor");
  return tlv((tagClass << 6) | (constructed ? 0x20 : 0) | tag, value);
}

function collectAttributes(der: Uint8Array): Map<string, Uint8Array> {
  const reader = new DerReader(der, "signedAttrs");
  const out = new Map<string, Uint8Array>();
  while (!reader.atEnd) {
    const attribute = sequenceReader(reader.next(), "Attribute");
    const oid = asOid(attribute.next(), "Attribute.type");
    const values = readerOf(expectTag(attribute.next(), DerClass.Universal, DerTag.Set, true, "Attribute.values"), "Attribute.values");
    const first = values.next();
    if (out.has(oid)) fail("duplicate-attribute", `signedAttrs ${oid} niteliğini iki kez taşıyor`);
    out.set(oid, Uint8Array.from(reencode(first.tag, first.tagClass, first.constructed, first.value)));
  }
  return out;
}

/** SignerIdentifier is either issuerAndSerialNumber or [0] subjectKeyIdentifier. */
function resolveSigner(sid: { tagClass: number; tag: number; constructed: boolean; value: Uint8Array }, certificates: readonly X509Certificate[]): X509Certificate {
  if (sid.tagClass === DerClass.Universal && sid.tag === DerTag.Sequence) {
    const reader = new DerReader(sid.value, "IssuerAndSerialNumber");
    reader.next(); // issuer Name — matched via serial below, which is unique per issuer
    const serial = expectTag(reader.next(), DerClass.Universal, DerTag.Integer, false, "serialNumber").value;
    const wanted = hex(serial);
    const match = certificates.find((cert) => cert.serialNumber.toLowerCase().replace(/^0+/, "") === wanted.replace(/^0+/, ""));
    if (!match) fail("signer-not-found", "SignerInfo'daki sertifika jetonda yok");
    return match!;
  }
  if (sid.tagClass === DerClass.Context && sid.tag === 0) {
    const wanted = hex(sid.value);
    const match = certificates.find((cert) => subjectKeyIdentifier(cert) === wanted);
    if (!match) fail("signer-not-found", "subjectKeyIdentifier ile eşleşen sertifika yok");
    return match!;
  }
  return fail("bad-signer-id", "SignerIdentifier biçimi tanınmadı");
}

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex").toLowerCase();

function subjectKeyIdentifier(cert: X509Certificate): string | undefined {
  // node exposes it only through the text form; parsing the DER extension would
  // duplicate work the platform already did.
  const match = /X509v3 Subject Key Identifier:\s*\n\s*([0-9A-Fa-f:]+)/.exec(cert.toString());
  return match?.[1].replaceAll(":", "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface TimestampPolicy {
  /** DER or PEM anchors the TSA must chain to. Empty means: refuse everything. */
  anchors: readonly CertificateInput[];
  /** If set, the token's policy OID must be one of these. */
  acceptedPolicies?: readonly string[];
  /** Reject a token whose asserted accuracy is worse than this. */
  maxAccuracyMs?: number;
  /** Reject a token stamped after this — the verifier's own clock sanity check. */
  notAfter?: Date;
}

export type TimestampVerdict =
  | { ok: true; at: Date; accuracyMs: number; policy: string; authority: string; serialNumber: string }
  | { ok: false; code: string; reason: string };

/**
 * Verifies a timestamp token against `imprint` — the SHA-256 of whatever was
 * stamped. Returns a verdict rather than throwing so a caller can record a
 * receipt as "signed but not timestamped" instead of losing it entirely.
 */
export function verifyTimestamp(
  tokenDer: Uint8Array,
  imprint: Uint8Array,
  policy: TimestampPolicy,
): TimestampVerdict {
  try {
    if (!policy.anchors.length) {
      return { ok: false, code: "no-anchor", reason: "Zaman damgası güven kökü tanımlı değil" };
    }
    const token = parseTimestampToken(tokenDer);

    if (!timingSafeEqual(token.info.imprint, imprint)) {
      return { ok: false, code: "imprint-mismatch", reason: "Zaman damgası başka bir içeriğe ait" };
    }
    if (policy.acceptedPolicies?.length && !policy.acceptedPolicies.includes(token.info.policy)) {
      return { ok: false, code: "policy-rejected", reason: `TSA politikası kabul listesinde değil (${token.info.policy})` };
    }
    if (policy.maxAccuracyMs !== undefined && token.info.accuracyMs > policy.maxAccuracyMs) {
      return { ok: false, code: "accuracy-too-wide", reason: `TSA doğruluğu çok geniş (${token.info.accuracyMs} ms)` };
    }
    if (policy.notAfter && token.info.genTime.getTime() > policy.notAfter.getTime()) {
      return { ok: false, code: "future-timestamp", reason: "Zaman damgası gelecekte" };
    }

    // The signature is over signedAttrs; signedAttrs binds TSTInfo through the
    // message-digest attribute. Checking one without the other proves nothing.
    const contentDigest = createHash("sha256").update(reencodeTstInfo(tokenDer)).digest();
    if (!timingSafeEqual(new Uint8Array(contentDigest), token.messageDigestAttribute)) {
      return { ok: false, code: "digest-mismatch", reason: "signedAttrs, TSTInfo ile eşleşmiyor" };
    }

    if (!verifySignature(token)) {
      return { ok: false, code: "bad-signature", reason: "TSA imzası doğrulanamadı" };
    }

    if (!token.signer.keyUsage?.includes(TIME_STAMPING)) {
      return { ok: false, code: "not-a-tsa", reason: "İmzalayan sertifika zaman damgası için değil (EKU)" };
    }

    // The chain is validated at genTime, not now: a token stays valid after the
    // TSA certificate expires, which is the entire reason to timestamp at all.
    // The path is built from the signer up, not taken in token order: DigiCert
    // appends a cross-signed copy of its root, which no pinned anchor issued.
    const anchors = parseAnchors(policy.anchors);
    const chain = validateCertificateChain(
      pathToAnchor(token.signer, token.certificates, anchors).map((cert) => cert.raw),
      { anchors, now: token.info.genTime, maxLength: 6 },
    );
    if (!chain.ok) return { ok: false, code: "chain-rejected", reason: chain.reason };

    return {
      ok: true,
      at: token.info.genTime,
      accuracyMs: token.info.accuracyMs,
      policy: token.info.policy,
      authority: token.signer.subject.replace(/\n/g, ", "),
      serialNumber: hex(token.info.serialNumber),
    };
  } catch (error) {
    if (error instanceof TimestampError) return { ok: false, code: error.code, reason: error.message };
    if (error instanceof DerError) return { ok: false, code: error.code, reason: error.message };
    return { ok: false, code: "unparsable", reason: error instanceof Error ? error.message : String(error) };
  }
}

const TIME_STAMPING = "1.3.6.1.5.5.7.3.8";

/** Signer, then each verified CA issuer, stopping at the first certificate an anchor vouches for. */
function pathToAnchor(signer: X509Certificate, certificates: readonly X509Certificate[], anchors: readonly X509Certificate[]): X509Certificate[] {
  const path = [signer];
  while (path.length < 6) {
    const current = path[path.length - 1];
    if (anchors.some((anchor) => current.raw.equals(anchor.raw) || (current.checkIssued(anchor) && current.verify(anchor.publicKey)))) break;
    const issuer = certificates.find((cert) => !path.includes(cert) && cert.ca && current.checkIssued(cert) && current.verify(cert.publicKey));
    if (!issuer) break;
    path.push(issuer);
  }
  return path;
}

/** Pulls the exact eContent octets back out so the digest is over what was signed. */
function reencodeTstInfo(tokenDer: Uint8Array): Uint8Array {
  const contentInfo = sequenceReader(new DerReader(tokenDer, "ContentInfo").next(), "ContentInfo");
  contentInfo.next();
  const signedData = sequenceReader(explicit(contentInfo.next(), "content"), "SignedData");
  signedData.next();
  signedData.next();
  const encap = sequenceReader(signedData.next(), "EncapsulatedContentInfo");
  encap.next();
  return asOctetString(explicit(encap.next(), "eContent"), "eContent");
}

function verifySignature(token: TimestampToken): boolean {
  const algorithm = token.signatureAlgorithm === OID.ecdsaSha256 || token.signatureAlgorithm === OID.rsaSha256
    ? "sha256"
    : token.signatureAlgorithm === OID.rsaEncryption
      ? "sha256" // RSA keys often carry the bare key OID with the digest named above
      : undefined;
  if (!algorithm) fail("unsupported-signature-alg", `İmza algoritması desteklenmiyor (${token.signatureAlgorithm})`);
  return createVerify(algorithm!)
    .update(Buffer.from(token.signedAttributes))
    .verify(token.signer.publicKey, Buffer.from(token.signature));
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}
