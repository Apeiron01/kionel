/**
 * The verifier is tested against structures built to the TCG wire layout and
 * signed by a real EC key, so a parser bug shows up as a failing test rather
 * than as an accepted forgery. Every check the verifier makes has a negative
 * case here; a verifier with only happy-path tests proves nothing.
 */
import { createPrivateKey, generateKeyPairSync, sign as rawSign } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  ENTERPRISE_KEY_POLICY, NativePlatformKeyProvider, evaluateKeyPolicy,
  type NativeKeyBridge, type NativeKeyRecord,
} from "@kionel/platform-keys";
import { FileAttestationTrustStore } from "@kionel/attestation-core";
import {
  ObjectAttr, TPM_GENERATED_VALUE, TPM_ST_ATTEST_CERTIFY, TpmAlg,
  WindowsTpmAttestationVerifier, encodeAttestationStatement, parseAttest, parseEccPublic, tpmName,
} from "./index.ts";

const fixture = (name: string) => readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");
const ROOT = fixture("root.crt");
const AIK = fixture("aik.crt");
const AIK_KEY = fixture("aik.key");
const ROGUE_ROOT = fixture("rogue-root.crt");
const ROGUE_AIK = fixture("rogue-aik.crt");
const ROGUE_AIK_KEY = fixture("rogue-aik.key");

const DEVICE_ATTRS =
  ObjectAttr.FixedTpm | ObjectAttr.FixedParent | ObjectAttr.SensitiveDataOrigin | ObjectAttr.Sign | ObjectAttr.UserWithAuth;

// ---- TCG structure builders (mirror what a TPM emits) ----------------------

function u16(value: number): Uint8Array { return new Uint8Array([value >> 8, value & 0xff]) }
function u32(value: number): Uint8Array { return new Uint8Array([value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]) }
function b2(body: Uint8Array): Uint8Array { return concat(u16(body.length), body) }
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length }
  return out;
}

/** TPMT_PUBLIC for a P-256 ECDSA-SHA256 signing key. */
function pubArea(sec1: Uint8Array, attributes = DEVICE_ATTRS): Uint8Array {
  return concat(
    u16(TpmAlg.Ecc), u16(TpmAlg.Sha256), u32(attributes), b2(new Uint8Array(0)),
    u16(TpmAlg.Null), u16(TpmAlg.Ecdsa), u16(TpmAlg.Sha256), u16(0x0003), u16(TpmAlg.Null),
    b2(sec1.subarray(1, 33)), b2(sec1.subarray(33, 65)),
  );
}

/** TPMS_ATTEST for TPM2_Certify. */
function certifyInfo(name: Uint8Array, challenge: Uint8Array, magic = TPM_GENERATED_VALUE, type = TPM_ST_ATTEST_CERTIFY): Uint8Array {
  return concat(
    u32(magic), u16(type), b2(new Uint8Array(34).fill(9)), b2(challenge),
    new Uint8Array(8), u32(1), u32(0), new Uint8Array([1]), new Uint8Array(8),
    b2(name), b2(new Uint8Array(34).fill(7)),
  );
}

/** TPMT_SIGNATURE, ECDSA/SHA-256, r and s as TPM2B. */
function tpmSignature(data: Uint8Array, keyPem: string): Uint8Array {
  const raw = rawSign("sha256", data, { key: createPrivateKey(keyPem), dsaEncoding: "ieee-p1363" });
  return concat(u16(TpmAlg.Ecdsa), u16(TpmAlg.Sha256), b2(raw.subarray(0, 32)), b2(raw.subarray(32, 64)));
}

function deviceKey(): Uint8Array {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const der = publicKey.export({ format: "der", type: "spki" });
  return new Uint8Array(der.subarray(der.length - 65));
}

interface Scenario {
  challenge?: Uint8Array;
  attributes?: number;
  chain?: readonly string[];
  signingKey?: string;
  magic?: number;
  type?: number;
  record?: Partial<NativeKeyRecord>;
  sec1?: Uint8Array;
}

