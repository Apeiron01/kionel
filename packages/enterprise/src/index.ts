/**
 * Signed offline enterprise trust snapshots.
 *
 * The bundle contains no transferred content. It lets an air-gapped Kionel client
 * authenticate enrolled peer keys, enforce tenant/site/role policy, and reject
 * revoked devices without contacting a service during optical transfer.
 */
import type { SessionCapabilities } from "@kionel/core";
import {
  b64, p256KeyReference, sha256, signEs256, unb64, verifyEs256, verifyKeyReferenceV2,
  type DispatchContext, type KeyReferenceV2,
} from "@kionel/crypto";
import {
  ENTERPRISE_KEY_POLICY, requireKeyPolicy, type AttestationFormat,
  type KeySecurityLevel, type PlatformSigningIdentity,
} from "@kionel/platform-keys";
import {
  enterpriseSdkV2Options, type PeerTrustResolver, type SdkV2Options,
} from "@kionel/sdk";

export const ENTERPRISE_BUNDLE_SCHEMA = "kionel-enterprise-trust/v1" as const;
export const MAX_BUNDLE_DEVICES = 10_000;
export const MAX_BUNDLE_REVOCATIONS = 20_000;
export const MAX_BUNDLE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;
export const MAX_DEVICE_ENROLLMENT_MS = 400 * 24 * 60 * 60 * 1000;
export const MAX_ATTESTATION_AGE_MS = 24 * 60 * 60 * 1000;
export const CLOCK_SKEW_MS = 5 * 60 * 1000;
const VERIFIED_BUNDLE = Symbol("Kionel_VERIFIED_ENTERPRISE_BUNDLE");

export type DeviceRole = "operator" | "lab-terminal" | "custody-terminal" | "kiosk" | "auditor";
export type RevocationReason = "key-compromise" | "device-lost" | "retired" | "role-ended" | "policy-violation";
export type HardwareSecurityLevel = Exclude<KeySecurityLevel, "software-protected">;

export interface EnrolledDevice {
  deviceId: string;
  siteId: string;
  displayName: string;
  key: KeyReferenceV2;
  providerId: string;
  securityLevel: HardwareSecurityLevel;
  attestationFormat: AttestationFormat;
  attestationVerifier: string;
  attestationVerifiedAt: string;
  enrolledAt: string;
  expiresAt: string;
  roles: DeviceRole[];
}

export interface DeviceRevocation {
  kid: string;
  effectiveAt: string;
  reason: RevocationReason;
}

export interface EnterpriseTransferPolicy {
  version: number;
  allowedProfiles: DispatchContext["profile"][];
  requireContext: boolean;
  maxContentBytes: number;
  transports: string[];
  maxFrameBytes: number;
  maxFps: number;
  duplex: boolean;
  arq: boolean;
  resume: boolean;
}

export interface EnterpriseTrustBundle {
  schema: typeof ENTERPRISE_BUNDLE_SCHEMA;
  tenantId: string;
  sequence: number;
  issuedAt: string;
  expiresAt: string;
  authority: KeyReferenceV2;
  policy: EnterpriseTransferPolicy;
  devices: EnrolledDevice[];
  revocations: DeviceRevocation[];
  sig: string;
}

export interface VerifiedEnterpriseBundle {
  readonly [VERIFIED_BUNDLE]: true;
  bundle: EnterpriseTrustBundle;
  digest: string;
  verifiedAt: string;
}

export type BundleVerification =
  | { ok: true; reason: string; verified: VerifiedEnterpriseBundle }
  | { ok: false; reason: string };

export interface BundleVerificationOptions {
  expectedTenantId: string;
  minimumSequence: number;
  now?: Date;
}

export interface EnrollmentInput {
  deviceId: string;
  siteId: string;
  displayName: string;
  roles: DeviceRole[];
  enrolledAt?: Date;
  expiresAt: Date;
}

