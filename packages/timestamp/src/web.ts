// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * RFC 3161 verification in the browser, with WebCrypto.
 *
 * rfc3161.ts verifies with node:crypto's X509Certificate, which a browser does
 * not have. This module checks the same things with no platform dependency
 * beyond WebCrypto, so the receiving device and the public verify page can
 * judge a timestamp themselves instead of trusting whoever relayed it.
 *
 * Checked, fail-closed:
 *  - the token stamps exactly the expected imprint (and nonce, if given);
 *  - signedAttrs bind the TSTInfo (message-digest) and the signer certificate
 *    (ESS signingCertificate or signingCertificateV2);
 *  - the TSA signature over signedAttrs;
 *  - the signer certificate is for time-stamping (EKU id-kp-timeStamping);
 *  - a chain of CA certificates, each signature verified, up to a pinned
 *    anchor, every certificate valid at genTime (not now: a token outlives
 *    its TSA certificate, which is the point of timestamping).
 */
import {
  DerClass, DerError, DerReader, DerTag, type DerTlv,
  asBitString, asBoolean, asGeneralizedTime, asInteger, asOctetString, asOid,
  expect as expectTag, explicit, readerOf, sequenceReader,
} from "@kionel/attestation-core/asn1";
import { TimestampError, fail, tlv } from "./request.ts";

export { buildTimestampRequest, unwrapTimestampResponse } from "./request.ts";
export { DIGICERT_TRUSTED_ROOT_G4, anchorBytes } from "./anchors.ts";

const OID = {
  signedData: "1.2.840.113549.1.7.2",
  tstInfo: "1.2.840.113549.1.9.16.1.4",
  contentType: "1.2.840.113549.1.9.3",
  messageDigest: "1.2.840.113549.1.9.4",
  signingCertificate: "1.2.840.113549.1.9.16.2.12",
  signingCertificateV2: "1.2.840.113549.1.9.16.2.47",
  sha1: "1.3.14.3.2.26",
  sha256: "2.16.840.1.101.3.4.2.1",
  sha384: "2.16.840.1.101.3.4.2.2",
  sha512: "2.16.840.1.101.3.4.2.3",
  rsaEncryption: "1.2.840.113549.1.1.1",
  rsaSha256: "1.2.840.113549.1.1.11",
  rsaSha384: "1.2.840.113549.1.1.12",
  rsaSha512: "1.2.840.113549.1.1.13",
  ecPublicKey: "1.2.840.10045.2.1",
  ecdsaSha256: "1.2.840.10045.4.3.2",
  ecdsaSha384: "1.2.840.10045.4.3.3",
  p256: "1.2.840.10045.3.1.7",
  p384: "1.3.132.0.34",
  basicConstraints: "2.5.29.19",
  extKeyUsage: "2.5.29.37",
  timeStamping: "1.3.6.1.5.5.7.3.8",
  commonName: "2.5.4.3",
} as const;

const HASH: Record<string, string> = {
  [OID.sha1]: "SHA-1", [OID.sha256]: "SHA-256", [OID.sha384]: "SHA-384", [OID.sha512]: "SHA-512",
};

export type WebTimestampVerdict =
  | { ok: true; at: Date; authority: string; serialNumber: string; policy: string }
  | { ok: false; code: string; reason: string };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const bytes = (value: number[]): Uint8Array => Uint8Array.from(value);
/** A TLV's wire bytes. DerReader enforces minimal lengths, so re-encoding is exact. */
const raw = (node: DerTlv): Uint8Array => {
  if (node.tag >= 0x1f) fail("high-tag", "Yüksek etiket numarası bu bağlamda desteklenmiyor");
  return bytes(tlv((node.tagClass << 6) | (node.constructed ? 0x20 : 0) | node.tag, node.value));
};
const equal = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
};
const hex = (value: Uint8Array): string => Array.from(value, (b) => b.toString(16).padStart(2, "0")).join("");
const digest = async (name: string, data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest(name, data as BufferSource));

