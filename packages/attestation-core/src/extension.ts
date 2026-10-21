// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * X.509 extension lookup.
 *
 * Node's `X509Certificate` exposes no generic extension accessor, and every
 * platform attestation format hides its evidence in a vendor extension:
 * Android in 1.3.6.1.4.1.11129.2.1.17, Apple in 1.2.840.113635.100.8.2.
 * One walker, shared, so a hardening fix lands everywhere at once.
 *
 * This locates bytes only. Trust comes from the chain check — never from the
 * fact that an extension was present.
 */
import { DerClass, DerReader, DerTag, asOctetString, expect, explicit, readerOf, sequenceReader } from "./asn1.ts";

export function findExtension(certificateDer: Uint8Array, oid: Uint8Array): Uint8Array | undefined {
  const certificate = sequenceReader(new DerReader(certificateDer, "Certificate").next(), "Certificate");
  const tbs = sequenceReader(certificate.next(), "TBSCertificate");

  let extensions: ReturnType<DerReader["next"]> | undefined;
  while (!tbs.atEnd) {
    const field = tbs.next();
    if (field.tagClass === DerClass.Context && field.constructed && field.tag === 3) {
      extensions = explicit(field, "Extensions");
      break;
    }
  }
  if (!extensions) return undefined;

  const list = readerOf(expect(extensions, DerClass.Universal, DerTag.Sequence, true, "Extensions"), "Extensions");
  while (!list.atEnd) {
    const entry = sequenceReader(list.next(), "Extension");
    const id = expect(entry.next(), DerClass.Universal, DerTag.Oid, false, "extnID");
    let value = entry.next();
    if (value.tagClass === DerClass.Universal && value.tag === DerTag.Boolean) value = entry.next(); // critical
    const contents = asOctetString(value, "extnValue");
    entry.end();
    if (sameBytes(id.value, oid)) return contents;
  }
  return undefined;
}

/** Encodes an OID's content octets, e.g. "1.2.840.113635.100.8.2". */
export function oidBytes(oid: string): Uint8Array {
  const parts = oid.split(".").map(Number);
  if (parts.length < 2 || parts.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("geçersiz OID");
  }
  const out = [parts[0] * 40 + parts[1]];
  for (const part of parts.slice(2)) {
    const chunks: number[] = [];
    for (let value = part; value > 0; value = Math.floor(value / 128)) chunks.unshift(value % 128);
    if (chunks.length === 0) chunks.push(0);
    for (let i = 0; i < chunks.length - 1; i++) chunks[i] |= 0x80;
    out.push(...chunks);
  }
  return Uint8Array.from(out);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