export async function createEnrolledDevice(
  identity: PlatformSigningIdentity,
  input: EnrollmentInput,
): Promise<EnrolledDevice> {
  requireKeyPolicy(identity, ENTERPRISE_KEY_POLICY);
  if (identity.attestation.status !== "verified" || !identity.attestation.format ||
      !identity.attestation.verifiedBy || !identity.attestation.verifiedAt) {
    throw new Error("kurumsal cihaz enrollment doğrulanmış platform kanıtı gerektiriyor");
  }
  const enrolledAt = input.enrolledAt ?? new Date();
  const record: EnrolledDevice = {
    deviceId: input.deviceId,
    siteId: input.siteId,
    displayName: input.displayName,
    key: await p256KeyReference(identity),
    providerId: identity.providerId,
    securityLevel: identity.securityLevel as HardwareSecurityLevel,
    attestationFormat: identity.attestation.format,
    attestationVerifier: identity.attestation.verifiedBy,
    attestationVerifiedAt: identity.attestation.verifiedAt,
    enrolledAt: strictDate(enrolledAt),
    expiresAt: strictDate(input.expiresAt),
    roles: [...input.roles],
  };
  if (!validDevice(record)) throw new Error("kurumsal cihaz enrollment alanları geçersiz");
  return record;
}

export async function issueEnterpriseTrustBundle(
  authority: PlatformSigningIdentity,
  input: Omit<EnterpriseTrustBundle, "schema" | "authority" | "sig">,
): Promise<EnterpriseTrustBundle> {
  requireKeyPolicy(authority, ENTERPRISE_KEY_POLICY);
  const body: Omit<EnterpriseTrustBundle, "sig"> = {
    schema: ENTERPRISE_BUNDLE_SCHEMA,
    ...input,
    authority: await p256KeyReference(authority),
    policy: clonePolicy(input.policy),
    devices: [...input.devices].map(cloneDevice).sort((left, right) => left.key.kid.localeCompare(right.key.kid)),
    revocations: [...input.revocations].map((item) => ({ ...item })).sort(revocationOrder),
  };
  const shape = validateBundleBody(body);
  if (shape) throw new Error(`kurumsal trust bundle üretilemedi: ${shape}`);
  return { ...body, sig: b64(await signEs256(authority, bundleBodyBytes(body))) };
}

export async function verifyEnterpriseTrustBundle(
  value: unknown,
  pinnedAuthority: KeyReferenceV2,
  options: BundleVerificationOptions,
): Promise<BundleVerification> {
  try {
    if (!isEnterpriseTrustBundle(value)) return { ok: false, reason: "kurumsal trust bundle biçimi geçersiz" };
    if (!(await verifyKeyReferenceV2(pinnedAuthority)) || !(await verifyKeyReferenceV2(value.authority))) {
      return { ok: false, reason: "kurumsal trust anchor biçimi geçersiz" };
    }
    if (!sameKey(value.authority, pinnedAuthority)) return { ok: false, reason: "trust bundle sabitlenmiş kurum köküyle imzalanmamış" };
    if (value.tenantId !== options.expectedTenantId) return { ok: false, reason: "trust bundle tenant uyuşmuyor" };
    if (!Number.isSafeInteger(options.minimumSequence) || options.minimumSequence < 0 || value.sequence < options.minimumSequence) {
      return { ok: false, reason: "trust bundle sıra numarası rollback sınırının altında" };
    }
    const now = options.now ?? new Date();
    if (!validDate(now)) return { ok: false, reason: "doğrulama zamanı geçersiz" };
    if (now.getTime() + CLOCK_SKEW_MS < Date.parse(value.issuedAt)) return { ok: false, reason: "trust bundle henüz geçerli değil" };
    if (now.getTime() >= Date.parse(value.expiresAt)) return { ok: false, reason: "trust bundle süresi dolmuş" };
    const { sig, ...body } = value;
    if (!(await verifyEs256(unb64(value.authority.key), unb64(sig), bundleBodyBytes(body)))) {
      return { ok: false, reason: "trust bundle kurum imzası geçersiz" };
    }
    for (const device of value.devices) {
      if (!(await verifyKeyReferenceV2(device.key))) return { ok: false, reason: `${device.deviceId}: cihaz anahtar referansı geçersiz` };
    }
    const digest = b64(await sha256(bundleCompleteBytes(value)));
    const safeBundle = deepFreeze(cloneBundle(value));
    return {
      ok: true,
      reason: `tenant ${value.tenantId} trust bundle #${value.sequence} doğrulandı`,
      verified: { [VERIFIED_BUNDLE]: true, bundle: safeBundle, digest, verifiedAt: now.toISOString() },
    };
  } catch {
    return { ok: false, reason: "kurumsal trust bundle doğrulanamadı" };
  }
}

export interface ResolverConstraints {
  siteId?: string;
  requiredAnyRole?: readonly DeviceRole[];
  now?: Date;
}

