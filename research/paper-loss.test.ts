/**
 * Kâğıt kanalında kayıp kod dayanıklılığı: dört yapılandırma, üç dosya boyutu.
 * Normal test takımında atlanır; ölçüm için:
 *   RESEARCH=1 pnpm exec vitest run research/paper-loss.test.ts
 * Sonuç research/data/paper-loss.csv dosyasına yazılır (üzerine).
 *
 *  - random/peel:   sistematik bloklar + sıradan LT yedekleri, yalnız soyma
 *  - random/elim:   aynı yedekler, soyma takılınca Gauss eliminasyonu
 *  - dense/peel:    seçilmiş (derece ≥ k/3) yedekler, yalnız soyma
 *  - dense/elim:    seçilmiş yedekler + eliminasyon (Kionel'in yayımlanan yolu)
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { expect, it } from "vitest";
import { encodeFrame, decodeFrame, FrameType, LtDecoder, LtParams, ltEncode, systematicEncode } from "../packages/core/src/index.ts";
import { denseSeeds, paperPlan } from "../apps/web/src/paper.ts";

const SIZES = [5_000, 30_000, 150_000];
const LOSSES = [0, 1, 2, 3, 5, 8, 12];

function frames(wire: Uint8Array, spares: "random" | "dense"): Uint8Array[] {
  const plan = paperPlan(wire.length, "standard");
  const total = plan.pages * plan.columns * plan.rows;
  const frame = (seed: number, payload: Uint8Array) =>
    encodeFrame({ type: FrameType.Data, sessionId: 1, seed, totalBytes: wire.length, blockSize: plan.blockSize, payload });
  const out = [...systematicEncode(wire, plan.blockSize)].map(({ seed, payload }) => frame(seed, payload));
  if (spares === "random") {
    const lt = ltEncode(wire, plan.blockSize);
    while (out.length < total) { const { seed, payload } = lt.next().value!; out.push(frame(seed, payload)); }
    return out;
  }
  const params = new LtParams(plan.blocks);
  for (const seed of denseSeeds(plan.blocks, total - out.length)) {
    const payload = new Uint8Array(plan.blockSize);
    for (const index of params.neighbors(seed)) {
      const block = wire.subarray(index * plan.blockSize, (index + 1) * plan.blockSize);
      for (let i = 0; i < block.length; i++) payload[i] ^= block[i];
    }
    out.push(frame(seed, payload));
  }
  return out;
}

it.skipIf(!process.env.RESEARCH)("paper loss tolerance", { timeout: 3_600_000 }, () => {
  const rows = ["size_bytes,blocks,codes,spares,decoder,lost_codes,trials,recovered,rate"];
  for (const size of SIZES) {
    const wire = new Uint8Array(size);
    for (let i = 0; i < size; i += 65536) crypto.getRandomValues(wire.subarray(i, i + 65536));
    const trials = size > 100_000 ? 100 : 300;
    for (const spares of ["random", "dense"] as const) {
      const set = frames(wire, spares);
      const plan = paperPlan(size, "standard");
      for (const eliminate of [false, true]) {
        for (const lose of LOSSES) {
          let ok = 0;
          for (let t = 0; t < trials; t++) {
            const lost = new Set<number>();
            while (lost.size < Math.min(lose, set.length - 1)) lost.add(Math.floor(Math.random() * set.length));
            const decoder = new LtDecoder(size, plan.blockSize, { eliminate });
            // Sayfalar herhangi bir sırayla okunur.
            const order = set.map((_, i) => i).filter((i) => !lost.has(i)).sort(() => Math.random() - 0.5);
            for (const i of order) { const f = decodeFrame(set[i])!; decoder.ingest(f.seed, f.payload); if (decoder.done) break; }
            if (decoder.done) { expect(decoder.result()).toEqual(wire); ok++; }
          }
          rows.push([size, plan.blocks, set.length, spares, eliminate ? "elim" : "peel", lose, trials, ok, (ok / trials).toFixed(3)].join(","));
        }
      }
    }
  }
  mkdirSync(new URL("./data/", import.meta.url), { recursive: true });
  writeFileSync(new URL("./data/paper-loss.csv", import.meta.url), rows.join("\n") + "\n");
  console.log(rows.join("\n"));
});
