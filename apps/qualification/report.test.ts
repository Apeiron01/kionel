import { expect, test } from "vitest";
import { createIdentity } from "@kionel/crypto";
import { issueQualificationEvidence } from "@kionel/issue";
import { MatrixRunRecorder, deviceMatrixDocument, issueMatrixEvidence } from "@kionel/qualification";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import { evaluateDeviceMatrix, manifestDigest, releaseManifest, verifyDeviceMatrixDocument, type PhysicalDeviceRun } from "./report.ts";

const devices = ["lab-a", "lab-b", "lab-c", "lab-d", "lab-e"];
const valid = devices.map((sender, index): PhysicalDeviceRun => ({
  sender,
  receiver: devices[(index + 1) % devices.length],
  browser: "Chromium 140",
  transport: "qr-v1",
  attempts: 1000,
  successes: 1000,
  silentCorruptions: 0,
  meanGoodputKBs: 24,
}));

test("beş cihazlı fiziksel matris pilot kapılarını geçer", () => {
  expect(evaluateDeviceMatrix(valid)).toMatchObject({ status: "pass", devices: 5, pairs: 5 });
});

test("sessiz bozulma veya eksik deneme fiziksel qualification'ı düşürür", () => {
  expect(evaluateDeviceMatrix(valid.map((run, i) => i ? run : { ...run, silentCorruptions: 1 }))).toMatchObject({ status: "fail" });
  expect(evaluateDeviceMatrix(valid.map((run, i) => i ? run : { ...run, attempts: 999, successes: 999 }))).toMatchObject({ status: "fail" });
  expect(evaluateDeviceMatrix()).toMatchObject({ status: "not-run" });
});

test("release manifest özeti anahtar sırasından bağımsızdır", () => {
  expect(manifestDigest({ b: "2", a: "1" })).toBe(manifestDigest({ a: "1", b: "2" }));
});

test("release kaynak özeti Windows native host kaynaklarını dışarıda bırakmaz", () => {
  const manifest = releaseManifest(process.cwd());
  expect(manifest).toHaveProperty("native/windows/Kionel.WindowsKeyHost/KeyHost.cs");
  expect(manifest).toHaveProperty("native/windows/Kionel.WindowsKeyHost/Kionel.WindowsKeyHost.csproj");
  expect(Object.keys(manifest).some((path) => path.includes("/bin/") || path.includes("/obj/"))).toBe(false);
});

test("cihaz matrisi yalnız geçerli cihaz imzalarını kabul eder", async () => {
  const run = await issueQualificationEvidence(await createIdentity(), {
    sender: "lab-a", receiver: "lab-b", browser: "Chromium 140", transport: "qr-v1",
    attempts: 1000, successes: 1000, silentCorruptions: 0, meanGoodputKBs: 24,
    startedAt: "2026-08-03T10:00:00.000Z", endedAt: "2026-08-03T12:00:00.000Z",
  });
  expect(await verifyDeviceMatrixDocument({ schema: "kionel-device-matrix/v1", runs: [run] })).toMatchObject({ runs: [run] });
  expect(await verifyDeviceMatrixDocument({ schema: "kionel-device-matrix/v1", runs: [{ ...run, successes: 999 }] }))
    .toMatchObject({ error: expect.stringMatching(/imza/) });
  expect(await verifyDeviceMatrixDocument([run])).toMatchObject({ error: expect.stringMatching(/şema/) });
});

/**
 * Toplama tarafı ile değerlendirme tarafının aynı sözleşmeyi konuştuğunun kanıtı:
 * kaydediciden çıkan imzalı kanıt, `pnpm qualify --device-matrix=` kapısını geçmeli.
 * Bu bağ kopuk olsaydı sahada 5.000 aktarım yapıp elde kullanılamaz dosya kalırdı.
 */
async function p256Identity(): Promise<PlatformSigningIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return {
    providerId: "test-webcrypto", keyId: "test:matrix", algorithm: "ecdsa-p256-sha256",
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    securityLevel: "software-protected", persistence: "session", attestation: { status: "not-available" },
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new Uint8Array(data)));
    },
  };
}

async function recordedPair(sender: string, receiver: string, failures = 0) {
  const recorder = new MatrixRunRecorder({ runId: 1, attempts: 1000, payloadBytes: 4096 });
  for (let index = 0; index < 1000; index++) {
    recorder.record({ index, completed: index >= failures, corrupted: false, bytes: 4096, seconds: 0.2 });
  }
  return issueMatrixEvidence(await p256Identity(), recorder, {
    sender, receiver, browser: "Chromium 140", transport: "qr-v1",
  });
}

test("kaydediciden çıkan imzalı matris qualification kapısını geçer", async () => {
  const runs = await Promise.all(devices.map((sender, index) => recordedPair(sender, devices[(index + 1) % devices.length])));
  const document = deviceMatrixDocument(runs);

  const checked = await verifyDeviceMatrixDocument(document);
  expect(checked.error).toBeUndefined();
  expect(evaluateDeviceMatrix(checked.runs as unknown as PhysicalDeviceRun[]))
    .toMatchObject({ status: "pass", devices: 5, pairs: 5 });
});

test("bir çiftte %99 altına düşen başarı tüm matrisi düşürür", async () => {
  const runs = await Promise.all(devices.map((sender, index) =>
    recordedPair(sender, devices[(index + 1) % devices.length], index === 0 ? 20 : 0)));
  const checked = await verifyDeviceMatrixDocument(deviceMatrixDocument(runs));
  expect(checked.error).toBeUndefined();
  expect(evaluateDeviceMatrix(checked.runs as unknown as PhysicalDeviceRun[]))
    .toMatchObject({ status: "fail", reason: expect.stringMatching(/başarı %99 altında/) });
});
