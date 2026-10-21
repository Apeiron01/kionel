/**
 * Büyük ekran profili: tek görüntüde birden fazla kare.
 *
 * İddia, kamera dört kodu tek karede okursa verimin dörde katlanması. İddianın
 * kolay kısmı çizmek; asıl soru gerçek bir okuyucunun hepsini bulup bulmadığı.
 * Bu test tam olarak onu soruyor — kodları çizip aynı görüntüyü gerçek zxing'e
 * veriyor ve dördünün de bozulmadan geri geldiğini istiyor.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareZXingModule } from "zxing-wasm/reader";
import { decodeFrames } from "../../transport-qr/src/decode.ts";
import { decodeFrame, encodeFrame, FrameType } from "@kionel/core";
import { frameBytes, toTiledBitmap } from "@kionel/transport-qr/encode";

const wasm = readFileSync(new URL("../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", import.meta.url));
prepareZXingModule({ overrides: { wasmBinary: wasm.buffer as ArrayBuffer } });

const VERSION = 20;
const BLOCK = frameBytes(VERSION) - 20;

const makeFrame = (seed: number): Uint8Array => {
  const payload = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) payload[i] = (seed * 131 + i * 17) & 0xff;
  return encodeFrame({
    type: FrameType.Data, sessionId: 0xabcdef01, seed,
    totalBytes: BLOCK * 8, blockSize: BLOCK, payload,
  });
};

async function readTile(frames: Uint8Array[], scale: number): Promise<Uint8Array[]> {
  const bitmap = toTiledBitmap(frames, { version: VERSION }, scale);
  return decodeFrames(bitmap as unknown as ImageData, frames.length);
}

describe("döşenmiş kareler", () => {
  it("yoğun v40 ızgarasında satır taraması dokuz kodun altısını atlamaz", async () => {
    const frames = Array.from({ length: 9 }, (_, index) => new Uint8Array(frameBytes(40)).fill(index + 1));
    const bitmap = toTiledBitmap(frames, { version: 40 }, 2);
    const found = await decodeFrames(bitmap as unknown as ImageData, 9);
    expect(found.map(b => Buffer.from(b).toString("hex")).sort())
      .toEqual(frames.map(b => Buffer.from(b).toString("hex")).sort());
  });
  it("dört kare tek görüntüde çizilir ve dördü de okunur", async () => {
    const frames = [1, 2, 3, 4].map(makeFrame);
    const scanned = await readTile(frames, 3);

    expect(scanned, "dört koddan bazıları okunamadı").toHaveLength(4);
    const seeds = scanned.map((bytes) => decodeFrame(bytes)?.seed).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(seeds).toEqual([1, 2, 3, 4]);
    expect(scanned.map(b => Buffer.from(b).toString("hex")).sort())
      .toEqual(frames.map(b => Buffer.from(b).toString("hex")).sort());
  }, 60_000);

  it("dokuz kare de okunabiliyor — ızgara kare kalıyor", async () => {
    const frames = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(makeFrame);
    const bitmap = toTiledBitmap(frames, { version: VERSION }, 2);
    // 3×3 ızgara: genişlik ve yükseklik eşit olmalı, yoksa ekranın kısa kenarı
    // boşa gider.
    expect(bitmap.width).toBe(bitmap.height);
    expect(await readTile(frames, 2)).toHaveLength(9);
  }, 60_000);

  it("tek kare verilince sade bitmap üretir — döşeme için bedel ödenmez", () => {
    const single = toTiledBitmap([makeFrame(1)], { version: VERSION }, 3);
    expect(single.width).toBe(single.height);
  });

  it("boş liste reddedilir", () => {
    expect(() => toTiledBitmap([], { version: VERSION })).toThrow(/döşenecek kare yok/);
  });
});
