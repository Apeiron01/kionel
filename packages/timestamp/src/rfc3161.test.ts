// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildTimestampRequest, parseTimestampToken, unwrapTimestampResponse, verifyTimestamp,
} from "./rfc3161.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url)));
const pem = (name: string) => readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");

const TOKEN = fixture("token.der");
const RESPONSE = fixture("response.tsr");
const PAYLOAD = fixture("payload.bin");
const IMPRINT = new Uint8Array(createHash("sha256").update(PAYLOAD).digest());
const ROOT = pem("root.crt");
const ROGUE_ROOT = pem("rogue-root.crt");
const POLICY_OID = "1.3.6.1.4.1.99999.1.1";

const policy = (overrides: Partial<Parameters<typeof verifyTimestamp>[2]> = {}) =>
  ({ anchors: [ROOT], ...overrides });

describe("RFC 3161 istek üretimi", () => {
  it("SHA-256 izi ve certReq taşıyan bir TimeStampReq üretir", () => {
    const request = buildTimestampRequest(IMPRINT);
    // openssl'in ürettiği istekle aynı gövde: sürüm, SHA-256 OID ve certReq.
    expect(request[0]).toBe(0x30);
    expect(Buffer.from(request).includes(Buffer.from(IMPRINT))).toBe(true);
    expect(Buffer.from(request).includes(Buffer.from([0x01, 0x01, 0xff]))).toBe(true);
  });

  it("32 bayt olmayan izi reddeder", () => {
    expect(() => buildTimestampRequest(new Uint8Array(20))).toThrow(/SHA-256/);
  });
});

describe("RFC 3161 jeton ayrıştırma", () => {
  it("openssl'in ürettiği jetonu okur", () => {
    const token = parseTimestampToken(TOKEN);
    expect(token.info.policy).toBe(POLICY_OID);
    expect(Buffer.from(token.info.imprint)).toEqual(Buffer.from(IMPRINT));
    expect(token.info.genTime.getTime()).toBeGreaterThan(0);
    // Yapılandırmadaki accuracy: 1 sn + 500 ms.
    expect(token.info.accuracyMs).toBe(1500);
    expect(token.certificates.length).toBeGreaterThan(0);
    expect(token.signer.subject).toContain("Kionel Test Timestamp Authority");
  });

  it("TimeStampResp içinden jetonu çıkarır", () => {
    const unwrapped = unwrapTimestampResponse(RESPONSE);
    expect(parseTimestampToken(unwrapped).info.policy).toBe(POLICY_OID);
  });

  it("jeton yerine rastgele baytı reddeder", () => {
    expect(() => parseTimestampToken(new Uint8Array([0x30, 0x03, 0x02, 0x01, 0x01]))).toThrow();
  });
});

describe("RFC 3161 doğrulama", () => {
  it("doğru iz ve güven kökü ile kabul eder", () => {
    const verdict = verifyTimestamp(TOKEN, IMPRINT, policy());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.policy).toBe(POLICY_OID);
    expect(verdict.accuracyMs).toBe(1500);
    expect(verdict.authority).toContain("Kionel Test Timestamp Authority");
    expect(verdict.at.getTime()).toBeGreaterThan(0);
  });

  it("başka bir içeriğe ait jetonu reddeder", () => {
    const other = new Uint8Array(createHash("sha256").update("başka içerik").digest());
    expect(verifyTimestamp(TOKEN, other, policy())).toMatchObject({ ok: false, code: "imprint-mismatch" });
  });

  it("güven kökü tanımlı değilse hiçbir şeyi kabul etmez", () => {
    expect(verifyTimestamp(TOKEN, IMPRINT, { anchors: [] })).toMatchObject({ ok: false, code: "no-anchor" });
  });

  it("yabancı köke zincirlenen jetonu reddeder", () => {
    expect(verifyTimestamp(TOKEN, IMPRINT, policy({ anchors: [ROGUE_ROOT] })))
      .toMatchObject({ ok: false, code: "chain-rejected" });
  });

  it("kabul listesinde olmayan TSA politikasını reddeder", () => {
    expect(verifyTimestamp(TOKEN, IMPRINT, policy({ acceptedPolicies: ["1.2.3.4"] })))
      .toMatchObject({ ok: false, code: "policy-rejected" });
  });

  it("beyan edilen doğruluk çok genişse reddeder", () => {
    expect(verifyTimestamp(TOKEN, IMPRINT, policy({ maxAccuracyMs: 100 })))
      .toMatchObject({ ok: false, code: "accuracy-too-wide" });
  });

  it("doğrulayıcının saatine göre gelecekteki jetonu reddeder", () => {
    expect(verifyTimestamp(TOKEN, IMPRINT, policy({ notAfter: new Date("2020-01-01T00:00:00Z") })))
      .toMatchObject({ ok: false, code: "future-timestamp" });
  });

  it("tek bir bayt bozulunca imzayı kabul etmez", () => {
    // TSTInfo'nun ortasına dokunmak hem izi hem message-digest'i düşürmeli.
    const tampered = Uint8Array.from(TOKEN);
    tampered[Math.floor(tampered.length / 2)] ^= 0xff;
    const verdict = verifyTimestamp(tampered, IMPRINT, policy());
    expect(verdict.ok).toBe(false);
  });

  it("TSA sertifikası süresi dolduktan sonra da geçerli kalır", () => {
    // Zincir genTime'da doğrulanır, şimdiki zamanda değil. Zaman damgasının
    // varlık sebebi tam olarak budur: imzalayanın sertifikası sonradan bitse
    // bile o an geçerli olduğu kanıtlanmış olur.
    const verdict = verifyTimestamp(TOKEN, IMPRINT, policy());
    expect(verdict.ok).toBe(true);
  });
});
