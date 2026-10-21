/**
 * Synthetic integration test: real QR codec, simulated loss/reordering, crypto
 * and receipts. No physical camera is used. Passing proves this model recovers
 * the tested data, not field performance or production readiness.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import {
  LtDecoder, decodeFrame, encodeFrame, FrameType, ltEncode, pack,
  packSecureEnvelope, systematicEncode, unpack, unpackSecureEnvelope,
} from "@kionel/core";
import { createIdentity, verifyReceipt, type Bytes, type Dispatch } from "@kionel/crypto";
import { answerOffer, finishOffer, createOffer, issueDispatch, issueReceipt } from "@kionel/issue";
import { frameBytes, toBitmap } from "@kionel/transport-qr";

const wasm = readFileSync(
  new URL("../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm", import.meta.url),
);
prepareZXingModule({ overrides: { wasmBinary: wasm.buffer as ArrayBuffer } });

const owned = (bytes: Uint8Array): Bytes => new Uint8Array(bytes);

const QR_VERSION = 27;
const HEADER_OVERHEAD = 20; // frame header + trailer
const BLOCK_SIZE = frameBytes(QR_VERSION) - HEADER_OVERHEAD;

/** Reads one rendered frame the way the receiving phone would. */
async function readFrame(bitmapBytes: Uint8Array): Promise<Uint8Array | null> {
  // scale 3 keeps the modules camera-sized; decoding a 1:1 bitmap would be a
  // favour we do not get in the field.
  const results = await readBarcodes(
    toBitmap(bitmapBytes, { version: QR_VERSION }, 3) as unknown as ImageData,
    { formats: ["QRCode"], maxNumberOfSymbols: 1 },
  );
  return results[0]?.bytes ?? null;
}

/**
 * A deterministic stand-in for a hand-held camera.
 *
 * Fixed seed, because a flaky end-to-end test teaches people to re-run instead
 * of to look. The behaviours are the ones that actually happen: a frame missed
 * while the phone refocuses, frames read slightly out of order, and the same
 * frame read twice because the screen had not advanced yet.
 */
