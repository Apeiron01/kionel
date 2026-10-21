// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import { b64, sha256, unb64, type DispatchContext, type Verdict } from "./receipt.ts";
import { owned, validP256PublicKey, verifyEs256, type CryptoBytes } from "./signature-v2.ts";

export const KIONEL_V2_PROTOCOL = "kionel-v2" as const;
export const KIONEL_V2_SIGNATURE_ALGORITHM = "ES256" as const;
export const MAX_V2_CONTENT_BYTES = 1024 * 1024 * 1024;

export interface KeyReferenceV2 {
  alg: typeof KIONEL_V2_SIGNATURE_ALGORITHM;
  /** RFC-style URI whose suffix is SHA-256(raw SEC1 public key), base64url. */
  kid: string;
  /** 65-byte uncompressed SEC1 P-256 public key, base64url. */
  key: string;
}

export interface DispatchV2 {
  v: 2;
  protocol: typeof KIONEL_V2_PROTOCOL;
  session: number;
  hash: string;
  bytes: number;
  at: string;
  sender: KeyReferenceV2;
  context?: DispatchContext;
  sig: string;
}

/**
 * An RFC 3161 countersignature carried alongside a receipt.
 *
 * Deliberately outside every canonical encoding: a timestamp stamps the signed
 * bytes, so it cannot be one of them. The core knows only the field's shape —
 * validating the token itself is @kionel/timestamp's job, and the evidence core
 * stays free of CMS and X.509.
 */
export interface ReceiptTimestampV2 {
  /** DER TimeStampToken, base64. */
  token: string;
  /** The authority's time, mirrored for readability. The token is the authority. */
  at: string;
}

export interface ReceiptV2 extends Omit<DispatchV2, "sender" | "context" | "sig"> {
  sender: KeyReferenceV2;
  receiver: KeyReferenceV2;
  dispatch?: DispatchV2;
  sig: string;
  tst?: ReceiptTimestampV2;
}

export type AnyReceipt = import("./receipt.ts").Receipt | ReceiptV2;
export type AnyDispatch = import("./receipt.ts").Dispatch | DispatchV2;

export async function p256KeyReference(identity: PlatformSigningIdentity): Promise<KeyReferenceV2> {
  if (identity.algorithm !== "ecdsa-p256-sha256") throw new Error("Kionel v2 key reference ES256 kimliği gerektirir");
  return p256KeyReferenceFromPublicKey(identity.publicKey);
}

export async function p256KeyReferenceFromPublicKey(publicKey: Uint8Array): Promise<KeyReferenceV2> {
  if (!validP256PublicKey(publicKey)) throw new Error("Kionel v2 P-256 açık anahtarı geçersiz");
  const digest = await sha256(owned(publicKey));
  return { alg: KIONEL_V2_SIGNATURE_ALGORITHM, kid: `urn:kionel:key:sha256:${b64(digest)}`, key: b64(owned(publicKey)) };
}

export async function verifyDispatchV2(value: unknown, content?: CryptoBytes): Promise<Verdict> {
  if (!isDispatchV2(value)) return invalid("Kionel v2 sevk biçimi veya alan sınırları geçersiz");
  if (!(await verifyKeyReferenceV2(value.sender))) return invalid("Kionel v2 gönderen anahtar referansı geçersiz");
  const { sig, ...body } = value;
  if (!(await verifyKeySignature(value.sender, sig, dispatchV2Bytes(body)))) return invalid("Kionel v2 gönderen imzası geçersiz");
  if (content) {
    if (content.length !== value.bytes) return { ok: false, reason: "boyut uyuşmuyor", signers: ["gönderen"] };
    if (b64(await sha256(content)) !== value.hash) return { ok: false, reason: "içerik hash'i uyuşmuyor", signers: ["gönderen"] };
  }
  return {
    ok: true,
    reason: `Kionel v2 gönderen imzası doğrulandı${content ? ", içerik eşleşti" : " (içerik verilmedi)"}`,
    signers: ["gönderen"],
  };
}

