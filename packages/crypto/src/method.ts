// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/** Offline method release gate. This verifies authorization, never executes a method. */
import type { Bytes } from "./index.ts";
import { b64, sha256, verifyDispatch, type Dispatch } from "./receipt.ts";
import { verifyEndorsements, type Endorsement } from "./endorsement.ts";

export interface MethodManifest {
  schema: "kionel-method/v1";
  releaseId: string;
  methodId: string;
  target: string;
  revision: number;
  hash: string;
  bytes: number;
  notBefore: string;
  expiresAt: string;
}

export interface MethodRelease {
  schema: "kionel-method-release/v1";
  manifest: MethodManifest;
  dispatch: Dispatch;
  endorsements: Endorsement[];
}

/** Installed independently by the recipient's administrator, never trusted from the bundle. */
export interface MethodPolicy {
  schema: "kionel-method-policy/v1";
  methodId: string;
  target: string;
  minimumRevision: number;
  publishers: string[];
  reviewers: string[];
  approvers: string[];
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: string[]) =>
  Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const identifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(v);
const digest = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{43}$/.test(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1;
const iso = (v: unknown): v is string => typeof v === "string" &&
  Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;

export function isMethodManifest(v: unknown): v is MethodManifest {
  return object(v) && exact(v, ["schema", "releaseId", "methodId", "target", "revision", "hash", "bytes", "notBefore", "expiresAt"]) &&
    v.schema === "kionel-method/v1" && identifier(v.releaseId) && identifier(v.methodId) && identifier(v.target) &&
    revision(v.revision) && digest(v.hash) && Number.isSafeInteger(v.bytes) &&
    (v.bytes as number) > 0 && (v.bytes as number) <= 64 * 1024 * 1024 &&
    iso(v.notBefore) && iso(v.expiresAt) && Date.parse(v.notBefore) < Date.parse(v.expiresAt);
}

export function isMethodPolicy(v: unknown): v is MethodPolicy {
  if (!object(v) || !exact(v, ["schema", "methodId", "target", "minimumRevision", "publishers", "reviewers", "approvers"])) return false;
  const keys = (a: unknown) => Array.isArray(a) && a.length > 0 && a.length <= 64 && a.every(digest) && new Set(a).size === a.length;
  return v.schema === "kionel-method-policy/v1" && identifier(v.methodId) && identifier(v.target) &&
    revision(v.minimumRevision) && keys(v.publishers) && keys(v.reviewers) && keys(v.approvers);
}

export function methodManifestBytes(manifest: MethodManifest): Bytes {
  if (!isMethodManifest(manifest)) throw new Error("metot bildirimi geçersiz");
  const m = manifest;
  return new TextEncoder().encode(JSON.stringify([
    m.schema, m.releaseId, m.methodId, m.target, m.revision, m.hash, m.bytes, m.notBefore, m.expiresAt,
  ]));
}

export function isMethodRelease(value: unknown): value is MethodRelease {
  return object(value) && exact(value, ["schema", "manifest", "dispatch", "endorsements"]) &&
    value.schema === "kionel-method-release/v1" && isMethodManifest(value.manifest) &&
    Array.isArray(value.endorsements) && value.endorsements.length <= 2;
}

/** Approvals bind both the manifest and the publisher's exact dispatch signature. */
export function approvalBytes(release: MethodRelease): Bytes {
  return new TextEncoder().encode(JSON.stringify([
    "kionel-method-approval/v1", new TextDecoder().decode(methodManifestBytes(release.manifest)), release.dispatch.sig,
  ]));
}

export async function methodReleaseIntegrity(value: unknown, content: Bytes): Promise<string | undefined> {
  if (!isMethodRelease(value)) return "metot paketi biçimi geçersiz";
  if (content.length !== value.manifest.bytes || b64(await sha256(content)) !== value.manifest.hash) return "metot dosyası eşleşmiyor";
  const dispatch = await verifyDispatch(value.dispatch, methodManifestBytes(value.manifest));
  if (!dispatch.ok) return dispatch.reason;
  const chain = await verifyEndorsements(value.endorsements, approvalBytes(value));
  if (!chain.ok) return chain.reason;
  return undefined;
}

export async function verifyMethodRelease(
  value: unknown, content: Bytes, policy: unknown, now = new Date(),
): Promise<{ ok: boolean; reason: string }> {
  const fail = (reason: string) => ({ ok: false, reason });
  if (!isMethodPolicy(policy)) return fail("yerel metot yetki politikası geçersiz");
  if (!Number.isFinite(now.getTime())) return fail("doğrulama saati geçersiz");
  const error = await methodReleaseIntegrity(value, content);
  if (error) return fail(error);
  const release = value as MethodRelease;
  const m = release.manifest;
  if (m.methodId !== policy.methodId || m.target !== policy.target) return fail("metot veya hedef cihaz politikayla eşleşmiyor");
  if (m.revision < policy.minimumRevision) return fail("metot sürümü izin verilen en düşük sürümün altında");
  if (now.getTime() < Date.parse(m.notBefore) || now.getTime() >= Date.parse(m.expiresAt)) return fail("metot geçerlilik süresi dışında");
  if (!policy.publishers.includes(release.dispatch.sender)) return fail("yayınlayan yetkili değil");
  if (release.endorsements.length !== 2 || release.endorsements[0].role !== "reviewer" || release.endorsements[1].role !== "approver") {
    return fail("sıralı inceleme ve serbest bırakma onayları gerekli");
  }
  const [reviewer, approver] = release.endorsements;
  if (!policy.reviewers.includes(reviewer.signer) || !policy.approvers.includes(approver.signer)) return fail("onaylayan rol için yetkili değil");
  if (new Set([release.dispatch.sender, reviewer.signer, approver.signer]).size !== 3) return fail("üç farklı imza anahtarı gerekli");
  return { ok: true, reason: "dosya, hedef, sürüm, süre ve üç yetkili imza doğrulandı; cihaza uygulanmadı" };
}
