import { X509Certificate, createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { parseAndroidStatusList, type AndroidRevocationSnapshot } from "./status-list.ts";

export const GOOGLE_ANDROID_ROOTS_URL = "https://android.googleapis.com/attestation/root";
export const GOOGLE_ANDROID_STATUS_URL = "https://android.googleapis.com/attestation/status";
export const ANDROID_ROOT_POLICY_SCHEMA = "kionel-android-root-policy/v1";
export const ANDROID_TRUST_MATERIAL_SCHEMA = "kionel-android-trust-material/v1";

const ROOT_BODY_LIMIT = 64 * 1024;
const STATUS_BODY_LIMIT = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_FRESHNESS_MS = 24 * 60 * 60_000;
const SHA256 = /^[a-f0-9]{64}$/;

export interface AndroidApprovedRoot {
  sha256: string;
  certificate: string;
}

export interface AndroidRootPolicy {
  schema: typeof ANDROID_ROOT_POLICY_SCHEMA;
  reviewedAt: string;
  source: typeof GOOGLE_ANDROID_ROOTS_URL;
  roots: readonly AndroidApprovedRoot[];
}

export interface AndroidTrustMaterial {
  schema: typeof ANDROID_TRUST_MATERIAL_SCHEMA;
  sequence: number;
  fetchedAt: string;
  nextUpdate: string;
  sources: {
    roots: typeof GOOGLE_ANDROID_ROOTS_URL;
    status: typeof GOOGLE_ANDROID_STATUS_URL;
  };
  rootFingerprints: readonly string[];
  roots: readonly string[];
  statusList: string;
  statusSha256: string;
  digest: string;
}

export interface LoadedAndroidTrustMaterial {
  material: AndroidTrustMaterial;
  trustAnchors: readonly string[];
  revocationStatus: AndroidRevocationSnapshot;
}

export interface SyncAndroidTrustMaterialOptions {
  outputPath: string;
  rootPolicy: AndroidRootPolicy;
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
  timeoutMs?: number;
  maxFreshnessMs?: number;
}

export function parseAndroidRootPolicy(json: string): AndroidRootPolicy {
  const value: unknown = JSON.parse(json);
  if (!plainObject(value) || !onlyKeys(value, ["schema", "reviewedAt", "source", "roots"])) {
    throw new Error("Android kök politikası şeması geçersiz");
  }
  if (value.schema !== ANDROID_ROOT_POLICY_SCHEMA || value.source !== GOOGLE_ANDROID_ROOTS_URL) {
    throw new Error("Android kök politikası kaynağı veya sürümü geçersiz");
  }
  if (typeof value.reviewedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.reviewedAt)) {
    throw new Error("Android kök politikası inceleme tarihi geçersiz");
  }
  const reviewedAt = Date.parse(`${value.reviewedAt}T00:00:00.000Z`);
  if (!Number.isFinite(reviewedAt) || new Date(reviewedAt).toISOString().slice(0, 10) !== value.reviewedAt) {
    throw new Error("Android kök politikası inceleme tarihi geçersiz");
  }
  if (!Array.isArray(value.roots) || value.roots.length < 1 || value.roots.length > 4) {
    throw new Error("Android kök politikası 1..4 kök içermeli");
  }
  const roots = value.roots.map((entry) => parseApprovedRoot(entry));
  if (new Set(roots.map((entry) => entry.sha256)).size !== roots.length) {
    throw new Error("Android kök politikası yinelenen kök içeriyor");
  }
  return Object.freeze({
    schema: ANDROID_ROOT_POLICY_SCHEMA,
    reviewedAt: value.reviewedAt,
    source: GOOGLE_ANDROID_ROOTS_URL,
    roots: Object.freeze(roots),
  });
}

export async function readAndroidRootPolicy(path: string): Promise<AndroidRootPolicy> {
  return parseAndroidRootPolicy(await readFile(path, "utf8"));
}