export function createEnterprisePeerResolver(
  verified: VerifiedEnterpriseBundle,
  constraints: ResolverConstraints = {},
): PeerTrustResolver {
  if (verified?.[VERIFIED_BUNDLE] !== true) throw new Error("doğrulanmamış nesne enterprise resolver'a verilemez");
  const bundle = verified.bundle;
  const devices = new Map(bundle.devices.map((device) => [device.key.kid, device]));
  const revocations = new Map(bundle.revocations.map((entry) => [entry.kid, entry]));
  return async (peer) => {
    if (!(await verifyKeyReferenceV2(peer))) return { trusted: false, reason: "peer anahtar referansı geçersiz" };
    const device = devices.get(peer.kid);
    if (!device || !sameKey(device.key, peer)) return { trusted: false, reason: "cihaz enrollment kaydında yok" };
    const now = constraints.now ?? new Date();
    if (!validDate(now)) return { trusted: false, reason: "cihaz güven değerlendirme zamanı geçersiz" };
    if (now.getTime() + CLOCK_SKEW_MS < Date.parse(device.enrolledAt)) return { trusted: false, reason: "cihaz enrollment henüz geçerli değil" };
    if (now.getTime() >= Date.parse(device.expiresAt)) return { trusted: false, reason: "cihaz enrollment süresi dolmuş" };
    const revoked = revocations.get(peer.kid);
    if (revoked && now.getTime() >= Date.parse(revoked.effectiveAt)) return { trusted: false, reason: `cihaz iptal edilmiş: ${revoked.reason}` };
    if (constraints.siteId && device.siteId !== constraints.siteId) return { trusted: false, reason: "cihaz izin verilen site dışında" };
    if (constraints.requiredAnyRole?.length && !constraints.requiredAnyRole.some((role) => device.roles.includes(role))) {
      return { trusted: false, reason: "cihaz gerekli role sahip değil" };
    }
    return { trusted: true, reason: `${device.deviceId} aktif enrollment` };
  };
}

export async function enterpriseRuntimeOptions(
  localIdentity: PlatformSigningIdentity,
  verified: VerifiedEnterpriseBundle,
  constraints: ResolverConstraints = {},
): Promise<SdkV2Options> {
  requireKeyPolicy(localIdentity, ENTERPRISE_KEY_POLICY);
  const resolver = createEnterprisePeerResolver(verified, constraints);
  const local = await resolver(await p256KeyReference(localIdentity));
  if (!local.trusted) throw new Error(`yerel cihaz trust bundle tarafından reddedildi: ${local.reason}`);
  const policy = verified.bundle.policy;
  return {
    ...enterpriseSdkV2Options(resolver),
    maxContentBytes: policy.maxContentBytes,
    capabilities: policyCapabilities(policy),
    allowedProfiles: [...policy.allowedProfiles],
    requireContext: policy.requireContext,
  };
}

export function isEnterpriseTrustBundle(value: unknown): value is EnterpriseTrustBundle {
  if (!value || typeof value !== "object") return false;
  const bundle = value as EnterpriseTrustBundle;
  if (!exactKeys(bundle, [
    "schema", "tenantId", "sequence", "issuedAt", "expiresAt", "authority", "policy", "devices", "revocations", "sig",
  ])) return false;
  const { sig, ...body } = bundle;
  return signature(sig) && validateBundleBody(body) === undefined;
}

export function bundleBodyBytes(body: Omit<EnterpriseTrustBundle, "sig">): Uint8Array<ArrayBuffer> {
  return encode([
    "Kionel-ENTERPRISE-TRUST-V1", body.schema, body.tenantId, body.sequence, body.issuedAt, body.expiresAt,
    keyTuple(body.authority), policyTuple(body.policy), body.devices.map(deviceTuple), body.revocations.map(revocationTuple),
  ]);
}

