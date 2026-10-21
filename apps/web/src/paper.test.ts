import { describe, expect, it } from "vitest";
import { decodeFrame, LtDecoder } from "@kionel/core";
import { paperFrames, paperPlan } from "./paper.ts";

describe("kâğıda basılan aktarım", () => {
  it("sayfa sayısı: blok + %30 yedek, sayfalar tam dolar", () => {
    const plan = paperPlan(20_000, "standard");
    expect(plan.blockSize).toBe(838);
    expect(plan.blocks).toBe(24);
    expect(plan.codes).toBe(24 + 8);
    expect(plan.pages).toBe(6);
    expect(paperPlan(100, "dense")).toMatchObject({ blocks: 1, codes: 3, pages: 1 });
    expect(paperFrames(new Uint8Array(20_000), "standard", 1)).toHaveLength(36);
  });

  it("kodların beşte biri okunamasa da dosya birebir geri gelir, sıra fark etmez", () => {
    const wire = crypto.getRandomValues(new Uint8Array(30_000));
    const frames = paperFrames(wire, "standard", 42);
    const lost = new Set([0, 3, 7, 11, 12, 18, 25, 30]);
    const decoder = new LtDecoder(wire.length, paperPlan(wire.length, "standard").blockSize);
    for (const [i, bytes] of [...frames.entries()].reverse()) {
      if (lost.has(i)) continue;
      const frame = decodeFrame(bytes)!;
      expect(frame.sessionId).toBe(42);
      decoder.ingest(frame.seed, frame.payload);
    }
    expect(decoder.done).toBe(true);
    expect(decoder.result()).toEqual(wire);
  });
});

describe("ücretsiz sayfa sınırı için okuma tarafı hesabı", () => {
  it("blok boyutundan yoğunluk, oradan sayfa sayısı; ekran akışında undefined", async () => {
    const { pagesFor } = await import("./paper.ts");
    expect(pagesFor(20_000, 838)).toBe(paperPlan(20_000, "standard").pages);
    expect(pagesFor(100_000, 1253)).toBe(paperPlan(100_000, "dense").pages);
    expect(pagesFor(20_000, 1445)).toBeUndefined();
  });
});
