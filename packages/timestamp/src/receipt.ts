// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * Binding an RFC 3161 timestamp to a Kionel receipt.
 *
 * The imprint is SHA-256 over `completeReceiptV2Bytes` — the canonical encoding
 * that already includes the receipt's own signature. Stamping the signature
 * rather than the body is what makes the timestamp meaningful: it proves the
 * signature existed at that instant, which is the claim we actually need. It
 * also means the token can be attached later, by a different party, without
 * touching a single signed byte.
 *
 * This lives here and not in @kionel/crypto on purpose. The evidence core stays
 * free of X.509 and CMS; a deployment that never asks for a trusted timestamp
 * does not pull that machinery in.
 */

import { completeReceiptV2Bytes, sha256, type ReceiptV2 } from "@kionel/crypto";
import { buildTimestampRequest, verifyTimestamp, type TimestampPolicy, type TimestampVerdict } from "./rfc3161.ts";

/** A timestamp attached to a receipt. Never part of the signed body. */
export interface ReceiptTimestamp {
  /** RFC 3161 TimeStampToken, DER, base64. */
  token: string;
  /**
   * The authority's asserted time, mirrored so a human can read the file.
   * It carries no weight: the token is the authority, and a verifier that
   * trusts this field instead of the token has verified nothing.
   */
  at: string;
}

export interface TimestampedReceiptV2 extends ReceiptV2 {
  tst?: ReceiptTimestamp;
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");
const unb64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64"));

/** What a TSA must stamp for this receipt. */
export async function receiptTimestampImprint(receipt: ReceiptV2): Promise<Uint8Array> {
  return new Uint8Array(await sha256(completeReceiptV2Bytes(receipt)));
}

/** The DER TimeStampReq to POST to a TSA for this receipt. */
export async function receiptTimestampRequest(receipt: ReceiptV2, nonce?: Uint8Array): Promise<Uint8Array> {
  return buildTimestampRequest(await receiptTimestampImprint(receipt), nonce);
}

/**
 * Attaches a token after checking it actually stamps this receipt.
 *
 * Refusing to attach a mismatched token is the whole point: a receipt carrying
 * a timestamp for some other document is worse than one carrying none, because
 * it looks stronger while proving less.
 */
export async function attachReceiptTimestamp(
  receipt: ReceiptV2,
  tokenDer: Uint8Array,
  policy: TimestampPolicy,
): Promise<TimestampedReceiptV2> {
  const verdict = verifyTimestamp(tokenDer, await receiptTimestampImprint(receipt), policy);
  if (!verdict.ok) throw new Error(`Zaman damgası bu makbuza eklenemez: ${verdict.reason}`);
  return { ...receipt, tst: { token: b64(tokenDer), at: verdict.at.toISOString() } };
}

export type ReceiptTimestampVerdict =
  | { state: "absent" }
  | { state: "verified"; verdict: Extract<TimestampVerdict, { ok: true }> }
  | { state: "rejected"; code: string; reason: string };

/**
 * Three outcomes, not two. "Absent" is a legitimate state — most receipts will
 * never be timestamped — and collapsing it into "rejected" would make a
 * perfectly good receipt look forged.
 */
export async function verifyReceiptTimestamp(
  receipt: TimestampedReceiptV2,
  policy: TimestampPolicy,
): Promise<ReceiptTimestampVerdict> {
  if (!receipt.tst) return { state: "absent" };

  let token: Uint8Array;
  try {
    token = unb64(receipt.tst.token);
  } catch {
    return { state: "rejected", code: "bad-encoding", reason: "Zaman damgası base64 olarak çözülemedi" };
  }

  // The imprint is computed over the receipt without `tst`, because that is what
  // was stamped. Leaving the field in would make every timestamp self-defeating.
  const { tst, ...body } = receipt;
  const verdict = verifyTimestamp(token, await receiptTimestampImprint(body), policy);
  if (!verdict.ok) return { state: "rejected", code: verdict.code, reason: verdict.reason };

  // A mirrored time that disagrees with the token means the file was edited by
  // hand. The token still wins, but the disagreement is itself a finding.
  if (tst.at !== verdict.at.toISOString()) {
    return {
      state: "rejected",
      code: "mirrored-time-mismatch",
      reason: `Dosyadaki saat (${tst.at}) TSA jetonundaki saatle (${verdict.at.toISOString()}) uyuşmuyor`,
    };
  }

  return { state: "verified", verdict };
}
