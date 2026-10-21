// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "vitest";
import { createProtectedIdentity, verifyAuditLedger } from "@kionel/crypto";
import { issueAuditEntry, issueDispatch, issueReceipt } from "./index.ts";

const content = new TextEncoder().encode("laboratuvar numunesi #42");

async function fixture() {
  const sender = await createProtectedIdentity();
  const receiver = await createProtectedIdentity();
  const dispatch = await issueDispatch(sender, { session: 42, content });
  const receipt = await issueReceipt(receiver, { session: 42, content, sender: sender.pub, dispatch });
  const first = await issueAuditEntry(receiver, null, receipt, "receipt-verified", new Date("2026-01-01T00:00:00Z"));
  const second = await issueAuditEntry(receiver, first, receipt, "receipt-exported", new Date("2026-01-01T00:00:01Z"));
  return { receipt, entries: [first, second] };
}

test("imzalı audit ledger ve ilişkili makbuz çevrimdışı doğrulanır", async () => {
  const { receipt, entries } = await fixture();
  expect(await verifyAuditLedger(entries, [receipt])).toMatchObject({ ok: true, entries: 2 });
});

test("audit kaydı silinir, sıralanır veya değiştirilirse zincir kırılır", async () => {
  const { entries } = await fixture();
  expect((await verifyAuditLedger([entries[1]])).ok).toBe(false);
  expect((await verifyAuditLedger([...entries].reverse())).ok).toBe(false);
  expect((await verifyAuditLedger([entries[0], { ...entries[1], event: "dispatch-issued" }])).ok).toBe(false);
});