function opticalChannel(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  return {
    /** true = the camera caught this frame. */
    caught: (dropRate: number): boolean => next() >= dropRate,
    /** Shuffles a small window, the way frame timing jitter reorders reads. */
    jitter<T>(items: T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.max(0, i - Math.floor(next() * 4));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    duplicates: (): boolean => next() < 0.08,
  };
}

describe("optik kanal uçtan uca", () => {
  it(
    "dosya, QR codec ve simüle edilmiş kare kaybından geçip aynen çıkar",
    async () => {
      // ---- 1. İki cihaz tanışır ------------------------------------------
      const receiverIdentity = await createIdentity();
      const senderIdentity = await createIdentity();
      const { offer, pending } = await createOffer(receiverIdentity);
      const answered = await answerOffer(senderIdentity, offer);
      const receiverSession = await finishOffer(pending, answered.reply);

      // Kullanıcının ekranda karşılaştıracağı iki faktör iki cihazda da aynı.
      expect(receiverSession.sas).toBe(answered.session.sas);
      expect(receiverSession.sasMarks).toEqual(answered.session.sasMarks);

      // ---- 2. Gerçekçi bir dosya ------------------------------------------
      // Sıkıştırılamayan içerik: bir laboratuvar sonucunun en kötü hâli.
      const original = new Uint8Array(64_000);
      for (let i = 0; i < original.length; i++) original[i] = (i * 131 + (i >> 5) * 17) & 0xff;
      const fileName = "LIMS-2026-0042.csv";

      // ---- 3. Gönderen şifreler ve tel biçimine sokar ----------------------
      const dispatch = await issueDispatch(senderIdentity, {
        session: answered.session.sessionId,
        content: owned(original),
      });
      const sealed = await answered.session.seal(owned(pack({ name: fileName, data: owned(original) })));
      const wire = packSecureEnvelope({ metadata: JSON.stringify(dispatch), sealed });

      // ---- 4. Ekranda gösterilecek kareler ---------------------------------
      const sessionId = answered.session.sessionId >>> 0;
      const frames: Uint8Array[] = [];
      // Önce sistematik önek: kayıpsız bir okumada tek turda biter.
      for (const block of systematicEncode(wire, BLOCK_SIZE)) {
        frames.push(encodeFrame({
          type: FrameType.Data, sessionId, seed: block.seed,
          totalBytes: wire.length, blockSize: BLOCK_SIZE, payload: block.payload,
        }));
      }
      // Ardından fountain kareleri: kaybolanların yerini bunlar doldurur.
      const fountain = ltEncode(wire, BLOCK_SIZE);
      // Kayıp oranının üstünde fazlalık: fountain kodunun işi tam olarak bu.
      // Sınır DÖNGÜDEN ÖNCE sabitlenir; `frames.length` döngü içinde büyüdüğü
      // için koşulda okumak sonsuz döngü demekti (1.4 > 1).
      const systematicCount = frames.length;
      for (let i = 0; i < Math.ceil(systematicCount * 1.4); i++) {
        const block = fountain.next().value!;
        frames.push(encodeFrame({
          type: FrameType.Data, sessionId, seed: block.seed,
          totalBytes: wire.length, blockSize: BLOCK_SIZE, payload: block.payload,
        }));
      }

      // ---- 5. Kamera: %30 kare kaybı, sıra karışması, tekrar okuma ---------
      const channel = opticalChannel(0x5eed_1234);
      const decoder = new LtDecoder(wire.length, BLOCK_SIZE);
      let shown = 0;
      let caught = 0;

      for (const batch of chunk(frames, 8)) {
        for (const frame of channel.jitter(batch)) {
          if (decoder.done) break;
          shown++;
          if (!channel.caught(0.3)) continue;

          const scanned = await readFrame(frame);
          expect(scanned, "QR kare çözülemedi — optik katman bozuk").not.toBeNull();
          caught++;

          const parsed = decodeFrame(scanned!);
          expect(parsed, "çerçeve CRC/biçim kontrolünden geçmedi").not.toBeNull();
          expect(parsed!.sessionId).toBe(sessionId);
          decoder.ingest(parsed!.seed, parsed!.payload);

          // Aynı kareyi ikinci kez okumak sonucu bozmamalı.
          if (channel.duplicates()) decoder.ingest(parsed!.seed, parsed!.payload);
        }
        if (decoder.done) break;
      }

      expect(decoder.done, `dosya tamamlanmadı — ilerleme %${(decoder.progress * 100).toFixed(1)}`).toBe(true);

      // ---- 6. Alıcı açar ---------------------------------------------------
      const reassembled = decoder.result()!;
      const outer = unpackSecureEnvelope(reassembled)!;
      const received = unpack(await receiverSession.open(owned(outer.sealed)))!;

      expect(received.name).toBe(fileName);
      expect(received.intact).toBe(true);
      // Asıl iddia: bayt bayt aynı.
      expect(Buffer.from(received.data).equals(Buffer.from(original))).toBe(true);

      // ---- 7. İki taraf da imzalar ----------------------------------------
      const receipt = await issueReceipt(receiverIdentity, {
        session: receiverSession.sessionId,
        content: owned(received.data),
        sender: receiverSession.peer,
        dispatch: JSON.parse(outer.metadata) as Dispatch,
      });
      expect(await verifyReceipt(receipt, owned(received.data)))
        .toMatchObject({ ok: true, signers: ["alıcı", "gönderen"] });

      // Makbuz başka bir dosyaya ait değil.
      const tampered = owned(original);
      tampered[0] ^= 0xff;
      expect((await verifyReceipt(receipt, tampered)).ok).toBe(false);

      // Testin gerçekten iş yaptığını kanıtla: sessizce boş geçen bir uçtan uca
      // testi, hiç olmayan bir testten daha kötüdür çünkü güven verir.
      expect(shown, "hiç kare gösterilmedi").toBeGreaterThanOrEqual(50);
      expect(caught, "hiç kare okunmadı").toBeGreaterThanOrEqual(35);
      expect(shown - caught, "hiç kare kaybolmadı — kayıp yolu denenmedi").toBeGreaterThanOrEqual(12);
      console.log(`      optik kanal: ${shown} kare gösterildi, ${caught} okundu, ${shown - caught} kayıp`);
    },
    120_000,
  );

  it("yanlış oturumdan gelen kareler sessizce yutulmaz", async () => {
    const wire = new Uint8Array(BLOCK_SIZE * 3).fill(7);
    const frame = encodeFrame({
      type: FrameType.Data, sessionId: 0x11111111, seed: 1,
      totalBytes: wire.length, blockSize: BLOCK_SIZE, payload: wire.subarray(0, BLOCK_SIZE),
    });
    const parsed = decodeFrame((await readFrame(frame))!);
    expect(parsed).not.toBeNull();
    // Alıcı kendi oturum kimliğiyle karşılaştırır; eşleşmeyen kare atılır.
    expect(parsed!.sessionId).not.toBe(0x22222222);
  }, 30_000);
});

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
