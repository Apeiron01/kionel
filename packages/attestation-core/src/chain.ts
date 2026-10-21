// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * X.509 chain validation shared by every platform attestation verifier.
 *
 * Deliberately one implementation: a chain check that is fixed in the Windows
 * verifier but not the Android one is a vulnerability with a changelog entry
 * saying it was fixed.
 *
 * The rule that matters: the chain must terminate at an anchor the *enterprise*
 * configured. A root supplied inside the evidence proves nothing — it verifies
 * itself, which is what a forged chain also does.
 */
import { X509Certificate } from "node:crypto";

export type CertificateInput = string | Uint8Array;

export interface ChainOptions {
  anchors: readonly X509Certificate[];
  now: Date;
  maxLength: number;
}

export type ChainResult =
  | { ok: true; leaf: X509Certificate; chain: readonly X509Certificate[] }
  | { ok: false; reason: string };

export function parseAnchors(anchors: readonly CertificateInput[]): X509Certificate[] {
  return anchors.map((value) => new X509Certificate(toCertBuffer(value)));
}

export function validateCertificateChain(input: readonly CertificateInput[], options: ChainOptions): ChainResult {
  if (input.length === 0) return { ok: false, reason: "empty-certificate-chain" };
  if (options.anchors.length === 0) return { ok: false, reason: "no-trust-anchor-configured" };
  if (input.length > options.maxLength) return { ok: false, reason: "chain-too-long" };

  let chain: X509Certificate[];
  try {
    chain = input.map((value) => new X509Certificate(toCertBuffer(value)));
  } catch {
    return { ok: false, reason: "certificate-parse-failed" };
  }

  for (const cert of chain) {
    if (!withinValidity(cert, options.now)) return { ok: false, reason: "certificate-expired" };
  }
  const fingerprints = new Set<string>();
  for (const cert of chain) {
    if (fingerprints.has(cert.fingerprint256)) return { ok: false, reason: "duplicate-certificate" };
    fingerprints.add(cert.fingerprint256);
  }
  for (let i = 0; i + 1 < chain.length; i++) {
    const issuer = chain[i + 1];
    if (!issuer.ca) return { ok: false, reason: "issuer-not-ca" };
    if (!chain[i].checkIssued(issuer) || !chain[i].verify(issuer.publicKey)) {
      return { ok: false, reason: "broken-certificate-chain" };
    }
  }

  const last = chain[chain.length - 1];
  const anchored = options.anchors.some((anchor) => {
    if (!withinValidity(anchor, options.now) || !anchor.ca) return false;
    if (last.raw.equals(anchor.raw)) return true; // chain ends at a pinned anchor
    return last.checkIssued(anchor) && last.verify(anchor.publicKey);
  });
  return anchored ? { ok: true, leaf: chain[0], chain } : { ok: false, reason: "chain-not-anchored" };
}

/** Uncompressed SEC1 point of a P-256 certificate key, or undefined for any other key. */
export function sec1PublicKey(cert: X509Certificate): Uint8Array | undefined {
  const key = cert.publicKey;
  if (key.asymmetricKeyType !== "ec") return undefined;
  if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return undefined;
  const spki = key.export({ format: "der", type: "spki" });
  const point = spki.subarray(spki.length - 65);
  return point.length === 65 && point[0] === 4 ? new Uint8Array(point) : undefined;
}

export function withinValidity(cert: X509Certificate, now: Date): boolean {
  const from = Date.parse(cert.validFrom);
  const to = Date.parse(cert.validTo);
  return Number.isFinite(from) && Number.isFinite(to) && now.getTime() >= from && now.getTime() <= to;
}

function toCertBuffer(value: CertificateInput): Buffer | string {
  return typeof value === "string" ? value : Buffer.from(value);
}
