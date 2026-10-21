// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { verifyTimestamp } from "./rfc3161.ts";
import { DIGICERT_TRUSTED_ROOT_G4, anchorBytes, unwrapTimestampResponse, verifyTimestampWeb } from "./web.ts";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url)));
const sha256 = (data: Uint8Array) => new Uint8Array(createHash("sha256").update(data).digest());
const pemToDer = (name: string) =>
  anchorBytes(readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8").replace(/-----[^-]+-----|\s/g, ""));

// openssl'in ürettiği bağımsız TSA (bkz. generate.mjs)
const TOKEN = fixture("token.der");
const IMPRINT = sha256(fixture("payload.bin"));
const ROOT = pemToDer("root.crt");
const ROGUE = pemToDer("rogue-root.crt");

// Gerçek DigiCert yanıtı (timestamp.digicert.com, 2026-09-25)
const DIGICERT_TOKEN = unwrapTimestampResponse(fixture("digicert/response.tsr"));
const DIGICERT_IMPRINT = sha256(fixture("digicert/payload.bin"));
const G4 = anchorBytes(DIGICERT_TRUSTED_ROOT_G4);

describe("tarayıcıda RFC 3161 doğrulaması (WebCrypto)", () => {
  it("openssl'in jetonunu doğru iz ve kökle kabul eder", async () => {
    const verdict = await verifyTimestampWeb(TOKEN, IMPRINT, [ROOT]);
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
  });

  it("gerçek DigiCert jetonunu sabitlenmiş G4 köküyle kabul eder", async () => {
    const verdict = await verifyTimestampWeb(DIGICERT_TOKEN, DIGICERT_IMPRINT, [G4]);
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.at.toISOString()).toBe("2026-09-25T10:31:14.000Z");
    expect(verdict.authority).toMatch(/^DigiCert .*Timestamp/);
  });

  it("Node doğrulayıcısıyla aynı kararı verir", async () => {
    const node = verifyTimestamp(DIGICERT_TOKEN, DIGICERT_IMPRINT, { anchors: [Buffer.from(G4)] });
    const web = await verifyTimestampWeb(DIGICERT_TOKEN, DIGICERT_IMPRINT, [G4]);
    expect(node.ok, JSON.stringify(node)).toBe(true);
    expect(web.ok).toBe(true);
    if (node.ok && web.ok) expect(web.at.getTime()).toBe(node.at.getTime());
  });

  it("başka bir içeriğe ait jetonu reddeder", async () => {
    const verdict = await verifyTimestampWeb(DIGICERT_TOKEN, IMPRINT, [G4]);
    expect(verdict).toMatchObject({ ok: false, code: "imprint-mismatch" });
  });

  it("yabancı köke zincirlenen jetonu reddeder", async () => {
    expect(await verifyTimestampWeb(TOKEN, IMPRINT, [ROGUE])).toMatchObject({ ok: false, code: "chain-rejected" });
    expect(await verifyTimestampWeb(DIGICERT_TOKEN, DIGICERT_IMPRINT, [ROOT])).toMatchObject({ ok: false, code: "chain-rejected" });
  });

  it("güven kökü yoksa hiçbir şeyi kabul etmez", async () => {
    expect(await verifyTimestampWeb(DIGICERT_TOKEN, DIGICERT_IMPRINT, [])).toMatchObject({ ok: false, code: "no-anchor" });
  });

  it("imzanın tek baytı bozulunca reddeder", async () => {
    const tampered = DIGICERT_TOKEN.slice();
    tampered[tampered.length - 10] ^= 1; // imza, SignerInfo'nun sonunda
    const verdict = await verifyTimestampWeb(tampered, DIGICERT_IMPRINT, [G4]);
    expect(verdict.ok).toBe(false);
  });

  it("TSTInfo içinde tek bayt bozulunca reddeder", async () => {
    const at = findSubarray(DIGICERT_TOKEN, DIGICERT_IMPRINT);
    expect(at).toBeGreaterThan(0);
    const tampered = DIGICERT_TOKEN.slice();
    tampered[at + 40] ^= 1; // izden sonraki alanlar: seri numarası, genTime
    expect((await verifyTimestampWeb(tampered, DIGICERT_IMPRINT, [G4])).ok).toBe(false);
  });

  it("istenen nonce tutmazsa reddeder", async () => {
    const verdict = await verifyTimestampWeb(DIGICERT_TOKEN, DIGICERT_IMPRINT, [G4], { nonce: new Uint8Array([1, 2, 3]) });
    expect(verdict).toMatchObject({ ok: false, code: "nonce-mismatch" });
  });

  it("jeton yerine rastgele baytı reddeder, hata fırlatmaz", async () => {
    expect((await verifyTimestampWeb(new Uint8Array([0x30, 0x03, 1, 2, 3]), IMPRINT, [ROOT])).ok).toBe(false);
  });
});

function findSubarray(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
