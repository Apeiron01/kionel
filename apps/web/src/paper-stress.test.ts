import { expect, it } from "vitest";
import { decodeFrame, LtDecoder } from "@kionel/core";
import { paperFrames, paperPlan } from "./paper.ts";

it("gerçek deneme gibi: 115 KB, sayfa sayfa, tekrarlı, karışık; teslim edilen hep birebir", { timeout: 600_000 }, () => {
  let completed = 0, wrong = 0;
  for (let trial = 0; trial < 60; trial++) {
    const size = 110_000 + trial * 97;
    const wire = new Uint8Array(size);
    for (let i = 0; i < size; i += 65536) crypto.getRandomValues(wire.subarray(i, i + 65536));
    const frames = paperFrames(wire, "standard", trial + 1);
    const plan = paperPlan(size, "standard");
    const decoder = new LtDecoder(size, plan.blockSize);
    // Sayfalar kaydırılarak okunur: her sayfanın kodları birkaç kez, bazıları hiç; sayfalar ileri geri.
    const pages = Array.from({ length: plan.pages }, (_, p) => frames.slice(p * 6, (p + 1) * 6));
    const order = [...pages.keys()].sort(() => Math.random() - 0.5);
    outer: for (const round of [0, 1]) {
      for (const p of order) {
        for (const bytes of pages[p]) {
          if (Math.random() < 0.15) continue;
          for (let k = 0; k < 1 + Math.floor(Math.random() * 4); k++) {
            const f = decodeFrame(bytes)!;
            decoder.ingest(f.seed, f.payload);
            if (decoder.done) break outer;
          }
        }
      }
      void round;
    }
    if (decoder.done) {
      completed++;
      if (!decoder.result()!.every((b, i) => b === wire[i])) wrong++;
    }
  }
  console.log(`tamamlanan ${completed}/60, yanlış ${wrong}`);
  expect(wrong).toBe(0);
  expect(completed).toBeGreaterThan(50);
});