function validateBundleBody(body: Omit<EnterpriseTrustBundle, "sig">): string | undefined {
  if (body.schema !== ENTERPRISE_BUNDLE_SCHEMA || !identifier(body.tenantId, 80)) return "schema veya tenant geçersiz";
  if (!Number.isSafeInteger(body.sequence) || body.sequence <= 0) return "sequence pozitif güvenli tamsayı olmalı";
  if (!timestamp(body.issuedAt) || !timestamp(body.expiresAt) || Date.parse(body.expiresAt) <= Date.parse(body.issuedAt) ||
      Date.parse(body.expiresAt) - Date.parse(body.issuedAt) > MAX_BUNDLE_LIFETIME_MS) return "bundle geçerlilik aralığı geçersiz";
  if (!keyShape(body.authority)) return "authority geçersiz";
  if (!validPolicy(body.policy)) return "transfer politikası geçersiz";
  if (!Array.isArray(body.devices) || body.devices.length === 0 || body.devices.length > MAX_BUNDLE_DEVICES ||
      body.devices.some((device) => !validDevice(device))) return "cihaz listesi geçersiz";
  if (!Array.isArray(body.revocations) || body.revocations.length > MAX_BUNDLE_REVOCATIONS ||
      body.revocations.some((entry) => !validRevocation(entry))) return "iptal listesi geçersiz";
  if (!sorted(body.devices.map((device) => device.key.kid)) ||
      !sorted(body.revocations.map((entry) => `${entry.kid}\0${entry.effectiveAt}`))) return "bundle listeleri kanonik sıralı değil";
  if (unique(body.devices.map((device) => device.key.kid)).size !== body.devices.length ||
      unique(body.devices.map((device) => device.deviceId)).size !== body.devices.length ||
      unique(body.revocations.map((entry) => entry.kid)).size !== body.revocations.length) return "tekrarlanan cihaz veya iptal kaydı";
  const enrolled = new Set(body.devices.map((device) => device.key.kid));
  if (body.revocations.some((entry) => !enrolled.has(entry.kid))) return "iptal kaydı enrollment listesinde olmayan anahtara ait";
  return undefined;
}

function validDevice(value: EnrolledDevice): boolean {
  if (!value || typeof value !== "object" || !exactKeys(value, [
    "deviceId", "siteId", "displayName", "key", "providerId", "securityLevel", "attestationFormat",
    "attestationVerifier", "attestationVerifiedAt", "enrolledAt", "expiresAt", "roles",
  ])) return false;
  return identifier(value.deviceId, 80) && identifier(value.siteId, 80) && safeText(value.displayName, 120) &&
    keyShape(value.key) && identifier(value.providerId, 128) &&
    ["tee", "strongbox", "secure-enclave", "tpm"].includes(value.securityLevel) &&
    ["android-key-attestation", "apple-app-attest", "windows-tpm", "vendor-managed"].includes(value.attestationFormat) &&
    identifier(value.attestationVerifier, 128) && timestamp(value.attestationVerifiedAt) && timestamp(value.enrolledAt) &&
    timestamp(value.expiresAt) && Date.parse(value.expiresAt) > Date.parse(value.enrolledAt) &&
    Date.parse(value.expiresAt) - Date.parse(value.enrolledAt) <= MAX_DEVICE_ENROLLMENT_MS &&
    Date.parse(value.attestationVerifiedAt) <= Date.parse(value.enrolledAt) + CLOCK_SKEW_MS &&
    Date.parse(value.enrolledAt) - Date.parse(value.attestationVerifiedAt) <= MAX_ATTESTATION_AGE_MS &&
    Array.isArray(value.roles) && value.roles.length > 0 && value.roles.length <= 5 &&
    value.roles.every(validRole) && unique(value.roles).size === value.roles.length;
}

function validRevocation(value: DeviceRevocation): boolean {
  return !!value && typeof value === "object" && exactKeys(value, ["kid", "effectiveAt", "reason"]) &&
    /^urn:kionel:key:sha256:[A-Za-z0-9_-]{43}$/.test(value.kid) && timestamp(value.effectiveAt) &&
    ["key-compromise", "device-lost", "retired", "role-ended", "policy-violation"].includes(value.reason);
}

function validPolicy(value: EnterpriseTransferPolicy): boolean {
  return !!value && typeof value === "object" && exactKeys(value, [
    "version", "allowedProfiles", "requireContext", "maxContentBytes", "transports", "maxFrameBytes", "maxFps",
    "duplex", "arq", "resume",
  ]) && Number.isSafeInteger(value.version) && value.version > 0 &&
    Array.isArray(value.allowedProfiles) && value.allowedProfiles.length > 0 && value.allowedProfiles.length <= 3 &&
    value.allowedProfiles.every((profile) => ["lab", "custody", "personal"].includes(profile)) &&
    unique(value.allowedProfiles).size === value.allowedProfiles.length && typeof value.requireContext === "boolean" &&
    Number.isSafeInteger(value.maxContentBytes) && value.maxContentBytes > 0 && value.maxContentBytes <= 64 * 1024 * 1024 &&
    Array.isArray(value.transports) && value.transports.length > 0 && value.transports.length <= 8 &&
    value.transports.every((transport) => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(transport)) &&
    unique(value.transports).size === value.transports.length && Number.isInteger(value.maxFrameBytes) &&
    value.maxFrameBytes >= 256 && value.maxFrameBytes <= 4096 && Number.isInteger(value.maxFps) &&
    value.maxFps >= 1 && value.maxFps <= 120 && [value.duplex, value.arq, value.resume].every((item) => typeof item === "boolean") &&
    (!value.arq || value.duplex) && (!value.resume || value.duplex);
}

