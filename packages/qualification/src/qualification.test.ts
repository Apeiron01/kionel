/**
 * Ölçüm mantığı telefon olmadan kanıtlanır: 1.000 deneme sentetik kanaldan
 * geçirilir, kaydedilir, imzalanır ve imza yeniden doğrulanır.
 *
 * Bu test cihaz matrisinin YERİNE GEÇMEZ — gerçek optik kanalı ölçmez.
 * Kanıtladığı şey, gerçek telefonlarda koşacak sayaçların doğru saydığıdır.
 */
import { expect, test } from "vitest";
import { PROFILES, simulate } from "@kionel/core";
import { verifyQualificationEvidenceV2 } from "@kionel/crypto";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import {
  MATRIX_GATE, MatrixRunRecorder, attemptIndexFor, attemptPayload, deviceMatrixDocument,
  frameSessionId, issueMatrixEvidence, matrixAttemptIndex, matrixAttemptName, sameBytes,
} from "./index.ts";

async function p256Identity(keyId: string): Promise<PlatformSigningIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return {
    providerId: "test-webcrypto",
    keyId: `test:${keyId}`,
    algorithm: "ecdsa-p256-sha256",
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    securityLevel: "software-protected",
    persistence: "session",
    attestation: { status: "not-available" },
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new Uint8Array(data)));
    },
  };
}

// ---- deneme sınırı ve yük ---------------------------------------------------

test("deneme sınırı çerçevedeki sessionId ile taşınır", () => {
  const runId = 0xfffffff0;
  expect(frameSessionId(runId, 0)).toBe(runId);
  expect(frameSessionId(runId, 20)).toBe(4); // 32 bitte sarmalanır
  expect(attemptIndexFor(runId, frameSessionId(runId, 999), 1000)).toBe(999);
  expect(attemptIndexFor(runId, frameSessionId(runId, 1000), 1000)).toBeUndefined();
});

test("deneme yükü iki tarafta da aynı türetilir", async () => {
  const a = await attemptPayload(7, 3, 4096);
  const b = await attemptPayload(7, 3, 4096);
  expect(sameBytes(a, b)).toBe(true);
  expect(sameBytes(a, await attemptPayload(7, 4, 4096))).toBe(false);
  expect(sameBytes(a, await attemptPayload(8, 3, 4096))).toBe(false);
  expect(a.length).toBe(4096);
  await expect(attemptPayload(1, 1, 16)).rejects.toThrow();
});

test("deneme indeksi dosya adından güvenle geri okunur", () => {
  expect(matrixAttemptName(0)).toBe("kionel-matrix-0.bin");
  expect(matrixAttemptIndex(matrixAttemptName(999))).toBe(999);
  expect(matrixAttemptIndex("kionel-matrix-0007.bin")).toBe(7);
  // Kullanıcı dosyaları matris denemesi gibi görünmemeli
  for (const name of ["rapor.pdf", "kionel-matrix-.bin", "kionel-matrix-1.bin.exe", "kionel-matrix-1234567.bin", "../kionel-matrix-1.bin"]) {
    expect(matrixAttemptIndex(name)).toBeUndefined();
  }
  expect(() => matrixAttemptName(-1)).toThrow();
});

// ---- sayaç doğruluğu --------------------------------------------------------

test("aynı deneme iki kez sayılmaz", () => {
  const recorder = new MatrixRunRecorder({ runId: 1, attempts: 10, payloadBytes: 4096 });
  recorder.record({ index: 0, completed: true, corrupted: false, bytes: 4096, seconds: 0.2 });
  recorder.record({ index: 0, completed: true, corrupted: false, bytes: 4096, seconds: 0.2 });
  expect(recorder.summary().attempts).toBe(1);
  expect(recorder.summary().successes).toBe(1);
});

test("gönderici ilerlediyse atlanan denemeler başarısız sayılır", () => {
  const recorder = new MatrixRunRecorder({ runId: 1, attempts: 10, payloadBytes: 4096 });
  recorder.record({ index: 0, completed: true, corrupted: false, bytes: 4096, seconds: 0.2 });
  recorder.failMissingBefore(5);
  recorder.record({ index: 5, completed: true, corrupted: false, bytes: 4096, seconds: 0.2 });
  const summary = recorder.summary();
  expect(summary.attempts).toBe(6);
  expect(summary.successes).toBe(2); // 1,2,3,4 hiç tamamlanmadı
});