export async function verifyReceiptV2(value: unknown, content?: CryptoBytes): Promise<Verdict> {
  const signers: string[] = [];
  if (!isReceiptV2(value)) return { ...invalid("Kionel v2 makbuz biçimi veya alan sınırları geçersiz"), signers };
  if (!(await verifyKeyReferenceV2(value.sender)) || !(await verifyKeyReferenceV2(value.receiver))) {
    return { ...invalid("Kionel v2 anahtar referansı geçersiz"), signers };
  }
  const { sig, ...body } = value;
  if (!(await verifyKeySignature(value.receiver, sig, receiptV2Bytes(body)))) {
    return { ...invalid("Kionel v2 alıcı imzası geçersiz"), signers };
  }
  signers.push("alıcı");
  if (value.dispatch) {
    if (value.dispatch.session !== value.session || value.dispatch.hash !== value.hash ||
        value.dispatch.bytes !== value.bytes || !sameKey(value.dispatch.sender, value.sender)) {
      return { ok: false, reason: "Kionel v2 sevk kaydı makbuzla tutarsız", signers };
    }
    const dispatchVerdict = await verifyDispatchV2(value.dispatch);
    if (!dispatchVerdict.ok) return { ok: false, reason: dispatchVerdict.reason, signers };
    signers.push("gönderen");
  }
  if (content) {
    if (content.length !== value.bytes) return { ok: false, reason: "boyut uyuşmuyor", signers };
    if (b64(await sha256(content)) !== value.hash) return { ok: false, reason: "içerik hash'i uyuşmuyor", signers };
  }
  return {
    ok: true,
    reason: `${signers.join(" + ")} Kionel v2 imzası doğrulandı${content ? ", içerik eşleşti" : " (içerik verilmedi)"}`,
    signers,
  };
}

export function isDispatchV2(value: unknown): value is DispatchV2 {
  if (!value || typeof value !== "object") return false;
  const item = value as DispatchV2;
  return exactKeys(item, ["v", "protocol", "session", "hash", "bytes", "at", "sender", "sig"], ["context"]) &&
    item.v === 2 && item.protocol === KIONEL_V2_PROTOCOL && uint32(item.session) && contentLength(item.bytes) &&
    digest(item.hash) && timestamp(item.at) && keyReferenceShape(item.sender) && signature(item.sig) &&
    (item.context === undefined || validContextV2(item.context));
}

export function isReceiptV2(value: unknown): value is ReceiptV2 {
  if (!value || typeof value !== "object") return false;
  const item = value as ReceiptV2;
  return exactKeys(item, ["v", "protocol", "session", "hash", "bytes", "at", "sender", "receiver", "sig"], ["dispatch", "tst"]) &&
    item.v === 2 && item.protocol === KIONEL_V2_PROTOCOL && uint32(item.session) && contentLength(item.bytes) &&
    digest(item.hash) && timestamp(item.at) && keyReferenceShape(item.sender) && keyReferenceShape(item.receiver) &&
    signature(item.sig) && (item.dispatch === undefined || isDispatchV2(item.dispatch)) &&
    (item.tst === undefined || receiptTimestampShape(item.tst));
}

/** Shape only. A token that parses as base64 still has to survive the verifier. */
function receiptTimestampShape(value: unknown): value is ReceiptTimestampV2 {
  if (!value || typeof value !== "object") return false;
  const item = value as ReceiptTimestampV2;
  return exactKeys(item, ["token", "at"], []) &&
    typeof item.token === "string" && item.token.length > 0 && item.token.length <= 64 * 1024 &&
    /^[A-Za-z0-9+/]+=*$/.test(item.token) && timestamp(item.at);
}

export function dispatchV2Bytes(body: Omit<DispatchV2, "sig">): CryptoBytes {
  return encodeCanonical([
    "KIONEL-V2-DISPATCH", body.v, body.protocol, body.session, body.hash, body.bytes, body.at,
    keyTuple(body.sender), contextTuple(body.context),
  ]);
}

