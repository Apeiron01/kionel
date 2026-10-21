import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { b64, createIdentity, type Bytes } from "@kionel/crypto";
import { issueDispatch, issueReceipt } from "@kionel/issue";
import { explainReason, inspectEvidence } from "./evidence-view.ts";

const te = new TextEncoder();
const file = te.encode("numune,sonuc\nA-1,0.8\n") as Bytes;
const other = te.encode("numune,sonuc\nA-1,9.9\n") as Bytes;
const context = { profile: "lab", reference: "LCMS-2026-0042", classification: "confidential", note: "LC-MS" } as const;

async function records() {
  const [sender, receiver] = await Promise.all([createIdentity(), createIdentity()]);
  const dispatch = await issueDispatch(sender, { session: 7, content: file, context });
  const receipt = await issueReceipt(receiver, { session: 7, content: file, sender: sender.pub, dispatch });
  return { dispatch, receipt };
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

describe("kanıt görünümü — olumlu sonuçlar", () => {
  it("dosyayla birlikte geçerli makbuz: üç kontrol de geçer", async () => {
    const { receipt } = await records();
    const report = await inspectEvidence(clone(receipt), file, "result.csv");
    expect(report.ok).toBe(true);
    expect(report.headline).toMatch(/^Valid: .*both devices\. The file matches\./);
    expect(report.checks.map((c) => c.state)).toEqual(["ok", "ok", "ok", "skip"]); // damga yok: cihaz saati;
    expect(report.facts).toContainEqual(["Work order / reference", "LCMS-2026-0042"]);
    expect(report.facts.find(([k]) => k === "SHA-256")![1]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("dosyasız geçerli makbuz: içerik kontrolü atlanır ve bunu söyler", async () => {
    const { receipt } = await records();
    const report = await inspectEvidence(clone(receipt));
    expect(report.ok).toBe(true);
    expect(report.checks[2]).toMatchObject({ state: "skip", detail: expect.stringMatching(/add the original file/) });
  });

  it("geçerli sevk kaydı: teslimi kanıtlamadığını da söyler", async () => {
    const { dispatch } = await records();
    const report = await inspectEvidence(clone(dispatch), file);
    expect(report.ok).toBe(true);
    expect(report.kind).toBe("dispatch");
    expect(report.checks[1].detail).toMatch(/not what arrived/);
  });
});

describe("kanıt görünümü — olumsuz sonuçlar", () => {
  it("başka dosya: imzalar geçer, içerik düşer ve neden açıkça yazılır", async () => {
    const { receipt } = await records();
    const report = await inspectEvidence(clone(receipt), other);
    expect(report.ok).toBe(false);
    expect(report.headline).toMatch(/not the file that was transferred/);
    expect(report.checks.map((c) => c.state)).toEqual(["ok", "ok", "fail", "skip"]);
  });

  it("makbuzdaki iş emri değiştirilirse makbuz geçersiz olur", async () => {
    const { receipt } = await records();
    const edited = clone(receipt);
    edited.dispatch!.context!.reference = "LCMS-2026-9999";
    const report = await inspectEvidence(edited, file);
    expect(report.ok).toBe(false);
    expect(report.headline).toMatch(/^Not valid: /);
    expect(report.checks.some((c) => c.state === "fail")).toBe(true);
  });

  it("değiştirilmiş sevk kaydı reddedilir", async () => {
    const { dispatch } = await records();
    const report = await inspectEvidence({ ...clone(dispatch), bytes: dispatch.bytes + 1 });
    expect(report.ok).toBe(false);
    expect(report.checks[0].state).toBe("fail");
  });

  it("Kionel kaydı olmayan girdiler anlaşılır biçimde reddedilir", async () => {
    for (const value of [null, "text", [1, 2], { hello: "world" }]) {
      const report = await inspectEvidence(value);
      expect(report).toMatchObject({ ok: false, kind: "unknown" });
      expect(report.headline).toMatch(/not a Kionel receipt or dispatch record/);
    }
  });

  it("kripto paketinin her nedeni İngilizceye çevrilir; Türkçe metin arayüze sızmaz", () => {
    const source = readFileSync(new URL("../../../packages/crypto/src/receipt.ts", import.meta.url), "utf8");
    const reasons = [...source.matchAll(/reason: "([^"]+)"/g)].map((m) => m[1]);
    expect(reasons.length).toBeGreaterThan(5);
    for (const reason of reasons) expect(explainReason(reason), reason).not.toBe(reason);
  });

  it("b64 büyük içerikte taşmaz", () => {
    expect(b64(new Uint8Array(1_000_000) as Bytes).length).toBeGreaterThan(1_000_000);
  });
});
