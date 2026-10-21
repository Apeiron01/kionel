// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/** Kullanım: pnpm audit:verify <ledger.json> [makbuz.json ...] */
import { readFileSync, statSync } from "node:fs";
import {
  verifyAuditLedger, verifyAuditLedgerV2,
  type AuditEntry, type AuditEntryV2, type Receipt, type ReceiptV2,
} from "@kionel/crypto";

const [ledgerFile, ...receiptFiles] = process.argv.slice(2);
if (!ledgerFile) {
  console.error("kullanım: pnpm audit:verify <ledger.json> [makbuz.json ...]");
  process.exit(2);
}

function readJson<T>(file: string): T {
  if (statSync(file).size > 10 * 1024 * 1024) throw new Error(`${file}: doğrulayıcı 10 MB sınırı aşıldı`);
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

try {
  const entries = readJson<unknown[]>(ledgerFile);
  if (!Array.isArray(entries)) throw new Error("ledger bir JSON dizisi olmalı");
  const receipts = receiptFiles.length ? receiptFiles.map((file) => readJson<unknown>(file)) : undefined;
  const v2 = entries.length > 0 && (entries[0] as { v?: unknown })?.v === 2;
  const verdict = v2
    ? await verifyAuditLedgerV2(entries as AuditEntryV2[], receipts as ReceiptV2[] | undefined)
    : await verifyAuditLedger(entries as AuditEntry[], receipts as Receipt[] | undefined);
  console.log(`${verdict.ok ? "GEÇERLİ" : "GEÇERSİZ"} — ${verdict.reason}`);
  process.exit(verdict.ok ? 0 : 1);
} catch (error) {
  console.error(`GEÇERSİZ — ${(error as Error).message}`);
  process.exit(1);
}
