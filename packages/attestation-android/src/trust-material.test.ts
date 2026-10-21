import { X509Certificate, createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  ANDROID_ROOT_POLICY_SCHEMA, GOOGLE_ANDROID_ROOTS_URL, GOOGLE_ANDROID_STATUS_URL,
  assertAndroidTrustMaterialFresh, parseAndroidRootPolicy, parseAndroidTrustMaterial,
  readAndroidTrustMaterial, syncAndroidTrustMaterial, type AndroidRootPolicy,
} from "./trust-material.ts";

const fixture = (name: string) => readFileSync(new URL(`../test-fixtures/${name}`, import.meta.url), "utf8");
const ROOT = fixture("root.crt");
const ROGUE_ROOT = fixture("rogue-root.crt");
const NOW = new Date("2026-08-08T12:00:00.000Z");
const STATUS = JSON.stringify({ entries: { abc123: { status: "REVOKED", reason: "KEY_COMPROMISE" } } });

function fingerprint(certificate: string): string {
  return new X509Certificate(certificate).fingerprint256.replaceAll(":", "").toLowerCase();
}

function policyFor(certificate = ROOT): AndroidRootPolicy {
  return parseAndroidRootPolicy(JSON.stringify({
    schema: ANDROID_ROOT_POLICY_SCHEMA,
    reviewedAt: "2026-08-08",
    source: GOOGLE_ANDROID_ROOTS_URL,
    roots: [{ sha256: fingerprint(certificate), certificate }],
  }));
}

function response(body: string, date = NOW, headers: Record<string, string> = {}): Response {
  return new Response(body, { status: 200, headers: {
    "content-type": "application/json",
    "cache-control": "public, max-age=3600",
    date: date.toUTCString(),
    ...headers,
  } });
}

function fetcherFor(options: { roots?: string[]; statusHeaders?: Record<string, string>; date?: Date } = {}) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    expect(init.redirect).toBe("error");
    if (url === GOOGLE_ANDROID_ROOTS_URL) return response(JSON.stringify(options.roots ?? [ROOT]), options.date ?? NOW);
    if (url === GOOGLE_ANDROID_STATUS_URL) return response(STATUS, options.date ?? NOW, {
      "cache-control": "public, max-age=3600",
      ...options.statusHeaders,
    });
    throw new Error(`beklenmeyen URL: ${url}`);
  };
}

test("güven paketi atomik üretilir, okunur ve sıra ilerler", async () => {
  const directory = mkdtempSync(join(tmpdir(), "kionel-android-trust-"));
  const outputPath = join(directory, "trust.json");
  const rootPolicy = policyFor();
  const first = await syncAndroidTrustMaterial({ outputPath, rootPolicy, fetcher: fetcherFor(), now: () => NOW });
  expect(first.material.sequence).toBe(1);
  expect(first.material.nextUpdate).toBe("2026-08-08T13:00:00.000Z");
  expect(first.revocationStatus.blockedSerials.has("abc123")).toBe(true);
  expect(first.material.rootFingerprints).toEqual([fingerprint(ROOT)]);
  expect(readFileSync(outputPath, "utf8")).toMatch(/kionel-android-trust-material\/v1/);

  const later = new Date(NOW.getTime() + 60_000);
  const second = await syncAndroidTrustMaterial({
    outputPath, rootPolicy, fetcher: fetcherFor({ date: later }), now: () => later,
  });
  expect(second.material.sequence).toBe(2);
  expect((await readAndroidTrustMaterial(outputPath, rootPolicy)).material.digest).toBe(second.material.digest);
});

test("resmî uçtaki bilinmeyen kök güveni otomatik genişletemez", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-root-")), "trust.json");
  await expect(syncAndroidTrustMaterial({
    outputPath, rootPolicy: policyFor(), fetcher: fetcherFor({ roots: [ROGUE_ROOT] }), now: () => NOW,
  })).rejects.toThrow(/güven değişikliği inceleme gerektiriyor/);
  expect(() => readFileSync(outputPath)).toThrow();
});

test("Cache-Control olmayan durum listesi kalıcılaştırılmaz", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-cache-")), "trust.json");
  await expect(syncAndroidTrustMaterial({
    outputPath,
    rootPolicy: policyFor(),
    fetcher: fetcherFor({ statusHeaders: { "cache-control": "no-store" } }),
    now: () => NOW,
  })).rejects.toThrow(/max-age/);
  expect(() => readFileSync(outputPath)).toThrow();
});