function policyCapabilities(policy: EnterpriseTransferPolicy): SessionCapabilities {
  return {
    v: 1, transports: [...policy.transports], maxFrameBytes: policy.maxFrameBytes, maxFps: policy.maxFps,
    duplex: policy.duplex, arq: policy.arq, resume: policy.resume,
  };
}
function policyTuple(value: EnterpriseTransferPolicy): unknown[] {
  return [value.version, value.allowedProfiles, value.requireContext, value.maxContentBytes, value.transports,
    value.maxFrameBytes, value.maxFps, value.duplex, value.arq, value.resume];
}
function deviceTuple(value: EnrolledDevice): unknown[] {
  return [value.deviceId, value.siteId, value.displayName, keyTuple(value.key), value.providerId, value.securityLevel,
    value.attestationFormat, value.attestationVerifier, value.attestationVerifiedAt, value.enrolledAt, value.expiresAt, value.roles];
}
function revocationTuple(value: DeviceRevocation): unknown[] { return [value.kid, value.effectiveAt, value.reason] }
function keyTuple(value: KeyReferenceV2): unknown[] { return [value.alg, value.kid, value.key] }
function keyShape(value: KeyReferenceV2): boolean {
  return !!value && typeof value === "object" && exactKeys(value, ["alg", "kid", "key"]) && value.alg === "ES256" &&
    /^urn:kionel:key:sha256:[A-Za-z0-9_-]{43}$/.test(value.kid) && /^[A-Za-z0-9_-]{87}$/.test(value.key);
}
function clonePolicy(value: EnterpriseTransferPolicy): EnterpriseTransferPolicy {
  return { ...value, allowedProfiles: [...value.allowedProfiles], transports: [...value.transports] };
}
function cloneDevice(value: EnrolledDevice): EnrolledDevice {
  return { ...value, key: { ...value.key }, roles: [...value.roles] };
}
function cloneBundle(value: EnterpriseTrustBundle): EnterpriseTrustBundle {
  return {
    ...value,
    authority: { ...value.authority },
    policy: clonePolicy(value.policy),
    devices: value.devices.map(cloneDevice),
    revocations: value.revocations.map((entry) => ({ ...entry })),
  };
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function bundleCompleteBytes(value: EnterpriseTrustBundle): Uint8Array<ArrayBuffer> {
  const { sig, ...body } = value;
  return encode(["Kionel-ENTERPRISE-TRUST-V1-COMPLETE", b64(bundleBodyBytes(body)), sig]);
}
function revocationOrder(left: DeviceRevocation, right: DeviceRevocation): number {
  return left.kid.localeCompare(right.kid) || left.effectiveAt.localeCompare(right.effectiveAt);
}
function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}
function strictDate(value: Date): string {
  if (!validDate(value)) throw new Error("kurumsal zaman damgası geçersiz");
  return value.toISOString();
}
function timestamp(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function identifier(value: string, maximum: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}
function safeText(value: string, maximum: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.normalize("NFC") &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);
}
function validRole(value: string): value is DeviceRole {
  return ["operator", "lab-terminal", "custody-terminal", "kiosk", "auditor"].includes(value);
}
function signature(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_-]{86}$/.test(value) }
function sameKey(left: KeyReferenceV2, right: KeyReferenceV2): boolean {
  return left.alg === right.alg && left.kid === right.kid && left.key === right.key;
}
function sorted(values: readonly string[]): boolean {
  for (let index = 1; index < values.length; index++) if (values[index - 1].localeCompare(values[index]) > 0) return false;
  return true;
}
function unique<T>(values: readonly T[]): Set<T> { return new Set(values) }
function validDate(value: Date): boolean { return value instanceof Date && Number.isFinite(value.getTime()) }
function encode(value: unknown): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(JSON.stringify(value)) }