function evidenceFor(s: Scenario = {}) {
  const challenge = s.challenge ?? new Uint8Array(32).fill(0x5a);
  const sec1 = s.sec1 ?? deviceKey();
  const pub = pubArea(sec1, s.attributes);
  const info = certifyInfo(tpmName(pub), challenge, s.magic, s.type);
  const record: NativeKeyRecord = {
    providerId: "windows-cng-platform",
    keyId: "windows-tpm:Kionel.device.v2",
    algorithm: "ecdsa-p256-sha256",
    publicKey: sec1,
    securityLevel: "tpm",
    persistence: "persistent",
    requiresUserPresence: true,
    attestationEvidence: {
      format: "windows-tpm",
      certificateChain: s.chain ?? [AIK],
      statement: encodeAttestationStatement({
        certifyInfo: info,
        signature: tpmSignature(info, s.signingKey ?? AIK_KEY),
        pubArea: pub,
      }),
    },
    ...s.record,
  };
  return { record, challenge };
}

const verifier = (anchors: readonly string[] = [ROOT], extra: Record<string, unknown> = {}) =>
  new WindowsTpmAttestationVerifier({ verifierId: "kionel-windows-attestation/1", trustAnchorsPem: anchors, ...extra });

async function reasonFor(s: Scenario, anchors?: readonly string[], extra?: Record<string, unknown>): Promise<string> {
  const { record, challenge } = evidenceFor(s);
  const result = await verifier(anchors, extra).verify(record, challenge);
  expect(result.status).toBe("rejected");
  return result.reason ?? "";
}

// ---- happy path -------------------------------------------------------------