export async function readAndroidTrustMaterial(
  path: string,
  rootPolicy: AndroidRootPolicy,
): Promise<LoadedAndroidTrustMaterial> {
  return parseAndroidTrustMaterial(await readFile(path, "utf8"), rootPolicy);
}

export function assertAndroidTrustMaterialFresh(
  loaded: LoadedAndroidTrustMaterial,
  now: Date = new Date(),
): void {
  const time = now.getTime();
  if (!Number.isFinite(time)) throw new Error("Android güven paketi saati geçersiz");
  if (time < Date.parse(loaded.material.fetchedAt) - 5 * 60_000) throw new Error("Android güven paketi henüz geçerli değil");
  if (time >= Date.parse(loaded.material.nextUpdate)) throw new Error("Android güven paketi eskimiş");
}

export function parseAndroidTrustMaterial(
  json: string,
  rootPolicy: AndroidRootPolicy,
): LoadedAndroidTrustMaterial {
  const approvedPolicy = validateRootPolicy(rootPolicy);
  const value: unknown = JSON.parse(json);
  if (!plainObject(value) || !onlyKeys(value, [
    "schema", "sequence", "fetchedAt", "nextUpdate", "sources", "rootFingerprints",
    "roots", "statusList", "statusSha256", "digest",
  ])) throw new Error("Android güven paketi şeması geçersiz");
  if (value.schema !== ANDROID_TRUST_MATERIAL_SCHEMA) throw new Error("Android güven paketi sürümü desteklenmiyor");
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) throw new Error("Android güven paketi sırası geçersiz");
  if (!plainObject(value.sources) || !onlyKeys(value.sources, ["roots", "status"]) ||
      value.sources.roots !== GOOGLE_ANDROID_ROOTS_URL || value.sources.status !== GOOGLE_ANDROID_STATUS_URL) {
    throw new Error("Android güven paketi kaynakları geçersiz");
  }
  if (typeof value.fetchedAt !== "string" || typeof value.nextUpdate !== "string" ||
      typeof value.statusList !== "string" || typeof value.statusSha256 !== "string" || typeof value.digest !== "string" ||
      !Array.isArray(value.rootFingerprints) || value.rootFingerprints.some((item) => typeof item !== "string") ||
      !Array.isArray(value.roots) || value.roots.some((item) => typeof item !== "string")) {
    throw new Error("Android güven paketi alanları geçersiz");
  }
  if (!SHA256.test(value.statusSha256) || !SHA256.test(value.digest)) throw new Error("Android güven paketi özeti geçersiz");
  if (utf8Size(value.statusList) > STATUS_BODY_LIMIT) throw new Error("Android durum listesi boyut sınırını aşıyor");

  const material: AndroidTrustMaterial = {
    schema: ANDROID_TRUST_MATERIAL_SCHEMA,
    sequence: value.sequence as number,
    fetchedAt: value.fetchedAt,
    nextUpdate: value.nextUpdate,
    sources: { roots: GOOGLE_ANDROID_ROOTS_URL, status: GOOGLE_ANDROID_STATUS_URL },
    rootFingerprints: Object.freeze([...(value.rootFingerprints as string[])]),
    roots: Object.freeze([...(value.roots as string[])]),
    statusList: value.statusList,
    statusSha256: value.statusSha256,
    digest: value.digest,
  };
  if (sha256(material.statusList) !== material.statusSha256) throw new Error("Android durum listesi özeti uyuşmuyor");
  if (digestMaterial(material) !== material.digest) throw new Error("Android güven paketi bütünlüğü bozuk");
  validatePinnedRoots(material.roots, approvedPolicy, new Date(material.fetchedAt));
  const actualFingerprints = fingerprints(material.roots);
  if (!sameStrings(material.rootFingerprints, actualFingerprints)) throw new Error("Android kök parmak izleri uyuşmuyor");
  const revocationStatus = parseAndroidStatusList(material.statusList, material.fetchedAt, material.nextUpdate);
  return { material: Object.freeze(material), trustAnchors: material.roots, revocationStatus };
}

