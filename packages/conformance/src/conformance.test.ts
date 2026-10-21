import { expect, test } from "vitest";
import {
  FrameType, LtDecoder, decodeAck, decodeCapabilities, decodeFrame, decodeHandshakeControl,
  encodeAck, encodeCapabilities, encodeFrame, unpack, unpackSecureEnvelope,
} from "@kionel/core";
import { verifyReceipt, type Receipt } from "@kionel/crypto";

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

test("v1 tel biçimi golden vektörleri sabittir", () => {
  expect(hex(encodeFrame({
    type: FrameType.Data, sessionId: 0x12345678, seed: 42,
    totalBytes: 3, blockSize: 3, payload: new Uint8Array([1, 2, 3]),
  }))).toBe("01010003123456780000002a00000003010203ce39398c");
  expect(hex(encodeCapabilities({
    v: 1, transports: ["qr-v1"], maxFrameBytes: 1465, maxFps: 30,
    duplex: true, arq: true, resume: true,
  }))).toBe("010705b9001e010571722d7631");
  expect(hex(encodeAck({
    sequence: 7, receivedBlocks: 8, totalBlocks: 10, decodeMicros: 1234,
    missing: [{ start: 2, end: 4 }], complete: false,
  }))).toBe("0100000100000007000000080000000a000004d20000000200000004");
});

test("CRC korumalı çerçevede her tek-bit değişikliği reddedilir", () => {
  const valid = encodeFrame({
    type: FrameType.Data, sessionId: 7, seed: 9, totalBytes: 4,
    blockSize: 4, payload: new Uint8Array([10, 20, 30, 40]),
  });
  for (let bit = 0; bit < valid.length * 8; bit++) {
    const changed = valid.slice();
    changed[bit >>> 3] ^= 1 << (bit & 7);
    expect(decodeFrame(changed), `bit ${bit}`).toBeNull();
  }
});

test("parserlar 10.000 deterministik bozucu girdide throw etmez", () => {
  const random = mulberry32(0x50484f53);
  const parsers = [decodeFrame, decodeCapabilities, decodeHandshakeControl, decodeAck, unpack, unpackSecureEnvelope];
  for (let index = 0; index < 10_000; index++) {
    const length = Math.floor(random() * 2048);
    const input = Uint8Array.from({ length }, () => Math.floor(random() * 256));
    for (const parser of parsers) expect(() => parser(input)).not.toThrow();
  }
}, 60_000);

test("decoder kaynak sınırları tahsisten önce uygulanır", () => {
  expect(() => new LtDecoder(1024 * 1024 * 1024 + 1, 1)).toThrow();
  expect(() => new LtDecoder(1_000_001, 1)).toThrow();
  expect(() => new LtDecoder(1024, 0)).toThrow();
});

test("makbuz doğrulayıcı biçimsiz nesnelerde güvenli sonuç döndürür", async () => {
  const random = mulberry32(0x53414645);
  for (let index = 0; index < 1_000; index++) {
    const value = {
      v: Math.floor(random() * 5), session: random() * Number.MAX_SAFE_INTEGER,
      hash: "x".repeat(Math.floor(random() * 200)), bytes: random() * 1e12,
      at: String(random()), sender: String(random()), receiver: String(random()), sig: String(random()),
    } as unknown as Receipt;
    await expect(verifyReceipt(value)).resolves.toMatchObject({ ok: false });
  }
});

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
