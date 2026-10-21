import { describe, expect, it } from "vitest";
import { encodeFrame, FrameType, LtDecoder, ltEncode, systematicEncode } from "@kionel/core";
import { SERIAL_BLOCK, Unwrapper, wrap } from "./serial-link.ts";

const frame = (seed: number, payload: Uint8Array) =>
  encodeFrame({ type: FrameType.Data, sessionId: 7, seed, totalBytes: 5000, blockSize: payload.length, payload });

describe("seri hat çerçeveleme", () => {
  it("rastgele bölünmüş akıştan çerçeveler aynen çıkar", () => {
    const frames = [1, 2, 3].map((seed) => frame(seed, crypto.getRandomValues(new Uint8Array(100))));
    const stream = new Uint8Array(frames.reduce((n, f) => n + f.length + 6, 0));
    let at = 0;
    for (const f of frames) { stream.set(wrap(f), at); at += f.length + 6; }
    const un = new Unwrapper();
    const out: Uint8Array[] = [];
    for (let i = 0; i < stream.length;) {
      const size = 1 + Math.floor(Math.random() * 37);
      out.push(...un.push(stream.subarray(i, i + size)));
      i += size;
    }
    expect(out).toEqual(frames);
    expect(un.discarded).toBe(0);
  });

  it("bozuk çerçeve ve baştaki çöp atlanır, sonraki çerçeve kurtulur", () => {
    const a = frame(1, new Uint8Array(50).fill(1)), b = frame(2, new Uint8Array(50).fill(2));
    const broken = wrap(a);
    broken[20] ^= 0xff; // yük içinde tek bayt hatası: CRC tutmaz
    const un = new Unwrapper();
    const out = un.push(new Uint8Array([9, 9, 0x4b, 0x4e, ...broken, ...wrap(b)]));
    expect(out).toEqual([b]);
    expect(un.discarded).toBeGreaterThan(0);
  });

  it("uçtan uca: kayıplı hattan fountain kodla dosya birebir gelir", () => {
    const content = crypto.getRandomValues(new Uint8Array(20_000));
    const un = new Unwrapper();
    const decoder = new LtDecoder(content.length, SERIAL_BLOCK);
    const sent = [...systematicEncode(content, SERIAL_BLOCK)];
    const fountain = ltEncode(content, SERIAL_BLOCK);
    for (let i = 0; i < 40; i++) sent.push(fountain.next().value!);
    sent.forEach(({ seed, payload }, i) => {
      let bytes = wrap(encodeFrame({ type: FrameType.Data, sessionId: 3, seed, totalBytes: content.length, blockSize: SERIAL_BLOCK, payload }));
      if (i % 5 === 0) bytes = bytes.slice(0, 200); // her beşinci çerçeve yarıda kesilir
      for (const f of un.push(bytes)) {
        const view = new DataView(f.buffer, f.byteOffset);
        decoder.ingest(view.getUint32(8), f.subarray(16, f.length - 4));
      }
    });
    expect(decoder.done).toBe(true);
    expect(decoder.result()).toEqual(content);
  });
});