test("geçerli TPM key attestation doğrulanır", async () => {
  const { record, challenge } = evidenceFor();
  const result = await verifier().verify(record, challenge);
  expect(result.status).toBe("verified");
  expect(result.format).toBe("windows-tpm");
  expect(result.verifiedBy).toBe("kionel-windows-attestation/1");
  expect(result.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("ara sertifika taşıyan zincir kabul edilir", async () => {
  const { record, challenge } = evidenceFor({ chain: [AIK, ROOT] });
  expect((await verifier().verify(record, challenge)).status).toBe("verified");
});

// ---- bindings that must not be forgeable ------------------------------------

test("başka enrollment'ın challenge'ı reddedilir (replay)", async () => {
  const { record } = evidenceFor();
  const other = new Uint8Array(32).fill(0x11);
  expect((await verifier().verify(record, other)).reason).toBe("challenge-mismatch");
});

test("attestation başka bir açık anahtara bağlanamaz", async () => {
  const { record, challenge } = evidenceFor();
  record.publicKey = deviceKey(); // kayıt başka anahtarı iddia ediyor
  expect((await verifier().verify(record, challenge)).reason).toBe("public-key-mismatch");
});

test("certifyInfo içindeki isim pubArea ile eşleşmezse reddedilir", async () => {
  const { record, challenge } = evidenceFor();
  const statement = record.attestationEvidence!.statement!;
  statement[statement.length - 40] ^= 0xff; // pubArea'yı boz -> isim tutmaz
  expect((await verifier().verify(record, challenge)).reason).toBeDefined();
});

test("imza AIK'ya ait değilse reddedilir", async () => {
  expect(await reasonFor({ signingKey: ROGUE_AIK_KEY })).toBe("attestation-signature-invalid");
});

test("kurcalanmış certifyInfo imzayı düşürür", async () => {
  const { record, challenge } = evidenceFor();
  const statement = record.attestationEvidence!.statement!;
  statement[20] ^= 0x01;
  const result = await verifier().verify(record, challenge);
  expect(result.status).toBe("rejected");
});

// ---- trust anchor -----------------------------------------------------------

test("trust anchor tanımlı değilse her attestation reddedilir (fail closed)", async () => {
  expect(await reasonFor({}, [])).toBe("no-trust-anchor-configured");
});

test("başka köke zincirlenen AIK reddedilir", async () => {
  expect(await reasonFor({ chain: [ROGUE_AIK], signingKey: ROGUE_AIK_KEY })).toBe("chain-not-anchored");
});

test("istemcinin gönderdiği kök kendini doğrulayamaz", async () => {
  expect(await reasonFor({ chain: [ROGUE_AIK, ROGUE_ROOT], signingKey: ROGUE_AIK_KEY })).toBe("chain-not-anchored");
});

test("süresi geçmiş sertifika reddedilir", async () => {
  const future = () => new Date("2099-01-01T00:00:00Z");
  expect(await reasonFor({}, [ROOT], { now: future })).toBe("certificate-expired");
});

test("zincir uzunluk sınırı aşılırsa reddedilir", async () => {
  expect(await reasonFor({ chain: [AIK, ROOT, ROOT] }, [ROOT], { maxChainLength: 2 })).toBe("chain-too-long");
});

// ---- key properties ---------------------------------------------------------

test("dışa aktarılabilir (fixedTPM olmayan) anahtar reddedilir", async () => {
  expect(await reasonFor({ attributes: DEVICE_ATTRS & ~ObjectAttr.FixedTpm })).toBe("weak-key-attributes");
});

test("sensitiveDataOrigin taşımayan anahtar reddedilir", async () => {
  expect(await reasonFor({ attributes: DEVICE_ATTRS & ~ObjectAttr.SensitiveDataOrigin })).toBe("weak-key-attributes");
});

test("encryptedDuplication açık anahtar reddedilir", async () => {
  expect(await reasonFor({ attributes: DEVICE_ATTRS | ObjectAttr.EncryptedDuplication })).toBe("forbidden-key-attributes");
});

test("TPM_GENERATED_VALUE taşımayan blob reddedilir", async () => {
  expect(await reasonFor({ magic: 0xdeadbeef })).toBe("not-tpm-generated");
});

test("TPM2_Certify dışındaki attestation tipi reddedilir", async () => {
  expect(await reasonFor({ type: 0x8018 })).toBe("wrong-attest-type");
});

test("yazılım anahtarı TPM kanıtı olarak sunulamaz", async () => {
  expect(await reasonFor({ record: { securityLevel: "software-protected" } })).toBe("not-a-tpm-key");
});

test("kullanıcı etkileşimi zorunluysa politika bunu uygular", async () => {
  expect(await reasonFor({ record: { requiresUserPresence: false } }, [ROOT], { requireUserPresence: true }))
    .toBe("user-presence-required");
});

test("kanıt yoksa doğrulanmış sayılmaz", async () => {
  expect(await reasonFor({ record: { attestationEvidence: undefined } })).toBe("missing-windows-tpm-evidence");
});

test("32 bayt olmayan challenge reddedilir", async () => {
  const { record } = evidenceFor();
  expect((await verifier().verify(record, new Uint8Array(16))).reason).toBe("challenge-size");
});

// ---- parser hardening -------------------------------------------------------

test("kesik ve fazla baytlı bloblar ayrıştırılmaz", async () => {
  const sec1 = deviceKey();
  const pub = pubArea(sec1);
  expect(() => parseEccPublic(pub.subarray(0, pub.length - 1))).toThrow(/truncated/);
  expect(() => parseEccPublic(concat(pub, new Uint8Array([0])))).toThrow(/trailing/);
  const info = certifyInfo(tpmName(pub), new Uint8Array(32));
  expect(() => parseAttest(info.subarray(0, 10))).toThrow();
  expect(parseAttest(info).extraData.length).toBe(32);
});

// ---- trust store ------------------------------------------------------------

test("trust store atomik yazar, sağlama toplamı bozulursa açılmaz", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "kionel-trust-")), "trust.json");
  const store = new FileAttestationTrustStore(path);
  const decision = {
    keyId: "windows-tpm:Kionel.device.v2",
    providerId: "windows-cng-platform",
    algorithm: "ecdsa-p256-sha256" as const,
    securityLevel: "tpm" as const,
    requiresUserPresence: true,
    publicKeySha256: "a".repeat(64),
    result: { status: "verified" as const, verifiedBy: "kionel-windows-attestation/1", verifiedAt: "2026-08-02T00:00:00Z" },
  };

  expect(await store.get(decision.keyId)).toBeUndefined();
  await store.put(decision);
  expect((await store.get(decision.keyId))?.publicKeySha256).toBe(decision.publicKeySha256);

  // eşzamanlı yazımlar kayıp vermez
  await Promise.all([1, 2, 3, 4].map((n) => store.put({ ...decision, keyId: `windows-tpm:Kionel.d${n}.v2` })));
  expect(await store.get("windows-tpm:Kionel.d4.v2")).toBeDefined();

  await store.remove(decision.keyId);
  expect(await store.get(decision.keyId)).toBeUndefined();

  const tampered = JSON.parse(readFileSync(path, "utf8"));
  tampered.decisions[0].securityLevel = "software-protected";
  writeFileSync(path, JSON.stringify(tampered));
  await expect(store.get("windows-tpm:Kionel.d1.v2")).rejects.toThrow(/sağlama toplamı/);
});

// ---- entegrasyon: sağlayıcı + doğrulayıcı + trust store ---------------------

