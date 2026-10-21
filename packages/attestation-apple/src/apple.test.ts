/**
 * Fixture'lar test-fixtures/generate.mjs ile üretilir: gerçek sertifikalar,
 * gerçek nonce eklentileri, gerçek authData. Böylece CBOR → zincir → eklenti →
 * nonce → authData yolunun tamamı uçtan uca sınanır.
 *
 * Her red gerekçesinin testi var. Yalnız mutlu yolu kanıtlanmış bir doğrulayıcı
 * hiçbir şey kanıtlamaz.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import type { NativeKeyRecord } from "@kionel/platform-keys";
import {
  APPLE_NONCE_OID, AppleAppAttestVerifier, appleKeyId, decodeCbor, parseAuthenticatorData, parseNonceExtension,
} from "./index.ts";

const read = (name: string) => readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");
const FIXTURES = JSON.parse(read("fixtures.json")) as {
  challenge: string; appId: string; publicKey: string; keyId: string; authData: Record<string, string>;
};
const bytes = (base64: string) => new Uint8Array(Buffer.from(base64, "base64"));
const CHALLENGE = bytes(FIXTURES.challenge);
const PUBLIC_KEY = bytes(FIXTURES.publicKey);
const ROOT = read("root.crt");
const ROGUE_ROOT = read("rogue-root.crt");

// ---- CBOR yazıcı (yalnız test) ----------------------------------------------

function cborHead(major: number, value: number): number[] {
  if (value < 24) return [(major << 5) | value];
  if (value < 0x100) return [(major << 5) | 24, value];
  if (value < 0x10000) return [(major << 5) | 25, value >> 8, value & 0xff];
  return [(major << 5) | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}
const cborText = (value: string) => {
  const encoded = new TextEncoder().encode(value);
  return [...cborHead(3, encoded.length), ...encoded];
};
const cborBytes = (value: Uint8Array) => [...cborHead(2, value.length), ...value];

function attestationObject(leafPem: string, authData: Uint8Array, extra: { fmt?: string } = {}): Uint8Array {
  const der = new Uint8Array(Buffer.from(leafPem.replace(/-----[^-]+-----|\s/g, ""), "base64"));
  return Uint8Array.from([
    ...cborHead(5, 3),
    ...cborText("fmt"), ...cborText(extra.fmt ?? "apple-appattest"),
    ...cborText("attStmt"), ...cborHead(5, 1), ...cborText("x5c"), ...cborHead(4, 1), ...cborBytes(der),
    ...cborText("authData"), ...cborBytes(authData),
  ]);
}

// ---- kayıt ------------------------------------------------------------------

interface Options { leaf?: string; authData?: string; record?: Partial<NativeKeyRecord>; fmt?: string }

function recordFor({ leaf = "good", authData = leaf, record, fmt }: Options = {}): NativeKeyRecord {
  const data = bytes(FIXTURES.authData[authData] ?? FIXTURES.authData.good);
  return {
    providerId: "apple-secure-enclave",
    keyId: "apple:kionel.device.v2",
    algorithm: "ecdsa-p256-sha256",
    publicKey: PUBLIC_KEY,
    securityLevel: "secure-enclave",
    persistence: "persistent",
    attestationEvidence: {
      format: "apple-app-attest",
      certificateChain: [],
      statement: attestationObject(read(`${leaf}.crt`), data, { fmt }),
    },
    ...record,
  };
}

const verifier = (extra: Record<string, unknown> = {}) =>
  new AppleAppAttestVerifier({
    verifierId: "kionel-apple-attestation/1",
    trustAnchors: [ROOT],
    appId: FIXTURES.appId,
    ...extra,
  });

async function reasonFor(options: Options = {}, policy: Record<string, unknown> = {}): Promise<string> {
  const result = await verifier(policy).verify(recordFor(options), CHALLENGE);
  expect(result.status).toBe("rejected");
  return result.reason ?? "";
}

// ---- happy path -------------------------------------------------------------

test("Secure Enclave attestation doğrulanır", async () => {
  const result = await verifier().verify(recordFor(), CHALLENGE);
  expect(result.status).toBe("verified");
  expect(result.format).toBe("apple-app-attest");
  expect(result.verifiedBy).toBe("kionel-apple-attestation/1");
  expect(result.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

// ---- bağlama ----------------------------------------------------------------

test("başka enrollment'ın challenge'ı nonce'u düşürür", async () => {
  const result = await verifier().verify(recordFor(), new Uint8Array(32).fill(0x42));
  expect(result.reason).toBe("nonce-mismatch");
});

test("eklentideki nonce başka challenge için hesaplanmışsa reddedilir", async () => {
  expect(await reasonFor({ leaf: "wrong-nonce" })).toBe("nonce-mismatch");
});

test("authData değiştirilirse nonce tutmaz", async () => {
  // Sertifika 'good' authData için nonce taşıyor; başka bir authData ile eşleşemez.
  expect(await reasonFor({ leaf: "good", authData: "counter-set" })).toBe("nonce-mismatch");
});

test("attestation başka açık anahtara bağlanamaz", async () => {
  const other = new Uint8Array(65);
  other[0] = 4;
  expect(await reasonFor({ record: { publicKey: other } })).toBe("public-key-mismatch");
});

test("anahtar kimliği açık anahtarın özeti değilse reddedilir", async () => {
  expect(await reasonFor({ leaf: "wrong-credential-id" })).toBe("credential-id-mismatch");
});

// ---- uygulama ve ortam ------------------------------------------------------

test("başka uygulamanın attestation'ı reddedilir", async () => {
  expect(await reasonFor({ leaf: "other-app" })).toBe("app-id-mismatch");
});

test("geliştirme ortamı attestation'ı varsayılan olarak reddedilir", async () => {
  expect(await reasonFor({ leaf: "development" })).toBe("development-attestation-rejected");
  const result = await verifier({ allowDevelopmentEnvironment: true })
    .verify(recordFor({ leaf: "development" }), CHALLENGE);
  expect(result.status).toBe("verified");
});

test("tanınmayan attestation ortamı reddedilir", async () => {
  expect(await reasonFor({ leaf: "unknown-environment" }, { allowDevelopmentEnvironment: true }))
    .toBe("unknown-attestation-environment");
});

test("sayacı sıfır olmayan attestation reddedilir", async () => {
  expect(await reasonFor({ leaf: "counter-set" })).toBe("counter-not-zero");
});

// ---- zincir -----------------------------------------------------------------

test("trust anchor yoksa her attestation reddedilir", async () => {
  expect(await reasonFor({}, { trustAnchors: [] })).toBe("no-trust-anchor-configured");
});

test("Apple kökü dışına zincirlenen kanıt reddedilir", async () => {
  expect(await reasonFor({ leaf: "rogue-leaf" })).toBe("chain-not-anchored");
});

test("istemcinin gönderdiği kök kendini doğrulayamaz", async () => {
  expect(await reasonFor({ leaf: "rogue-leaf" }, { trustAnchors: [] })).toBe("no-trust-anchor-configured");
  const rogue = await verifier({ trustAnchors: [ROGUE_ROOT] }).verify(recordFor({ leaf: "rogue-leaf" }), CHALLENGE);
  // Kök kuruma yapılandırılmışsa geçerlidir; yapılandırılmamış kök kabul edilmez.
  expect(rogue.status).toBe("verified");
});

// ---- biçim ------------------------------------------------------------------

test("beklenmeyen attestation biçimi reddedilir", async () => {
  expect(await reasonFor({ fmt: "packed" })).toBe("unexpected-attestation-format");
});

test("Secure Enclave olmayan anahtar kabul edilmez", async () => {
  expect(await reasonFor({ record: { securityLevel: "tee" } })).toBe("not-a-secure-enclave-key");
});

test("kanıt yoksa doğrulanmış sayılmaz", async () => {
  expect(await reasonFor({ record: { attestationEvidence: undefined } })).toBe("missing-apple-evidence");
});

// ---- CBOR sertleştirme ------------------------------------------------------

test("kural dışı CBOR çözülmez", async () => {
  expect(() => decodeCbor(Uint8Array.from([0x5f, 0xff]))).toThrow(/belirsiz uzunluk/);     // belirsiz uzunluk
  expect(() => decodeCbor(Uint8Array.from([0x18, 0x05]))).toThrow(/minimal kodlanmamış/);  // minimal olmayan tam sayı
  expect(() => decodeCbor(Uint8Array.from([0xc1, 0x00]))).toThrow(/desteklenmeyen/);       // etiket
  expect(() => decodeCbor(Uint8Array.from([0xf5]))).toThrow(/desteklenmeyen/);             // simple/float
  expect(() => decodeCbor(Uint8Array.from([0x41, 0x01, 0x00]))).toThrow(/artık bayt/);     // artık bayt
  expect(() => decodeCbor(Uint8Array.from([0x42, 0x01]))).toThrow(/kesik/);                // kesik
  expect(() => decodeCbor(Uint8Array.from([0x61, 0xff]))).toThrow(/geçerli UTF-8 değil/);  // bozuk UTF-8
  expect(() => decodeCbor(Uint8Array.from([                                               // tekrarlanan anahtar
    0xa2, 0x61, 0x61, 0x00, 0x61, 0x61, 0x01,
  ]))).toThrow(/tekrarlanan anahtar/);
  expect(() => decodeCbor(Uint8Array.from([0xa1, 0x00, 0x00]))).toThrow(/anahtarı metin olmalı/);
});

test("bozuk authData ve nonce eklentisi ayrıştırılmaz", async () => {
  const good = bytes(FIXTURES.authData.good);
  expect(parseAuthenticatorData(good).counter).toBe(0);
  expect([...parseAuthenticatorData(good).credentialId]).toEqual([...bytes(FIXTURES.keyId)]);
  expect(() => parseAuthenticatorData(good.subarray(0, 40))).toThrow(/authdata|truncated/i);
  expect(() => parseAuthenticatorData(Uint8Array.from([...good, 0]))).toThrow(/authData uzunluğu/);
  expect(() => parseNonceExtension(Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x00]))).toThrow();
  expect(appleKeyId(PUBLIC_KEY).length).toBe(32);
  expect(APPLE_NONCE_OID.length).toBeGreaterThan(5);
});