/** UTCTime (YYMMDDHHMMSSZ) or GeneralizedTime, DER profile only. */
function asTime(node: DerTlv, what: string): Date {
  if (node.tagClass === DerClass.Universal && node.tag === 24) return asGeneralizedTime(node, what);
  expectTag(node, DerClass.Universal, 23, false, what);
  const text = new TextDecoder("ascii", { fatal: true }).decode(node.value);
  const match = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!match) throw new DerError("non-der-time", `${what} UTCTime is not in the DER profile`);
  const [yy, month, day, hour, minute, second] = match.slice(1).map(Number);
  const at = new Date(Date.UTC(yy < 50 ? 2000 + yy : 1900 + yy, month - 1, day, hour, minute, second));
  if (Number.isNaN(at.getTime()) || at.getUTCDate() !== day) throw new DerError("invalid-time", `${what} is not a real instant`);
  return at;
}

/**
 * genTime may carry fractional seconds (RFC 3161 §2.4.2); the certificate
 * profile may not. Fractions are accepted here and nowhere else.
 */
function asGenTime(node: DerTlv): Date {
  expectTag(node, DerClass.Universal, 24, false, "TSTInfo.genTime");
  const text = new TextDecoder("ascii", { fatal: true }).decode(node.value);
  const match = /^(\d{14})(?:\.(\d*[1-9]))?Z$/.exec(text);
  if (!match) throw new DerError("non-der-time", "TSTInfo.genTime is not in the DER profile");
  const whole = asGeneralizedTime({ ...node, value: new TextEncoder().encode(`${match[1]}Z`) }, "TSTInfo.genTime");
  return new Date(whole.getTime() + (match[2] ? Math.floor(Number(`0.${match[2]}`) * 1000) : 0));
}

// ---------------------------------------------------------------------------
// X.509, only what a path check needs
// ---------------------------------------------------------------------------

interface Certificate {
  der: Uint8Array;
  tbs: Uint8Array;
  signatureAlgorithm: string;
  signature: Uint8Array;
  serial: Uint8Array;
  issuer: Uint8Array;
  subject: Uint8Array;
  notBefore: Date;
  notAfter: Date;
  spki: Uint8Array;
  keyAlgorithm: string;
  curve?: string;
  isCa: boolean;
  extKeyUsage: string[];
  subjectKeyId?: Uint8Array;
  commonName: string;
}

function parseCertificate(der: Uint8Array): Certificate {
  const outer = new DerReader(der, "Certificate");
  const cert = sequenceReader(outer.next(), "Certificate");
  outer.end();
  const tbsNode = cert.next();
  const signatureAlgorithm = asOid(sequenceReader(cert.next(), "signatureAlgorithm").next(), "signatureAlgorithm");
  const signature = asBitString(cert.next(), "signatureValue");
  cert.end();

  const tbs = sequenceReader(tbsNode, "TBSCertificate");
  let next = tbs.next();
  if (next.tagClass === DerClass.Context && next.tag === 0) next = tbs.next(); // [0] version
  const serial = expectTag(next, DerClass.Universal, DerTag.Integer, false, "serialNumber").value;
  tbs.next(); // signature AlgorithmIdentifier (must match the outer one; outer is what is verified)
  const issuer = raw(tbs.next());
  const validity = sequenceReader(tbs.next(), "Validity");
  const notBefore = asTime(validity.next(), "notBefore");
  const notAfter = asTime(validity.next(), "notAfter");
  const subjectNode = tbs.next();
  const spkiNode = tbs.next();
  const keyAlgorithmId = sequenceReader(sequenceReader(spkiNode, "SubjectPublicKeyInfo").next(), "algorithm");
  const keyAlgorithm = asOid(keyAlgorithmId.next(), "algorithm");
  const curve = keyAlgorithm === OID.ecPublicKey && !keyAlgorithmId.atEnd ? asOid(keyAlgorithmId.next(), "namedCurve") : undefined;

  let isCa = false;
  let extKeyUsage: string[] = [];
  let subjectKeyId: Uint8Array | undefined;
  while (!tbs.atEnd) {
    const field = tbs.next();
    if (field.tagClass !== DerClass.Context || field.tag !== 3) continue; // [1], [2] unique IDs
    const extensions = sequenceReader(explicit(field, "extensions"), "Extensions");
    while (!extensions.atEnd) {
      const extension = sequenceReader(extensions.next(), "Extension");
      const id = asOid(extension.next(), "extnID");
      let value = extension.next();
      if (value.tagClass === DerClass.Universal && value.tag === DerTag.Boolean) value = extension.next();
      const inner = asOctetString(value, "extnValue");
      if (id === OID.basicConstraints) {
        const constraints = sequenceReader(new DerReader(inner, "BasicConstraints").next(), "BasicConstraints");
        isCa = !constraints.atEnd && asBoolean(constraints.next(), "cA");
      } else if (id === OID.extKeyUsage) {
        const usages = sequenceReader(new DerReader(inner, "ExtKeyUsage").next(), "ExtKeyUsage");
        extKeyUsage = [];
        while (!usages.atEnd) extKeyUsage.push(asOid(usages.next(), "KeyPurposeId"));
      } else if (id === "2.5.29.14") {
        subjectKeyId = asOctetString(new DerReader(inner, "SubjectKeyIdentifier").next(), "SubjectKeyIdentifier");
      }
    }
  }

  return {
    der, tbs: raw(tbsNode), signatureAlgorithm, signature, serial, issuer, subject: raw(subjectNode),
    notBefore, notAfter, spki: raw(spkiNode), keyAlgorithm, curve, isCa, extKeyUsage, subjectKeyId,
    commonName: commonName(subjectNode),
  };
}

