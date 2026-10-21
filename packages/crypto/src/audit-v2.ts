// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import { b64, sha256, unb64, type Verdict } from "./receipt.ts";
import {
  KIONEL_V2_PROTOCOL, completeReceiptV2Bytes, isReceiptV2, verifyKeyReferenceV2,
  verifyReceiptV2,
  type KeyReferenceV2, type ReceiptV2,
} from "./evidence-v2.ts";
import { owned, verifyEs256, type CryptoBytes } from "./signature-v2.ts";
import type { AuditEvent, AuditVerdict } from "./audit.ts";

export interface AuditEntryV2 {
  v: 2;
  protocol: typeof KIONEL_V2_PROTOCOL;
  seq: number;
  previous: string | null;
  receipt: string;
  event: AuditEvent;
  at: string;
  actor: KeyReferenceV2;
  sig: string;
}

export async function verifyAuditLedgerV2(
  entries: readonly AuditEntryV2[],
  receipts?: readonly ReceiptV2[],
): Promise<AuditVerdict> {
  if (!Array.isArray(entries) || entries.length > 1_000_000) {
    return { ok: false, reason: "Kionel v2 audit dizisi veya kayıt sınırı geçersiz", entries: 0 };
  }
  let knownReceipts: Set<string> | undefined;
  if (receipts) {
    if (!Array.isArray(receipts)) return { ok: false, reason: "Kionel v2 makbuz listesi geçersiz", entries: 0 };
    knownReceipts = new Set<string>();
    for (const receipt of receipts) {
      if (!isReceiptV2(receipt) || !(await verifyReceiptV2(receipt)).ok) {
        return { ok: false, reason: "Kionel v2 audit girdisindeki makbuz doğrulanamadı", entries: 0 };
      }
      knownReceipts.add(b64(await receiptV2Hash(receipt)));
    }
  }
  let previous: AuditEntryV2 | null = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!isAuditEntryV2(entry) || entry.seq !== index || !(await verifyKeyReferenceV2(entry.actor))) {
      return { ok: false, reason: `Kionel v2 kayıt ${index}: biçim, anahtar veya sıra geçersiz`, entries: index };
    }
    const expectedPrevious = previous ? b64(await auditEntryV2Hash(previous)) : null;
    if (entry.previous !== expectedPrevious) {
      return { ok: false, reason: `Kionel v2 kayıt ${index}: hash zinciri koptu`, entries: index };
    }
    if (knownReceipts && !knownReceipts.has(entry.receipt)) {
      return { ok: false, reason: `Kionel v2 kayıt ${index}: ilişkili makbuz bulunamadı`, entries: index };
    }
    const { sig, ...body } = entry;
    let valid = false;
    try { valid = await verifyEs256(unb64(entry.actor.key), unb64(sig), auditV2BodyBytes(body)) } catch { valid = false }
    if (!valid) return { ok: false, reason: `Kionel v2 kayıt ${index}: imza geçersiz`, entries: index };
    previous = entry;
  }
  return { ok: true, reason: `${entries.length} Kionel v2 kayıt, imza ve hash zinciri doğrulandı`, entries: entries.length };
}

export async function receiptV2Hash(receipt: ReceiptV2): Promise<CryptoBytes> {
  return sha256(completeReceiptV2Bytes(receipt));
}

export function isAuditEntryV2(value: unknown): value is AuditEntryV2 {
  if (!value || typeof value !== "object") return false;
  const entry = value as AuditEntryV2;
  const keys = Object.keys(entry);
  const expected = ["v", "protocol", "seq", "previous", "receipt", "event", "at", "actor", "sig"];
  return keys.length === expected.length && keys.every((key) => expected.includes(key)) &&
    entry.v === 2 && entry.protocol === KIONEL_V2_PROTOCOL && Number.isSafeInteger(entry.seq) && entry.seq >= 0 &&
    (entry.previous === null || digest(entry.previous)) && digest(entry.receipt) && validAuditEvent(entry.event) &&
    timestamp(entry.at) && keyReferenceShape(entry.actor) && signature(entry.sig);
}

export function auditV2BodyBytes(body: Omit<AuditEntryV2, "sig">): CryptoBytes {
  return encode([
    "KIONEL-V2-AUDIT", body.v, body.protocol, body.seq, body.previous, body.receipt,
    body.event, body.at, [body.actor.alg, body.actor.kid, body.actor.key],
  ]);
}

export async function auditEntryV2Hash(entry: AuditEntryV2): Promise<CryptoBytes> {
  const { sig, ...body } = entry;
  return sha256(encode(["KIONEL-V2-AUDIT-ENTRY", b64(auditV2BodyBytes(body)), sig]));
}

function keyReferenceShape(value: KeyReferenceV2): boolean {
  return !!value && typeof value === "object" && Object.keys(value).length === 3 &&
    value.alg === "ES256" && /^urn:kionel:key:sha256:[A-Za-z0-9_-]{43}$/.test(value.kid) &&
    /^[A-Za-z0-9_-]{87}$/.test(value.key);
}
export function validAuditEvent(value: string): value is AuditEvent {
  return ["dispatch-issued", "receipt-verified", "receipt-exported"].includes(value);
}
export function validAuditDate(value: Date): boolean { return Number.isFinite(value.getTime()) }
function timestamp(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function digest(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) }
function signature(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_-]{86}$/.test(value) }
function encode(value: unknown): CryptoBytes { return owned(new TextEncoder().encode(JSON.stringify(value))) }

export type { Verdict };