export async function syncAndroidTrustMaterial(
  options: SyncAndroidTrustMaterialOptions,
): Promise<LoadedAndroidTrustMaterial> {
  if (!isAbsolute(options.outputPath)) throw new Error("Android güven paketi yolu mutlak olmalı");
  const now = options.now?.() ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Android güven paketi saati geçersiz");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxFreshnessMs = options.maxFreshnessMs ?? DEFAULT_MAX_FRESHNESS_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw new Error("Android güven paketi timeout sınırı geçersiz");
  if (!Number.isSafeInteger(maxFreshnessMs) || maxFreshnessMs < 60_000 || maxFreshnessMs > DEFAULT_MAX_FRESHNESS_MS) {
    throw new Error("Android güven paketi tazelik sınırı geçersiz");
  }
  const rootPolicy = validateRootPolicy(options.rootPolicy);
  validatePinnedRoots(rootPolicy.roots.map((root) => root.certificate), rootPolicy, now);

  await mkdir(dirname(options.outputPath), { recursive: true });
  const lockPath = `${options.outputPath}.lock`;
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: now.toISOString() })}\n`, "utf8");
    await lock.sync();
  } catch (error) {
    if (isErrno(error, "EEXIST")) throw new Error("Android güven paketi güncellemesi zaten çalışıyor; kilidi inceleyin");
    throw error;
  }

  let temporaryPath: string | undefined;
  try {
    let previous: LoadedAndroidTrustMaterial | undefined;
    try {
      previous = await readAndroidTrustMaterial(options.outputPath, rootPolicy);
    } catch (error) {
      if (!isErrno(error, "ENOENT")) throw error;
    }
    if (previous && now.getTime() <= Date.parse(previous.material.fetchedAt)) {
      throw new Error("Android güven paketi zamanı geriye alınamaz");
    }

    const fetcher = options.fetcher ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let rootBody: string;
    let statusBody: string;
    let statusFreshnessMs: number;
    try {
      const [rootResponse, statusResponse] = await Promise.all([
        fetcher(GOOGLE_ANDROID_ROOTS_URL, requestInit(controller.signal)),
        fetcher(GOOGLE_ANDROID_STATUS_URL, requestInit(controller.signal)),
      ]);
      statusFreshnessMs = validateResponseFreshness(rootResponse, statusResponse, now);
      [rootBody, statusBody] = await Promise.all([
        validatedJsonBody(rootResponse, GOOGLE_ANDROID_ROOTS_URL, ROOT_BODY_LIMIT),
        validatedJsonBody(statusResponse, GOOGLE_ANDROID_STATUS_URL, STATUS_BODY_LIMIT),
      ]);
    } catch (error) {
      controller.abort();
      throw error;
    } finally {
      clearTimeout(timer);
    }
    const roots = parseRemoteRoots(rootBody, rootPolicy, now);
    const fetchedAt = now.toISOString();
    const nextUpdate = new Date(now.getTime() + Math.min(statusFreshnessMs, maxFreshnessMs)).toISOString();
    parseAndroidStatusList(statusBody, fetchedAt, nextUpdate);

    const unsigned: Omit<AndroidTrustMaterial, "digest"> = {
      schema: ANDROID_TRUST_MATERIAL_SCHEMA,
      sequence: (previous?.material.sequence ?? 0) + 1,
      fetchedAt,
      nextUpdate,
      sources: { roots: GOOGLE_ANDROID_ROOTS_URL, status: GOOGLE_ANDROID_STATUS_URL },
      rootFingerprints: Object.freeze(fingerprints(roots)),
      roots: Object.freeze(roots),
      statusList: statusBody,
      statusSha256: sha256(statusBody),
    };
    const material: AndroidTrustMaterial = { ...unsigned, digest: sha256(JSON.stringify(unsigned)) };
    const serialized = `${JSON.stringify(material, null, 2)}\n`;
    temporaryPath = `${options.outputPath}.${process.pid}.${randomUUID()}.tmp`;
    const file = await open(temporaryPath, "wx", 0o600);
    try {
      await file.writeFile(serialized, "utf8");
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporaryPath, options.outputPath);
    temporaryPath = undefined;
    await chmod(options.outputPath, 0o600);
    if (process.platform !== "win32") {
      const directory = await open(dirname(options.outputPath), "r");
      try { await directory.sync() } finally { await directory.close() }
    }
    return parseAndroidTrustMaterial(serialized, rootPolicy);
  } finally {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined);
    await lock.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
  }
}

function requestInit(signal: AbortSignal): RequestInit {
  return { method: "GET", redirect: "error", cache: "no-store", credentials: "omit", signal };
}

async function validatedJsonBody(response: Response, expectedUrl: string, limit: number): Promise<string> {
  if (response.status !== 200 || response.redirected) throw new Error(`Android güven kaynağı reddedildi: ${expectedUrl}`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new Error(`Android güven kaynağı JSON döndürmedi: ${expectedUrl}`);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > limit)) {
    throw new Error(`Android güven kaynağı boyut sınırını aşıyor: ${expectedUrl}`);
  }
  if (!response.body) throw new Error(`Android güven kaynağı boş: ${expectedUrl}`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error(`Android güven kaynağı boyut sınırını aşıyor: ${expectedUrl}`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseRemoteRoots(json: string, policy: AndroidRootPolicy, now: Date): string[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || value.length < 1 || value.length > 4 || value.some((item) => typeof item !== "string")) {
    throw new Error("Google Android kök listesi şeması geçersiz");
  }
  const roots = value as string[];
  validatePinnedRoots(roots, policy, now);
  return roots;
}

function validatePinnedRoots(roots: readonly string[], policy: AndroidRootPolicy, now: Date): void {
  const actual = fingerprintsAndValidate(roots, now);
  const approved = [...policy.roots].map((root) => {
    const fingerprint = certificateFingerprint(root.certificate);
    if (fingerprint !== root.sha256) throw new Error("Android kök politikası parmak izi sertifikayla uyuşmuyor");
    return root.sha256;
  }).sort();
  if (!sameStrings(actual, approved)) {
    throw new Error("Google Android kök kümesi onaylı politikayla uyuşmuyor; güven değişikliği inceleme gerektiriyor");
  }
}

function fingerprintsAndValidate(roots: readonly string[], now: Date): string[] {
  if (roots.length < 1 || roots.length > 4) throw new Error("Android güven kökü sayısı geçersiz");
  const values = roots.map((pem) => {
    if (typeof pem !== "string" || utf8Size(pem) > ROOT_BODY_LIMIT) throw new Error("Android güven kökü biçimi geçersiz");
    let certificate: X509Certificate;
    try { certificate = new X509Certificate(pem) } catch { throw new Error("Android güven kökü X.509 olarak ayrıştırılamadı") }
    if (!certificate.ca || certificate.subject !== certificate.issuer || !certificate.verify(certificate.publicKey)) {
      throw new Error("Android güven kökü kendinden imzalı bir CA değil");
    }
    if (now.getTime() < Date.parse(certificate.validFrom) || now.getTime() >= Date.parse(certificate.validTo)) {
      throw new Error("Android güven kökü geçerlilik süresi dışında");
    }
    return certificateFingerprint(certificate);
  }).sort();
  if (new Set(values).size !== values.length) throw new Error("Android güven kökü yineleniyor");
  return values;
}

function fingerprints(roots: readonly string[]): string[] {
  return roots.map((root) => certificateFingerprint(root)).sort();
}

function certificateFingerprint(input: string | X509Certificate): string {
  const certificate = typeof input === "string" ? new X509Certificate(input) : input;
  return certificate.fingerprint256.replaceAll(":", "").toLowerCase();
}

function parseApprovedRoot(value: unknown): AndroidApprovedRoot {
  if (!plainObject(value) || !onlyKeys(value, ["sha256", "certificate"]) ||
      typeof value.sha256 !== "string" || !SHA256.test(value.sha256) || typeof value.certificate !== "string") {
    throw new Error("Android kök politikası kaydı geçersiz");
  }
  if (utf8Size(value.certificate) > ROOT_BODY_LIMIT) throw new Error("Android kök politikası sertifikası çok büyük");
  if (certificateFingerprint(value.certificate) !== value.sha256) throw new Error("Android kök politikası parmak izi uyuşmuyor");
  return Object.freeze({ sha256: value.sha256, certificate: value.certificate });
}

function validateRootPolicy(policy: AndroidRootPolicy): AndroidRootPolicy {
  return parseAndroidRootPolicy(JSON.stringify(policy));
}

function validateResponseFreshness(rootResponse: Response, statusResponse: Response, now: Date): number {
  const root = responseFreshness(rootResponse, GOOGLE_ANDROID_ROOTS_URL);
  const status = responseFreshness(statusResponse, GOOGLE_ANDROID_STATUS_URL);
  if (Math.abs(root.currentTime - status.currentTime) > 60_000) {
    throw new Error("Android güven kaynaklarının sunucu saatleri uyuşmuyor");
  }
  if (Math.abs(status.currentTime - now.getTime()) > 5 * 60_000) {
    throw new Error("Yerel saat Google güven kaynağıyla uyuşmuyor");
  }
  return status.remainingMs;
}

function responseFreshness(response: Response, source: string): { currentTime: number; remainingMs: number } {
  const raw = response.headers.get("date");
  const date = raw ? Date.parse(raw) : Number.NaN;
  if (!Number.isFinite(date)) throw new Error(`Android güven kaynağı Date başlığı taşımıyor: ${source}`);
  const rawAge = response.headers.get("age") ?? "0";
  if (!/^\d+$/.test(rawAge)) throw new Error(`Android güven kaynağı Age başlığı geçersiz: ${source}`);
  const ageSeconds = Number(rawAge);
  if (!Number.isSafeInteger(ageSeconds)) throw new Error(`Android güven kaynağı Age başlığı geçersiz: ${source}`);
  const maxAgeSeconds = cacheMaxAge(response.headers.get("cache-control"));
  const remainingMs = (maxAgeSeconds - ageSeconds) * 1_000;
  if (remainingMs < 60_000) throw new Error(`Android güven kaynağının CDN tazeliği tükendi: ${source}`);
  return { currentTime: date + ageSeconds * 1_000, remainingMs };
}

function cacheMaxAge(value: string | null): number {
  if (!value) throw new Error("Android durum listesi Cache-Control max-age taşımıyor");
  const matches = value.split(",").map((part) => part.trim()).filter((part) => /^max-age=/i.test(part));
  if (matches.length !== 1) throw new Error("Android durum listesi Cache-Control max-age değeri geçersiz");
  const raw = matches[0].slice(matches[0].indexOf("=") + 1).trim();
  if (!/^\d+$/.test(raw)) throw new Error("Android durum listesi Cache-Control max-age değeri geçersiz");
  const seconds = Number(raw);
  if (!Number.isSafeInteger(seconds) || seconds < 60) throw new Error("Android durum listesi tazelik süresi çok kısa");
  return seconds;
}

function digestMaterial(material: AndroidTrustMaterial): string {
  const { digest: _digest, ...unsigned } = material;
  return sha256(JSON.stringify(unsigned));
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function utf8Size(value: string): number { return Buffer.byteLength(value, "utf8") }

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const expected = new Set(allowed);
  return Object.keys(value).length === expected.size && Object.keys(value).every((key) => expected.has(key));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