export function receiptV2Bytes(body: Omit<ReceiptV2, "sig">): CryptoBytes {
  return encodeCanonical([
    "KIONEL-V2-RECEIPT", body.v, body.protocol, body.session, body.hash, body.bytes, body.at,
    keyTuple(body.sender), keyTuple(body.receiver), body.dispatch?.sig ?? null,
  ]);
}

export function completeReceiptV2Bytes(receipt: ReceiptV2): CryptoBytes {
  const dispatch = receipt.dispatch ? [
    receipt.dispatch.v, receipt.dispatch.protocol, receipt.dispatch.session, receipt.dispatch.hash,
    receipt.dispatch.bytes, receipt.dispatch.at, keyTuple(receipt.dispatch.sender),
    contextTuple(receipt.dispatch.context), receipt.dispatch.sig,
  ] : null;
  return encodeCanonical([
    "KIONEL-V2-COMPLETE-RECEIPT", receipt.v, receipt.protocol, receipt.session, receipt.hash,
    receipt.bytes, receipt.at, keyTuple(receipt.sender), keyTuple(receipt.receiver), dispatch, receipt.sig,
  ]);
}

export async function verifyKeyReferenceV2(reference: KeyReferenceV2): Promise<boolean> {
  if (!keyReferenceShape(reference)) return false;
  try {
    const key = unb64(reference.key);
    const expected = await p256KeyReferenceFromPublicKey(key);
    return expected.kid === reference.kid;
  } catch {
    return false;
  }
}

async function verifyKeySignature(reference: KeyReferenceV2, signatureValue: string, data: CryptoBytes): Promise<boolean> {
  try { return verifyEs256(unb64(reference.key), unb64(signatureValue), data) } catch { return false }
}

function keyReferenceShape(value: KeyReferenceV2): boolean {
  return !!value && typeof value === "object" && exactKeys(value, ["alg", "kid", "key"]) &&
    value.alg === KIONEL_V2_SIGNATURE_ALGORITHM && /^urn:kionel:key:sha256:[A-Za-z0-9_-]{43}$/.test(value.kid) &&
    /^[A-Za-z0-9_-]{87}$/.test(value.key);
}

export function validContextV2(value: DispatchContext): boolean {
  if (!value || typeof value !== "object" || !exactKeys(value, ["profile"], ["reference", "classification", "note"])) return false;
  if (!["lab", "custody", "personal"].includes(value.profile)) return false;
  if (value.reference !== undefined && !safeText(value.reference, 120)) return false;
  if (value.note !== undefined && !safeText(value.note, 240)) return false;
  return value.classification === undefined || ["public", "internal", "confidential", "restricted"].includes(value.classification);
}

function safeText(value: string, maximum: number): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value === value.normalize("NFC") &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);
}

function keyTuple(value: KeyReferenceV2): unknown[] { return [value.alg, value.kid, value.key] }
function contextTuple(value?: DispatchContext): unknown {
  return value ? [value.profile, value.reference ?? null, value.classification ?? null, value.note ?? null] : null;
}
export function sameKey(left: KeyReferenceV2, right: KeyReferenceV2): boolean {
  return left.alg === right.alg && left.kid === right.kid && left.key === right.key;
}
function encodeCanonical(value: unknown): CryptoBytes { return owned(new TextEncoder().encode(JSON.stringify(value))) }
function exactKeys(value: object, required: readonly string[], optional: readonly string[] = []): boolean {
  const keys = Object.keys(value);
  return required.every((key) => keys.includes(key)) && keys.every((key) => required.includes(key) || optional.includes(key));
}
export function strictDate(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error("Kionel v2 zaman damgası geçersiz");
  return value.toISOString();
}
function timestamp(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function uint32(value: number): boolean { return Number.isInteger(value) && value >= 0 && value <= 0xffffffff }
function contentLength(value: number): boolean { return Number.isSafeInteger(value) && value >= 0 && value <= MAX_V2_CONTENT_BYTES }
function digest(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value) }
function signature(value: string): boolean { return typeof value === "string" && /^[A-Za-z0-9_-]{86}$/.test(value) }
function invalid(reason: string): Verdict { return { ok: false, reason, signers: [] } }