test("Google Date başlığıyla uyuşmayan yerel saat reddedilir", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-clock-")), "trust.json");
  const remoteDate = new Date(NOW.getTime() + 6 * 60_000);
  await expect(syncAndroidTrustMaterial({
    outputPath, rootPolicy: policyFor(), fetcher: fetcherFor({ date: remoteDate }), now: () => NOW,
  })).rejects.toThrow(/Yerel saat/);
});

test("CDN Age süresi max-age'den düşülür ve pakete geri eklenmez", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-age-")), "trust.json");
  const cachedAt = new Date(NOW.getTime() - 30 * 60_000);
  const cachedFetcher = async (url: string, _init: RequestInit): Promise<Response> => response(
    url === GOOGLE_ANDROID_ROOTS_URL ? JSON.stringify([ROOT]) : STATUS,
    cachedAt,
    { age: "1800", "cache-control": "public, max-age=3600" },
  );
  const loaded = await syncAndroidTrustMaterial({ outputPath, rootPolicy: policyFor(), fetcher: cachedFetcher, now: () => NOW });
  expect(loaded.material.nextUpdate).toBe("2026-08-08T12:30:00.000Z");
});

test("bildirilen veya gerçek büyük yanıt kalıcılaştırılmaz", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-size-")), "trust.json");
  await expect(syncAndroidTrustMaterial({
    outputPath,
    rootPolicy: policyFor(),
    fetcher: fetcherFor({ statusHeaders: { "content-length": String(1024 * 1024 + 1) } }),
    now: () => NOW,
  })).rejects.toThrow(/boyut sınırını aşıyor/);
});

test("mevcut paketin zaman ve sıra değeri geriye alınamaz", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-rollback-")), "trust.json");
  const rootPolicy = policyFor();
  await syncAndroidTrustMaterial({ outputPath, rootPolicy, fetcher: fetcherFor(), now: () => NOW });
  await expect(syncAndroidTrustMaterial({ outputPath, rootPolicy, fetcher: fetcherFor(), now: () => NOW }))
    .rejects.toThrow(/geriye alınamaz/);
});

test("paket bütünlüğü ve sabit kök politikası birlikte doğrulanır", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-tamper-")), "trust.json");
  const rootPolicy = policyFor();
  await syncAndroidTrustMaterial({ outputPath, rootPolicy, fetcher: fetcherFor(), now: () => NOW });
  const tampered = JSON.parse(readFileSync(outputPath, "utf8")) as Record<string, unknown>;
  tampered.roots = [ROGUE_ROOT];
  tampered.rootFingerprints = [fingerprint(ROGUE_ROOT)];
  const { digest: _oldDigest, ...unsigned } = tampered;
  tampered.digest = createHash("sha256").update(JSON.stringify(unsigned)).digest("hex");
  expect(() => parseAndroidTrustMaterial(JSON.stringify(tampered), rootPolicy)).toThrow(/onaylı politikayla uyuşmuyor/);

  tampered.digest = "0".repeat(64);
  expect(() => parseAndroidTrustMaterial(JSON.stringify(tampered), rootPolicy)).toThrow(/bütünlüğü bozuk/);
});

test("eskimiş paket operasyon doğrulamasında fail-closed kalır", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-stale-")), "trust.json");
  const rootPolicy = policyFor();
  const loaded = await syncAndroidTrustMaterial({ outputPath, rootPolicy, fetcher: fetcherFor(), now: () => NOW });
  expect(() => assertAndroidTrustMaterialFresh(loaded, new Date("2026-08-08T13:00:00.000Z"))).toThrow(/eskimiş/);
});

test("kilit dosyası eşzamanlı yazarı durdurur", async () => {
  const outputPath = join(mkdtempSync(join(tmpdir(), "kionel-android-lock-")), "trust.json");
  writeFileSync(`${outputPath}.lock`, "operator investigation required", { flag: "wx" });
  await expect(syncAndroidTrustMaterial({ outputPath, rootPolicy: policyFor(), fetcher: fetcherFor(), now: () => NOW }))
    .rejects.toThrow(/zaten çalışıyor/);
});

test("depodaki Google kök politikası katı şemayla ve iki kökle açılır", () => {
  const json = readFileSync(new URL("../../../config/android-google-roots.json", import.meta.url), "utf8");
  const policy = parseAndroidRootPolicy(json);
  expect(policy.roots).toHaveLength(2);
  expect(policy.roots.map((root) => root.sha256)).toEqual([
    "cedb1cb6dc896ae5ec797348bce9286753c2b38ee71ce0fbe34a9a1248800dfc",
    "6d9db4ce6c5c0b293166d08986e05774a8776ceb525d9e4329520de12ba4bcc0",
  ]);
});
