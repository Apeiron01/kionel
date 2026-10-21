/**
 * Tüm yığının en riskli varsayımı: rastgele ikili veri QR "byte mode"dan
 * karakter setine dokunulmadan aynen geri çıkıyor mu? Çıkmazsa protokol
 * metin kodlamasına (base45 vb.) geçmek zorunda kalır ve kapasite düşer.
 * Bu test kamera olmadan koşar.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { encodeFrame, FrameType, decodeFrame as parseFrame } from "@kionel/core";
import { frameBytes, toBitmap } from "./encode.ts";

const wasm = readFileSync(
  new URL("../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", import.meta.url),
);
prepareZXingModule({ overrides: { wasmBinary: wasm.buffer as ArrayBuffer } });

async function roundTrip(bytes: Uint8Array, version: number): Promise<Uint8Array | null> {
  // scale 3: kameranın gördüğüne yakın, çözücüye bedava kolaylık yok
  // Node'da ImageData sınıfı yok; zxing yapıyı ördek-tipiyle kabul ediyor.
  const r = await readBarcodes(toBitmap(bytes, { version }, 3) as unknown as ImageData, {
    formats: ["QRCode"],
    maxNumberOfSymbols: 1,
  });
  return r[0]?.bytes ?? null;
}

test("rastgele ikili veri QR byte-mode'dan bozulmadan döner", async () => {
  const raw = new Uint8Array(1400);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 97 + (i % 7) * 31) & 0xff;
  raw.set([0x00, 0xff, 0xfe, 0x80, 0x0a, 0x0d, 0x1a], 0); // NUL/UTF-8 dışı/satır sonu tuzakları
  expect([...(await roundTrip(raw, 27))!]).toEqual([...raw]);
});

test("Kionel çerçevesi QR üzerinden uçtan uca geçiyor", async () => {
  const payload = crypto.getRandomValues(new Uint8Array(frameBytes(27) - 20));
  const wire = encodeFrame({
    type: FrameType.Data, sessionId: 0xdeadbeef, seed: 123456, totalBytes: 987654,
    blockSize: payload.length, payload,
  });
  const frame = parseFrame((await roundTrip(wire, 27))!);
  expect(frame).not.toBeNull();
  expect(frame!.seed).toBe(123456);
  expect(frame!.sessionId).toBe(0xdeadbeef);
  expect([...frame!.payload]).toEqual([...payload]);
});

test("kapasite tablosu gerçek QR kapasitesiyle uyuşuyor", () => {
  for (const v of [15, 27, 40]) {
    expect(() => toBitmap(new Uint8Array(frameBytes(v)), { version: v })).not.toThrow();
    expect(() => toBitmap(new Uint8Array(frameBytes(v) + 1), { version: v })).toThrow();
  }
});

test("odak bölgesi: kodun çevresi, kenara kırpılmış; kareyi kaplıyorsa kırpma yok", async () => {
  const { focusRegion } = await import("./decode.ts");
  expect(focusRegion([{ x: 700, y: 150, w: 440, h: 440 }], 1280, 720)).toEqual({ x: 480, y: 0, w: 800, h: 720 });
  expect(focusRegion([{ x: 500, y: 300, w: 100, h: 100 }], 1920, 1080)).toEqual({ x: 450, y: 250, w: 200, h: 200 });
  expect(focusRegion([{ x: 100, y: 100, w: 1100, h: 500 }], 1280, 720)).toBeUndefined();
  expect(focusRegion([], 1280, 720)).toBeUndefined();
});
