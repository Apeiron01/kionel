// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * RFC 3161 request and response framing, with no platform crypto.
 *
 * Split out of rfc3161.ts so the browser can build a request and unwrap a
 * response without pulling in node:crypto. Node and the browser verify with
 * different crypto (rfc3161.ts, web.ts); both frame the messages here.
 */
import { DerReader, asInteger, sequenceReader } from "@kionel/attestation-core/asn1";

export class TimestampError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "TimestampError";
  }
}

export const fail = (code: string, message: string): never => {
  throw new TimestampError(code, message);
};

/** Minimal DER writer. Only the shapes a TimeStampReq and re-encoding need. */
const len = (n: number): number[] => {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let value = n; value > 0; value >>>= 8) out.unshift(value & 0xff);
  return [0x80 | out.length, ...out];
};
export const tlv = (tag: number, value: number[] | Uint8Array): number[] => [tag, ...len(value.length), ...value];
const seq = (...parts: number[][]): number[] => tlv(0x30, parts.flat());

/**
 * Builds a TimeStampReq for a SHA-256 imprint.
 *
 * `certReq` is true on purpose: without the TSA certificate in the response the
 * token cannot be verified offline later, and offline verification is the whole
 * point of a Kionel receipt.
 */
export function buildTimestampRequest(imprint: Uint8Array, nonce?: Uint8Array): Uint8Array {
  if (imprint.length !== 32) fail("bad-imprint", "RFC 3161 isteği 32 baytlık SHA-256 özeti gerektirir");

  const algorithm = seq(tlv(0x06, [0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01]), [0x05, 0x00]);
  const messageImprint = seq(algorithm, tlv(0x04, imprint));

  const parts = [tlv(0x02, [1]), messageImprint];
  if (nonce?.length) {
    // INTEGER must be positive and minimally encoded.
    const bytes = Array.from(nonce);
    while (bytes.length > 1 && bytes[0] === 0 && (bytes[1] & 0x80) === 0) bytes.shift();
    if (bytes[0] & 0x80) bytes.unshift(0);
    parts.push(tlv(0x02, bytes));
  }
  parts.push([0x01, 0x01, 0xff]); // certReq TRUE

  return Uint8Array.from(seq(...parts));
}

/** Strips a TimeStampResp down to its token, refusing any non-granted status. */
export function unwrapTimestampResponse(der: Uint8Array): Uint8Array {
  const reader = sequenceReader(new DerReader(der, "TimeStampResp").next(), "TimeStampResp");
  const status = sequenceReader(reader.next(), "PKIStatusInfo");
  const value = asInteger(status.next(), "PKIStatus");
  // 0 = granted, 1 = grantedWithMods. Anything else is a refusal.
  if (value !== 0 && value !== 1) fail("not-granted", `TSA isteği reddetti (PKIStatus ${value})`);
  if (reader.atEnd) fail("no-token", "TSA yanıtı zaman damgası taşımıyor");
  const token = reader.next();
  reader.end();
  // Re-encode the ContentInfo exactly as it arrived.
  return Uint8Array.from([...tlv(0x30, token.value)]);
}