/** Gerçek native köprünün yerine geçer: challenge'ı sağlayıcıdan alır, kanıtı ona bağlar. */
function fakeBridge(options: { sec1: Uint8Array; signingKey?: string; chain?: readonly string[] }): NativeKeyBridge {
  let issued: NativeKeyRecord | undefined;
  return {
    async capabilities() {
      return { providerId: "windows-cng-platform", algorithms: ["ecdsa-p256-sha256"], securityLevels: ["tpm"], supportsAttestation: true };
    },
    async provision(request) {
      issued = evidenceFor({
        challenge: new Uint8Array(request.attestationChallenge),
        sec1: options.sec1,
        signingKey: options.signingKey,
        chain: options.chain,
      }).record;
      return issued;
    },
    async load() { return issued },
    async sign() { return new Uint8Array(64) },
    async remove() { issued = undefined },
  };
}

function trustStorePath(): string {
  return join(mkdtempSync(join(tmpdir(), "kionel-enroll-")), "trust.json");
}

test("enrollment: doğrulanan kanıt kalıcı karara dönüşür ve Enterprise politikasını geçer", async () => {
  const store = new FileAttestationTrustStore(trustStorePath());
  const provider = new NativePlatformKeyProvider(fakeBridge({ sec1: deviceKey() }), verifier(), store);

  const identity = await provider.provision({ alias: "lab-terminal-7", algorithm: "ecdsa-p256-sha256", requireUserPresence: true });
  expect(identity.attestation.status).toBe("verified");
  expect(evaluateKeyPolicy(identity, ENTERPRISE_KEY_POLICY)).toEqual({ ok: true, reasons: [] });

  const decision = await store.get(identity.keyId);
  expect(decision?.result.status).toBe("verified");
  expect(decision?.securityLevel).toBe("tpm");

  // yeniden açılışta karar diskten gelir, kanıt tekrar doğrulanmadan
  const reloaded = await provider.load(identity.keyId);
  expect(reloaded?.attestation.status).toBe("verified");
  expect(reloaded?.attestation.verifiedBy).toBe("kionel-windows-attestation/1");
});

test("enrollment: reddedilen kanıt kalıcı karar bırakmaz ve Enterprise politikasında düşer", async () => {
  const store = new FileAttestationTrustStore(trustStorePath());
  const provider = new NativePlatformKeyProvider(
    fakeBridge({ sec1: deviceKey(), signingKey: ROGUE_AIK_KEY }), verifier(), store,
  );

  const identity = await provider.provision({ alias: "sahte", algorithm: "ecdsa-p256-sha256", requireUserPresence: true });
  expect(identity.attestation.status).toBe("rejected");
  expect(await store.get(identity.keyId)).toBeUndefined();
  expect(evaluateKeyPolicy(identity, ENTERPRISE_KEY_POLICY).ok).toBe(false);
});

test("enrollment: kayıtlı karar başka bir açık anahtara taşınamaz", async () => {
  const store = new FileAttestationTrustStore(trustStorePath());
  const bridge = fakeBridge({ sec1: deviceKey() });
  const provider = new NativePlatformKeyProvider(bridge, verifier(), store);
  const identity = await provider.provision({ alias: "terminal", algorithm: "ecdsa-p256-sha256", requireUserPresence: true });

  // köprü aynı keyId altında başka anahtar döndürmeye başlarsa güven kaydı tutmamalı
  const swapped = evidenceFor({ sec1: deviceKey() }).record;
  bridge.load = async () => swapped;
  await expect(provider.load(identity.keyId)).rejects.toThrow(/güven kaydı/);
});

test("trust store donanım dışı veya eksik kararı kabul etmez", async () => {
  const path = join(mkdtempSync(join(tmpdir(), "kionel-trust-")), "trust.json");
  const store = new FileAttestationTrustStore(path);
  const base = {
    keyId: "windows-tpm:Kionel.device.v2",
    providerId: "windows-cng-platform",
    algorithm: "ecdsa-p256-sha256" as const,
    securityLevel: "tpm" as const,
    publicKeySha256: "b".repeat(64),
    result: { status: "verified" as const, verifiedBy: "v", verifiedAt: "2026-08-02T00:00:00Z" },
  };
  await expect(store.put({ ...base, securityLevel: "software-protected" as never })).rejects.toThrow(/donanım/);
  await expect(store.put({ ...base, result: { status: "verified", verifiedBy: "", verifiedAt: "" } as never }))
    .rejects.toThrow(/doğrulayıcı/);
  await expect(store.put({ ...base, publicKeySha256: "zz" })).rejects.toThrow(/açık anahtar özeti/);
});
