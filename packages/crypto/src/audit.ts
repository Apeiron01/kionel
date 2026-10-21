// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/** Kurumsal denetim kaydı — çevrimdışı doğrulanabilir, imzalı hash zinciri. */
import type { Bytes } from "./index.ts";
import { b64, sha256, unb64, type Receipt } from "./receipt.ts";

export type AuditEvent = "dispatch-issued" | "receipt-verified" | "receipt-exported";

export interface AuditEntry {
  v: 1;
  seq: number;
  previous: string | null;
  receipt: string;
  event: AuditEvent;
  /** Cihaz saati; güvenilir zaman damgası değildir. */
  at: string;
  actor: string;
  sig: string;
}

export interface AuditVerdict {
  ok: boolean;
  reason: string;
  entries: number;
}

/** `receipts` verilirse ledger'daki her özetin eldeki bir makbuza aitliği de kanıtlanır. */
export async function verifyAuditLedger(entries: AuditEntry[], receipts?: Receipt[]): Promise<AuditVerdict> {
  const knownReceipts = receipts
    ? new Set(await Promise.all(receipts.map(async (receipt) => b64(await receiptHash(receipt)))))
    : undefined;
  let previous: AuditEntry | null = null;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (!validEntryShape(entry) || entry.seq !== index) {
      return { ok: false, reason: `kayıt ${index}: biçim veya sıra geçersiz`, entries: index };
    }
    const expectedPrevious = previous ? b64(await auditEntryHash(previous)) : null;
    if (entry.previous !== expectedPrevious) {
      return { ok: false, reason: `kayıt ${index}: hash zinciri koptu`, entries: index };
    }
    if (knownReceipts && !knownReceipts.has(entry.receipt)) {
      return { ok: false, reason: `kayıt ${index}: ilişkili makbuz bulunamadı`, entries: index };
    }
    try {
      const key = await globalThis.crypto.subtle.importKey("raw", unb64(entry.actor), { name: "Ed25519" }, false, ["verify"]);
      const { sig, ...body } = entry;
      const ok = await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, unb64(sig), auditBodyBytes(body));
      if (!ok) return { ok: false, reason: `kayıt ${index}: imza geçersiz`, entries: index };
    } catch {
      return { ok: false, reason: `kayıt ${index}: anahtar veya imza geçersiz`, entries: index };
    }
    previous = entry;
  }
  return { ok: true, reason: `${entries.length} kayıt, imzalar ve hash zinciri doğrulandı`, entries: entries.length };
}

export function receiptHash(receipt: Receipt): Promise<Bytes> {
  return sha256(receiptBytes(receipt));
}

export function auditEntryHash(entry: AuditEntry): Promise<Bytes> {
  const { sig, ...body } = entry;
  return sha256(concat(auditBodyBytes(body), new TextEncoder().encode(sig)));
}

export function auditBodyBytes(body: Omit<AuditEntry, "sig">): Bytes {
  return new TextEncoder().encode(JSON.stringify([
    "kionel-audit", body.v, body.seq, body.previous, body.receipt, body.event, body.at, body.actor,
  ]));
}

function receiptBytes(receipt: Receipt): Bytes {
  const dispatch = receipt.dispatch
    ? [receipt.dispatch.v, receipt.dispatch.session, receipt.dispatch.hash, receipt.dispatch.bytes,
      receipt.dispatch.at, receipt.dispatch.sender, receipt.dispatch.sig]
    : null;
  return new TextEncoder().encode(JSON.stringify([
    "kionel-receipt", receipt.v, receipt.session, receipt.hash, receipt.bytes, receipt.at,
    receipt.sender, receipt.receiver, dispatch, receipt.sig,
  ]));
}

function validEntryShape(entry: AuditEntry): boolean {
  return entry?.v === 1 && Number.isInteger(entry.seq) && entry.seq >= 0 &&
    (entry.previous === null || /^[A-Za-z0-9_-]{43}$/.test(entry.previous)) &&
    /^[A-Za-z0-9_-]{43}$/.test(entry.receipt) &&
    ["dispatch-issued", "receipt-verified", "receipt-exported"].includes(entry.event) &&
    typeof entry.at === "string" && entry.at.length <= 40 && Number.isFinite(Date.parse(entry.at)) &&
    /^[A-Za-z0-9_-]{43}$/.test(entry.actor) && /^[A-Za-z0-9_-]{86}$/.test(entry.sig);
}

function concat(a: Bytes, b: Bytes): Bytes {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
