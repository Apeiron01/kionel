/** Codec benchmark only: synthetic pixels, no physical screen/camera evidence. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { cpus } from "node:os";
import { prepareZXingModule } from "zxing-wasm/reader";
import { encodeFrame, FrameType } from "@kionel/core";
import { frameBytes, toTiledBitmap, type Bitmap } from "@kionel/transport-qr/encode";
import { decodeFrames } from "../../transport-qr/src/decode.ts";

const wasm = new Uint8Array(readFileSync(new URL("../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", import.meta.url)));
await prepareZXingModule({ overrides: { wasmBinary: wasm.buffer } });
const option = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const trials = Number(option("trials") ?? 8);
if (!Number.isInteger(trials) || trials < 1 || trials > 100) throw new Error("trials: 1–100");

/** Same fixed pixel budget for every grid. Ideal, front-facing nearest-neighbor sampling. */
function sample(source: Bitmap, side: number): Bitmap {
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const src = (Math.floor(y * source.height / side) * source.width + Math.floor(x * source.width / side)) * 4;
    const dst = (y * side + x) * 4;
    data[dst] = source.data[src]; data[dst + 1] = source.data[src + 1];
    data[dst + 2] = source.data[src + 2]; data[dst + 3] = 255;
  }
  return { data, width: side, height: side };
}
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const rows = [];
for (const side of [360, 720, 1080]) for (const version of [15, 27, 40]) for (const tiles of [1, 4, 9]) {
  const encodeTimes: number[] = [], decodeTimes: number[] = [];
  let validSymbols = 0, corruptSymbols = 0, allReadImages = 0;
  const block = frameBytes(version) - 20;
  for (let trial = -1; trial < trials; trial++) {
    const frames = Array.from({ length: tiles }, (_, index) => {
      const payload = new Uint8Array(block);
      let state = ((trial + 2) * 101 + index + 1) >>> 0;
      for (let j = 0; j < payload.length; j++) {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        payload[j] = state & 255;
      }
      return encodeFrame({ type: FrameType.Data, sessionId: 42, seed: (trial + 2) * 10 + index, totalBytes: block * 100, blockSize: block, payload });
    });
    const started = performance.now();
    const bitmap = toTiledBitmap(frames, { version });
    const encodedAt = performance.now();
    const pixels = sample(bitmap, side);
    const decodeAt = performance.now();
    const found = await decodeFrames(pixels as unknown as ImageData, tiles);
    const ended = performance.now();
    const expected = new Set(frames.map(f => Buffer.from(f).toString("hex")));
    const valid = new Set<string>();
    let corrupt = 0;
    for (const bytes of found) {
      const key = Buffer.from(bytes).toString("hex");
      if (expected.has(key)) valid.add(key); else corrupt++;
    }
    if (trial < 0) continue; // one warm-up for each configuration
    encodeTimes.push(encodedAt - started); decodeTimes.push(ended - decodeAt);
    validSymbols += valid.size; corruptSymbols += corrupt;
    if (valid.size === tiles) allReadImages++;
  }
  const encodeP95Ms = percentile(encodeTimes, 0.95), decodeP95Ms = percentile(decodeTimes, 0.95);
  const modeledImageFps = Math.min(30, 1000 / encodeP95Ms, 1000 / decodeP95Ms);
  const row = {
    side, version, tiles, trials, expectedSymbols: trials * tiles, validSymbols, corruptSymbols, allReadImages,
    encodeP95Ms: +encodeP95Ms.toFixed(2), decodeP95Ms: +decodeP95Ms.toFixed(2),
    // This remains a model: synthetic recovery fraction plus measured codec timing.
    modeledPayloadKiBs: +(modeledImageFps * validSymbols / trials * block / 1024).toFixed(2),
  };
  rows.push(row);
  console.log(`${side}px v${version} x${tiles}: ${validSymbols}/${trials * tiles} symbols; encode p95 ${row.encodeP95Ms} ms; decode p95 ${row.decodeP95Ms} ms`);
}
const report = {
  schema: "kionel-optical-codec-benchmark/v1", evidence: "synthetic-codec-only", physicalDeviceRun: false,
  at: new Date().toISOString(), environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model },
  assumptions: "Equal square pixel budget; nearest-neighbor sampling; no optics, motion, exposure, screen refresh, thermal load or end-to-end crypto/fountain timing. Modeled throughput assumes a 30 fps display/camera budget; not field goodput.",
  rows,
};
const out = resolve(option("out") ?? "artifacts/optical-profile-lab.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(`Synthetic benchmark: ${out}`);
if (rows.some(row => row.corruptSymbols > 0)) process.exitCode = 1;
