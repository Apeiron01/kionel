import { expect, test } from "vitest";
import { FrameType, crc32, decodeFrame, encodeFrame } from "./frame.ts";
import { LtDecoder, LtParams, ltEncode, systematicEncode, systematicIndex } from "./fountain.ts";
import { PROFILES, simulate } from "./channel.ts";
import { packSecureEnvelope, unpackSecureEnvelope } from "./secure-envelope.ts";
import { unpack } from "./envelope.ts";

const bytes = (n: number, seed = 7) => {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + seed * 17) & 0xff;
  return a;
};

test("güvenli zarf metaveri ve kapalı içeriği kayıpsız taşır", () => {
  const sealed = bytes(512);
  const decoded = unpackSecureEnvelope(packSecureEnvelope({ metadata: '{"v":1}', sealed }))!;
  expect(decoded.metadata).toBe('{"v":1}');
  expect([...decoded.sealed]).toEqual([...sealed]);
  expect(unpackSecureEnvelope(Uint8Array.of(1, 0, 0, 1, 0))).toBeNull();
});

test("frame round-trip", () => {
  const payload = bytes(64);
  const f = { type: FrameType.Data, sessionId: 9, seed: 12345, totalBytes: 1000, blockSize: 64, payload };
  const decoded = decodeFrame(encodeFrame(f))!;
  expect(decoded.seed).toBe(12345);
  expect(decoded.totalBytes).toBe(1000);
  expect([...decoded.payload]).toEqual([...payload]);
});

test("güvenilmeyen çerçeve alanları bellek ayırmadan reddedilir", () => {
  const valid = encodeFrame({
    type: FrameType.Data, sessionId: 1, seed: 1, totalBytes: 64, blockSize: 64, payload: bytes(64),
  });
  const oversized = valid.slice();
  new DataView(oversized.buffer).setUint32(12, 0xffffffff);
  new DataView(oversized.buffer).setUint32(oversized.length - 4, crc32(oversized, 0, oversized.length - 4));
  expect(decodeFrame(oversized)).toBeNull();

  const wrongBlock = valid.slice();
  new DataView(wrongBlock.buffer).setUint16(2, 63);
  new DataView(wrongBlock.buffer).setUint32(wrongBlock.length - 4, crc32(wrongBlock, 0, wrongBlock.length - 4));
  expect(decodeFrame(wrongBlock)).toBeNull();
  expect(() => new LtDecoder(0xffffffff, 1)).toThrow(/kaynak sınırı/);
});

test("bozuk ve aşırı büyük zarf metaverisi reddedilir", () => {
  expect(unpack(Uint8Array.of(1, 250, 0, 0, 0, 0))).toBeNull();
  expect(() => packSecureEnvelope({ metadata: "x".repeat(65_537), sealed: bytes(10) })).toThrow(/sınırı/);
});

test("tek bit bozulması CRC ile yakalanır", () => {
  const wire = encodeFrame({
    type: FrameType.Data, sessionId: 1, seed: 1, totalBytes: 64, blockSize: 64, payload: bytes(64),
  });
  wire[20] ^= 0x01;
  expect(decodeFrame(wire)).toBeNull();
});

test("komşu seçimi çağrı sırasından bağımsız (decoder kareleri sırasız görür)", () => {
  const p = new LtParams(50);
  const ref = [1, 2, 999, 65535].map((s) => new LtParams(50).neighbors(s));
  p.neighbors(7); // araya giren çağrılar sonucu değiştirmemeli
  for (const [i, seed] of [1, 2, 999, 65535].entries()) {
    const a = p.neighbors(seed);
    expect(a).toEqual(ref[i]);
    expect(new Set(a).size).toBe(a.length); // tekrarsız
    expect(a.length).toBeGreaterThanOrEqual(1);
    expect(a.length).toBeLessThanOrEqual(50);
  }
});

test("fountain kodu kayıpsız kanalda dosyayı geri kurar", () => {
  const data = bytes(50_000, 3);
  const blockSize = 500;
  const dec = new LtDecoder(data.length, blockSize);
  for (const { seed, payload } of ltEncode(data, blockSize)) {
    dec.ingest(seed, payload);
    if (dec.done) break;
  }
  expect([...dec.result()!]).toEqual([...data]);
});

test("%20 kare kaybı altında uçtan uca aktarım", () => {
  const data = bytes(200_000, 5);
  const r = simulate(data, PROFILES["qr-v27-L-30"], { lossRate: 0.2, corruptRate: 0.02, seed: 42 });
  expect(r.ok).toBe(true);
  expect(r.overhead).toBeLessThan(1.5); // fountain fazlalığı makul kalmalı
});

test("soyma takılınca Gauss eliminasyonu kalan blokları doğru çözer", () => {
  const blockSize = 64;
  const data = new Uint8Array(40 * blockSize - 7);
  for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) & 0xff;
  const k = Math.ceil(data.length / blockSize);
  const params = new LtParams(k);
  const dec = new LtDecoder(data.length, blockSize);
  // Sistematik blokların onu eksik; yerine yalnız yoğun (derece ≥ k/3) LT kareleri gelir.
  const lost = new Set([0, 4, 9, 13, 17, 22, 26, 30, 35, 39]);
  for (const { seed, payload } of systematicEncode(data, blockSize)) {
    if (!lost.has(systematicIndex(seed)!)) dec.ingest(seed, payload);
  }
  let fed = 0;
  for (const { seed, payload } of ltEncode(data, blockSize)) {
    if (params.neighbors(seed).length < k / 3) continue;
    dec.ingest(seed, payload);
    if (dec.done || ++fed > 40) break;
  }
  expect(dec.done).toBe(true);
  expect(dec.result()).toEqual(data);
  expect(fed).toBeLessThan(20); // on bilinmeyen için birkaç fazla denklem yeter
});