test("sessiz bozulma başarı sayılmaz ve kapıyı tek başına kapatır", () => {
  const recorder = new MatrixRunRecorder({ runId: 1, attempts: 1000, payloadBytes: 4096 });
  for (let index = 0; index < 1000; index++) {
    recorder.record({ index, completed: true, corrupted: index === 500, bytes: 4096, seconds: 0.2 });
  }
  const summary = recorder.summary();
  expect(summary.successes).toBe(999);
  expect(summary.silentCorruptions).toBe(1);
  // kanıt değişmezi: bozulma, başarısızlıkların içinden sayılır
  expect(summary.silentCorruptions).toBeLessThanOrEqual(summary.attempts - summary.successes);
  expect(recorder.gate()).toEqual({ pass: false, reason: "1 sessiz bozulma görüldü" });
});

test("%99 altındaki başarı kapıyı kapatır", () => {
  const recorder = new MatrixRunRecorder({ runId: 1, attempts: 1000, payloadBytes: 4096 });
  for (let index = 0; index < 1000; index++) {
    recorder.record({ index, completed: index >= 20, corrupted: false, bytes: 4096, seconds: 0.2 });
  }
  expect(recorder.gate().pass).toBe(false);
  expect(recorder.gate().reason).toMatch(/başarı %98/);
});

test("eksik deneme sayısı kapıyı kapatır", () => {
  const recorder = new MatrixRunRecorder({ runId: 1, attempts: 1000, payloadBytes: 4096 });
  recorder.record({ index: 0, completed: true, corrupted: false, bytes: 4096, seconds: 0.2 });
  expect(recorder.gate()).toEqual({ pass: false, reason: `1/${MATRIX_GATE.minAttemptsPerPair} deneme tamamlandı` });
});

test("koşu dışı indeks reddedilir", () => {
  const recorder = new MatrixRunRecorder({ runId: 1, attempts: 10, payloadBytes: 4096 });
  expect(() => recorder.record({ index: 10, completed: true, corrupted: false, bytes: 1, seconds: 1 })).toThrow(/koşu dışında/);
  expect(() => recorder.summary()).toThrow(/kayıtlı deneme yok/);
});

// ---- uçtan uca --------------------------------------------------------------

test("1000 sentetik deneme imzalı, doğrulanabilir kanıta dönüşür", async () => {
  const runId = 0x51ff00aa;
  const attempts = MATRIX_GATE.minAttemptsPerPair;
  const payloadBytes = 4096;
  const recorder = new MatrixRunRecorder({ runId, attempts, payloadBytes });
  const profile = PROFILES["qr-v27-L-30"];

  for (let index = 0; index < attempts; index++) {
    const expected = await attemptPayload(runId, index, payloadBytes);
    const run = simulate(expected, profile, { lossRate: 0.15, corruptRate: 0.01, seed: index + 1 });
    // Alıcı beklediğini yeniden hesaplar; eşleşmezse bu sessiz bozulmadır.
    const corrupted = run.ok === false && run.goodputKBs > 0;
    recorder.record({
      index,
      completed: run.ok,
      corrupted,
      bytes: run.ok ? payloadBytes : 0,
      seconds: run.seconds,
    });
  }

  const gate = recorder.gate();
  expect(gate.pass).toBe(true);
  expect(recorder.summary().silentCorruptions).toBe(0);
  expect(recorder.summary().meanGoodputKBs).toBeGreaterThan(0);

  const identity = await p256Identity("matrix-receiver");
  const evidence = await issueMatrixEvidence(identity, recorder, {
    sender: "Pixel 8 (Chrome)", receiver: "iPhone 14 (Safari)", browser: "Safari 17", transport: "qr-v1",
  });

  expect(evidence.attempts).toBe(attempts);
  expect((await verifyQualificationEvidenceV2(evidence)).ok).toBe(true);

  // tek alan değişirse imza düşer
  expect((await verifyQualificationEvidenceV2({ ...evidence, successes: evidence.successes + 1 })).ok).toBe(false);
  expect(deviceMatrixDocument([evidence]).schema).toBe("kionel-device-matrix/v2");
// 1.000 fountain simülasyonu + 128.000 SHA-256 türetmesi; varsayılan 5 sn yetmez.
}, 60_000);
