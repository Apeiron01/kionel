import { describe, expect, it } from "vitest";
import { createIdentity, type Bytes } from "@kionel/crypto";
import { issueDispatch, issueReceipt } from "@kionel/issue";
import { csvCell, entryFor, inPeriod, summary, toCsv } from "./transfer-log.ts";

const bytes = (text: string) => new TextEncoder().encode(text) as Bytes;

describe("aktarım günlüğü", () => {
  it("satırı yalnız imzalı kayıttan üretir; teslimde iş emri ve karşı anahtar gelir", async () => {
    const [sender, receiver] = await Promise.all([createIdentity(), createIdentity()]);
    const content = bytes("numune,sonuc\nA-1,0.8\n");
    const context = { profile: "lab", reference: "WO-7", classification: "restricted", note: "LIMS" } as const;
    const dispatch = await issueDispatch(sender, { session: 7, content, context });
    const receipt = await issueReceipt(receiver, { session: 7, content, sender: sender.pub, dispatch });
    const sent = entryFor("sent", "a.csv", dispatch, new Date("2026-09-01T10:00:00Z"));
    const got = entryFor("received", "a.csv", receipt, new Date("2026-09-01T10:01:00Z"));
    expect(sent).toMatchObject({ kind: "sent", bytes: content.length, reference: "WO-7", classification: "restricted", target: "LIMS" });
    expect(sent.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(got.sha256).toBe(sent.sha256);
    expect(got.reference).toBe("WO-7");
    expect(got.peer).toBe(receipt.sender);
    expect(sent.peer).toBeUndefined();
  });

  it("CSV formül enjeksiyonunu etkisiz kılar ve özel karakterleri kaçışlar", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("satır\nsonu")).toBe('"satır\nsonu"');
    expect(csvCell("sonuç.csv")).toBe("sonuç.csv");
    expect(csvCell(undefined)).toBe("");
  });

  it("dönem süzgeci gün sonunu dahil eder; CSV BOM ve başlık taşır; özet sayar", async () => {
    const sender = await createIdentity();
    const d = await issueDispatch(sender, { session: 1, content: bytes("x"), context: { profile: "lab", reference: "=cmd" } });
    const entries = [
      entryFor("sent", "a", d, new Date(2026, 8, 1, 9)),
      entryFor("sealed", "b", d, new Date(2026, 8, 30, 23, 59)),
      entryFor("sent", "c", d, new Date(2026, 9, 1, 0, 1)),
    ];
    expect(inPeriod(entries, "2026-09-01", "2026-09-30").map((e) => e.file)).toEqual(["a", "b"]);
    const csv = toCsv(entries);
    expect(csv.startsWith("﻿time,event,file,bytes,sha256,work_order,")).toBe(true);
    expect(csv).toContain(",'=cmd,");
    expect(summary(entries)).toEqual({ sent: 2, received: 0, sealed: 1, timestamped: 0 });
  });
});

describe("operatör", () => {
  it("imzalı bağlamdaki operatör günlüğe ve CSV'nin son sütununa geçer", () => {
    const d = { v: 1, session: 1, hash: "AAAA", bytes: 3, at: "2026-09-25T10:00:00.000Z", sender: "k", sig: "s", context: { profile: "lab", reference: "WO-1", operator: "T. Bayar" } } as never;
    const entry = entryFor("sent", "a.csv", d);
    expect(entry.operator).toBe("T. Bayar");
    const [head, row] = toCsv([entry]).split("\r\n");
    expect(head.endsWith(",site_policy,operator")).toBe(true);
    expect(row.endsWith(",T. Bayar")).toBe(true);
  });
});