function commonName(name: DerTlv): string {
  const rdns = sequenceReader(name, "Name");
  let found = "";
  while (!rdns.atEnd) {
    const set = readerOf(expectTag(rdns.next(), DerClass.Universal, DerTag.Set, true, "RDN"), "RDN");
    while (!set.atEnd) {
      const pair = sequenceReader(set.next(), "AttributeTypeAndValue");
      if (asOid(pair.next(), "type") === OID.commonName) found = new TextDecoder().decode(pair.next().value);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

/** ECDSA in X.509/CMS is DER SEQUENCE { r, s }; WebCrypto wants r || s. */
function ecdsaRaw(der: Uint8Array, size: number): Uint8Array {
  const pair = sequenceReader(new DerReader(der, "ECDSA-Sig-Value").next(), "ECDSA-Sig-Value");
  const out = new Uint8Array(size * 2);
  for (const offset of [0, size]) {
    let value = expectTag(pair.next(), DerClass.Universal, DerTag.Integer, false, "ECDSA integer").value;
    while (value.length > size && value[0] === 0) value = value.subarray(1);
    if (value.length > size) fail("bad-signature", "ECDSA imza değeri eğri boyutunu aşıyor");
    out.set(value, offset + size - value.length);
  }
  pair.end();
  return out;
}

async function verifyWith(
  key: Pick<Certificate, "spki" | "keyAlgorithm" | "curve">,
  algorithm: string,
  data: Uint8Array,
  signature: Uint8Array,
  digestAlgorithm?: string,
): Promise<boolean> {
  const rsaHash = { [OID.rsaSha256]: "SHA-256", [OID.rsaSha384]: "SHA-384", [OID.rsaSha512]: "SHA-512" }[algorithm]
    ?? (algorithm === OID.rsaEncryption && digestAlgorithm ? HASH[digestAlgorithm] : undefined);
  if (rsaHash) {
    if (key.keyAlgorithm !== OID.rsaEncryption) return false;
    const publicKey = await crypto.subtle.importKey("spki", key.spki as BufferSource, { name: "RSASSA-PKCS1-v1_5", hash: rsaHash }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, signature as BufferSource, data as BufferSource);
  }
  const ecHash = { [OID.ecdsaSha256]: "SHA-256", [OID.ecdsaSha384]: "SHA-384" }[algorithm];
  if (ecHash) {
    const curve = { [OID.p256]: ["P-256", 32], [OID.p384]: ["P-384", 48] }[key.curve ?? ""] as [string, number] | undefined;
    if (key.keyAlgorithm !== OID.ecPublicKey || !curve) return false;
    const publicKey = await crypto.subtle.importKey("spki", key.spki as BufferSource, { name: "ECDSA", namedCurve: curve[0] }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: ecHash }, publicKey, ecdsaRaw(signature, curve[1]) as BufferSource, data as BufferSource);
  }
  return fail("unsupported-signature-alg", `İmza algoritması desteklenmiyor (${algorithm})`);
}

// ---------------------------------------------------------------------------
// The token
// ---------------------------------------------------------------------------

interface ParsedToken {
  eContent: Uint8Array;
  policy: string;
  imprint: Uint8Array;
  serialNumber: Uint8Array;
  genTime: Date;
  nonce?: Uint8Array;
  certificates: Certificate[];
  signer: Certificate;
  digestAlgorithm: string;
  signatureAlgorithm: string;
  signature: Uint8Array;
  signedAttributes: Uint8Array;
  attributes: Map<string, DerTlv>;
}

function parseToken(der: Uint8Array): ParsedToken {
  const outer = new DerReader(der, "ContentInfo");
  const contentInfo = sequenceReader(outer.next(), "ContentInfo");
  outer.end();
  if (asOid(contentInfo.next(), "ContentInfo") !== OID.signedData) fail("not-signed-data", "Zaman damgası jetonu CMS SignedData değil");
  const signedData = sequenceReader(explicit(contentInfo.next(), "ContentInfo.content"), "SignedData");
  contentInfo.end();

  const version = asInteger(signedData.next(), "SignedData.version");
  if (version !== 1 && version !== 3) fail("bad-version", `SignedData sürümü desteklenmiyor (${version})`);
  readerOf(expectTag(signedData.next(), DerClass.Universal, DerTag.Set, true, "digestAlgorithms"), "digestAlgorithms");

  const encap = sequenceReader(signedData.next(), "EncapsulatedContentInfo");
  if (asOid(encap.next(), "eContentType") !== OID.tstInfo) fail("not-tst-info", "İçerik türü id-ct-TSTInfo değil");
  if (encap.atEnd) fail("detached-content", "Zaman damgası TSTInfo içermiyor");
  const eContent = asOctetString(explicit(encap.next(), "eContent"), "eContent");
  encap.end();

  const certificates: Certificate[] = [];
  let signerInfos: DerReader | undefined;
  while (!signedData.atEnd) {
    const node = signedData.next();
    if (node.tagClass === DerClass.Context && node.tag === 0) {
      const set = readerOf(node, "certificates");
      while (!set.atEnd) {
        const cert = set.next();
        // Only plain certificates; attribute certificates and others are ignored.
        if (cert.tagClass === DerClass.Universal && cert.tag === DerTag.Sequence) certificates.push(parseCertificate(raw(cert)));
      }
    } else if (node.tagClass === DerClass.Universal && node.tag === DerTag.Set) {
      signerInfos = readerOf(node, "signerInfos");
    }
  }
  if (!signerInfos) fail("no-signer", "Zaman damgasında SignerInfo yok");
  if (!certificates.length) fail("no-certificate", "Zaman damgası TSA sertifikasını taşımıyor — çevrimdışı doğrulanamaz");

  const signerInfo = sequenceReader(signerInfos!.next(), "SignerInfo");
  if (!signerInfos!.atEnd) fail("multiple-signers", "Zaman damgası birden fazla imzacı taşıyor");
  asInteger(signerInfo.next(), "SignerInfo.version");
  const signer = resolveSigner(signerInfo.next(), certificates);
  const digestAlgorithm = asOid(sequenceReader(signerInfo.next(), "SignerInfo.digestAlgorithm").next(), "digestAlgorithm");
  if (!HASH[digestAlgorithm] || digestAlgorithm === OID.sha1) fail("unsupported-digest", "SignerInfo SHA-2 kullanmıyor");

  const attributesNode = signerInfo.next();
  if (attributesNode.tagClass !== DerClass.Context || attributesNode.tag !== 0) fail("no-signed-attributes", "Zaman damgası signedAttrs taşımıyor");
  // The signature covers the attributes re-tagged as a SET (RFC 5652 §5.4).
  const signedAttributes = bytes(tlv(0x31, attributesNode.value));
  const attributes = new Map<string, DerTlv>();
  const attributeReader = new DerReader(attributesNode.value, "signedAttrs");
  while (!attributeReader.atEnd) {
    const attribute = sequenceReader(attributeReader.next(), "Attribute");
    const id = asOid(attribute.next(), "Attribute.type");
    const values = readerOf(expectTag(attribute.next(), DerClass.Universal, DerTag.Set, true, "Attribute.values"), "Attribute.values");
    if (attributes.has(id)) fail("duplicate-attribute", `signedAttrs ${id} niteliğini iki kez taşıyor`);
    attributes.set(id, values.next());
    if (!values.atEnd) fail("multi-valued-attribute", `signedAttrs ${id} birden fazla değer taşıyor`);
  }

  const signatureAlgorithm = asOid(sequenceReader(signerInfo.next(), "signatureAlgorithm").next(), "signatureAlgorithm");
  const signature = asOctetString(signerInfo.next(), "signature");

  const info = sequenceReader(new DerReader(eContent, "TSTInfo").next(), "TSTInfo");
  if (asInteger(info.next(), "TSTInfo.version") !== 1) fail("bad-tst-version", "TSTInfo sürümü 1 değil");
  const policy = asOid(info.next(), "TSTInfo.policy");
  const imprintReader = sequenceReader(info.next(), "MessageImprint");
  if (asOid(sequenceReader(imprintReader.next(), "MessageImprint.alg").next(), "MessageImprint.alg") !== OID.sha256) {
    fail("unsupported-digest", "MessageImprint SHA-256 değil");
  }
  const imprint = asOctetString(imprintReader.next(), "MessageImprint.hash");
  const serialNumber = expectTag(info.next(), DerClass.Universal, DerTag.Integer, false, "TSTInfo.serialNumber").value;
  const genTime = asGenTime(info.next());
  let nonce: Uint8Array | undefined;
  while (!info.atEnd) {
    const node = info.next();
    if (node.tagClass === DerClass.Universal && node.tag === DerTag.Integer) nonce = node.value;
  }

  return {
    eContent, policy, imprint, serialNumber, genTime, nonce, certificates, signer,
    digestAlgorithm, signatureAlgorithm, signature, signedAttributes, attributes,
  };
}

function resolveSigner(sid: DerTlv, certificates: Certificate[]): Certificate {
  if (sid.tagClass === DerClass.Universal && sid.tag === DerTag.Sequence) {
    const reader = new DerReader(sid.value, "IssuerAndSerialNumber");
    const issuer = raw(reader.next());
    const serial = expectTag(reader.next(), DerClass.Universal, DerTag.Integer, false, "serialNumber").value;
    const match = certificates.find((cert) => equal(cert.issuer, issuer) && equal(cert.serial, serial));
    return match ?? fail("signer-not-found", "SignerInfo'daki sertifika jetonda yok");
  }
  if (sid.tagClass === DerClass.Context && sid.tag === 0) {
    const match = certificates.find((cert) => cert.subjectKeyId && equal(cert.subjectKeyId, sid.value));
    return match ?? fail("signer-not-found", "subjectKeyIdentifier ile eşleşen sertifika yok");
  }
  return fail("bad-signer-id", "SignerIdentifier biçimi tanınmadı");
}

/** ESS: signedAttrs must name the signer certificate by hash, so it cannot be swapped. */
async function checkSignerBinding(token: ParsedToken): Promise<void> {
  const v2 = token.attributes.get(OID.signingCertificateV2);
  const v1 = token.attributes.get(OID.signingCertificate);
  const node = v2 ?? v1;
  if (!node) fail("no-signer-binding", "signedAttrs imzalayan sertifikayı bağlamıyor (ESS)");
  const certs = sequenceReader(sequenceReader(node!, "SigningCertificate").next(), "certs");
  const id = sequenceReader(certs.next(), "ESSCertID");
  let algorithm: string = v2 ? OID.sha256 : OID.sha1;
  let hashNode = id.next();
  if (v2 && hashNode.tagClass === DerClass.Universal && hashNode.tag === DerTag.Sequence) {
    algorithm = asOid(readerOf(hashNode, "hashAlgorithm").next(), "hashAlgorithm");
    hashNode = id.next();
  }
  if (!HASH[algorithm]) fail("unsupported-digest", "ESS sertifika özeti algoritması desteklenmiyor");
  const expected = asOctetString(hashNode, "certHash");
  if (!equal(await digest(HASH[algorithm], token.signer.der), expected)) {
    fail("signer-binding-mismatch", "signedAttrs başka bir sertifikayı bağlıyor");
  }
}

const within = (cert: Certificate, at: Date): boolean =>
  cert.notBefore.getTime() <= at.getTime() && at.getTime() <= cert.notAfter.getTime();

/** Leaf → CA certificates in the token → a pinned anchor, every link verified at genTime. */
async function checkChain(token: ParsedToken, anchors: Certificate[]): Promise<void> {
  if (!token.signer.extKeyUsage.includes(OID.timeStamping)) fail("not-a-tsa", "İmzalayan sertifika zaman damgası için değil (EKU)");
  let current = token.signer;
  for (let depth = 0; depth < 6; depth++) {
    if (!within(current, token.genTime)) fail("certificate-expired", `${current.commonName} damga anında geçerli değildi`);
    for (const anchor of anchors) {
      if (equal(current.der, anchor.der)) return;
      if (equal(current.issuer, anchor.subject) && within(anchor, token.genTime) &&
          await verifyWith(anchor, current.signatureAlgorithm, current.tbs, current.signature)) return;
    }
    let issuer: Certificate | undefined;
    for (const candidate of token.certificates) {
      if (candidate === current || !candidate.isCa || !equal(candidate.subject, current.issuer)) continue;
      if (await verifyWith(candidate, current.signatureAlgorithm, current.tbs, current.signature)) { issuer = candidate; break; }
    }
    if (!issuer) fail("chain-rejected", `${current.commonName} güvenilen bir köke bağlanamadı`);
    current = issuer!;
  }
  fail("chain-too-long", "Sertifika zinciri çok uzun");
}

/**
 * Verifies `tokenDer` against the SHA-256 `imprint` it should stamp, chaining to
 * one of `anchors` (DER). Returns a verdict; never throws.
 */
export async function verifyTimestampWeb(
  tokenDer: Uint8Array,
  imprint: Uint8Array,
  anchors: readonly Uint8Array[],
  options: { nonce?: Uint8Array; notAfter?: Date } = {},
): Promise<WebTimestampVerdict> {
  try {
    if (!anchors.length) return { ok: false, code: "no-anchor", reason: "Zaman damgası güven kökü tanımlı değil" };
    const token = parseToken(tokenDer);
    if (!equal(token.imprint, imprint)) return { ok: false, code: "imprint-mismatch", reason: "Zaman damgası başka bir içeriğe ait" };
    if (options.nonce && !(token.nonce && equal(stripZeros(token.nonce), stripZeros(options.nonce)))) {
      return { ok: false, code: "nonce-mismatch", reason: "Zaman damgası bu isteğe verilmemiş (nonce)" };
    }
    if (options.notAfter && token.genTime.getTime() > options.notAfter.getTime()) {
      return { ok: false, code: "future-timestamp", reason: "Zaman damgası gelecekte" };
    }

    const contentType = token.attributes.get(OID.contentType);
    if (!contentType || asOid(contentType, "contentType") !== OID.tstInfo) fail("attribute-mismatch", "signedAttrs içindeki içerik türü TSTInfo değil");
    const messageDigest = token.attributes.get(OID.messageDigest);
    if (!messageDigest) fail("no-message-digest", "signedAttrs message-digest taşımıyor");
    if (!equal(await digest(HASH[token.digestAlgorithm], token.eContent), asOctetString(messageDigest!, "messageDigest"))) {
      return { ok: false, code: "digest-mismatch", reason: "signedAttrs, TSTInfo ile eşleşmiyor" };
    }
    await checkSignerBinding(token);
    if (!(await verifyWith(token.signer, token.signatureAlgorithm, token.signedAttributes, token.signature, token.digestAlgorithm))) {
      return { ok: false, code: "bad-signature", reason: "TSA imzası doğrulanamadı" };
    }
    await checkChain(token, anchors.map(parseCertificate));

    return {
      ok: true,
      at: token.genTime,
      authority: token.signer.commonName,
      serialNumber: hex(token.serialNumber),
      policy: token.policy,
    };
  } catch (error) {
    if (error instanceof TimestampError || error instanceof DerError) return { ok: false, code: error.code, reason: error.message };
    return { ok: false, code: "unparsable", reason: error instanceof Error ? error.message : String(error) };
  }
}

const stripZeros = (value: Uint8Array): Uint8Array => {
  let start = 0;
  while (start < value.length - 1 && value[start] === 0) start++;
  return value.subarray(start);
};
