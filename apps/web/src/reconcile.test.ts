import { describe, expect, it } from "vitest";
import { createIdentity } from "@kionel/crypto";
import { issueDispatch, issueReceipt } from "@kionel/issue";
import { reconcileLink } from "./reconcile.ts";

const bytes = (text: string) => new TextEncoder().encode(text);

async function link() {
  const sender = await createIdentity();
  const receiver = await createIdentity();
  const files = ["a.csv", "b.csv", "c.csv"];
  const sent = [], received = [];
  for (const [index, file] of files.entries()) {
    const content = bytes(`numune,${file}\n`);
    const dispatch = await issueDispatch(sender, { session: 1000 + index, content, context: { profile: "lab", reference: `WO-${index}` } });
    sent.push({ kind: "sent", at: dispatch.at, file, record: dispatch });
    const receipt = await issueReceipt(receiver, { session: dispatch.session, content, sender: sender.pub, dispatch });
    received.push({ kind: "received", at: receipt.at, file, record: receipt });
  }
  return { sent, received };
}

describe("tek yönlü bağlantı mutabakatı", () => {
  it("her sevkin makbuzu varsa hepsi teslim edilmiş çıkar", async () => {
    const { sent, received } = await link();
    const report = await reconcileLink(sent, received);
    expect(report).toMatchObject({ delivered: 3, missing: 0, invalid: 0, unmatched: 0 });
    expect(report.rows.every((row) => row.state === "delivered" && row.receivedAt)).toBe(true);
  });

  it("ulaşmayan dosyayı adıyla ve en üstte gösterir", async () => {
    const { sent, received } = await link();
    const report = await reconcileLink(sent, received.filter((entry) => entry.file !== "b.csv"));
    expect(report).toMatchObject({ delivered: 2, missing: 1, invalid: 0 });
    expect(report.rows[0]).toMatchObject({ file: "b.csv", state: "missing" });
  });

  it("değiştirilmiş makbuzu ve değiştirilmiş sevk kaydını teslim saymaz", async () => {
    const { sent, received } = await link();
    const forged = received.map((entry) => entry.file === "a.csv" ? { ...entry, record: { ...entry.record, at: "2020-01-01T00:00:00.000Z" } } : entry);
    expect(await reconcileLink(sent, forged)).toMatchObject({ delivered: 2, invalid: 1 });
    const edited = sent.map((entry) => entry.file === "c.csv" ? { ...entry, record: { ...entry.record, bytes: 1 } } : entry);
    const report = await reconcileLink(edited, received);
    expect(report.rows.find((row) => row.file === "c.csv")).toMatchObject({ state: "invalid", reason: "the sender's record does not verify" });
  });

  it("mühürlenip başka yoldan taşınan dosyayı da gönderenin kaydı sayar", async () => {
    const { sent, received } = await link();
    const sealed = sent.map((entry) => ({ ...entry, kind: "sealed" }));
    expect(await reconcileLink(sealed, received)).toMatchObject({ delivered: 3, missing: 0 });
  });

  it("gönderenin listesinde olmayan makbuzları ayrı sayar", async () => {
    const { sent, received } = await link();
    expect(await reconcileLink(sent.slice(0, 1), received)).toMatchObject({ delivered: 1, unmatched: 2 });
  });

  it("yanlış dosyayı, ters verilen dosyaları ve boş dönemi açık bir hatayla reddeder", async () => {
    const { sent, received } = await link();
    await expect(reconcileLink({ not: "a list" }, received)).rejects.toThrow(/sender's file is not a Kionel records file/);
    await expect(reconcileLink(received, sent)).rejects.toThrow(/sender's file has no sent or sealed records/);
    await expect(reconcileLink(sent, [])).rejects.toThrow(/receiver's file has no received records/);
  });
});
