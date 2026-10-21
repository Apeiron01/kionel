// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import { unb64, type Verdict } from "./receipt.ts";
import {
  KIONEL_V2_PROTOCOL, verifyKeyReferenceV2, type KeyReferenceV2,
} from "./evidence-v2.ts";
import { owned, verifyEs256, type CryptoBytes } from "./signature-v2.ts";

export interface QualificationEvidenceBodyV2 {
  v: 2;
  protocol: typeof KIONEL_V2_PROTOCOL;
  sender: string;
  receiver: string;
  browser: string;
  transport: string;
  attempts: number;
  successes: number;
  silentCorruptions: number;
  meanGoodputKBs: number;
  startedAt: string;
  endedAt: string;
}

export interface QualificationEvidenceV2 extends QualificationEvidenceBodyV2 {
  signer: KeyReferenceV2;
  sig: string;
}

export async function verifyQualificationEvidenceV2(value: unknown): Promise<Verdict> {
  if (!isQualificationEvidenceV2(value) || !(await verifyKeyReferenceV2(value.signer))) {
    return { ok: false, reason: "Kionel v2 qualification kanıtı biçimi veya anahtarı geçersiz", signers: [] };
  }
  const { signer, sig, ...body } = value;
  let valid = false;
  try { valid = await verifyEs256(unb64(signer.key), unb64(sig), qualificationV2Bytes(body, signer)) } catch { valid = false }
  return valid
    ? { ok: true, reason: "Kionel v2 fiziksel cihaz ölçüm imzası doğrulandı", signers: [signer.kid] }
    : { ok: false, reason: "Kionel v2 fiziksel cihaz ölçüm imzası geçersiz", signers: [] };
}

export function isQualificationEvidenceV2(value: unknown): value is QualificationEvidenceV2 {
  if (!value || typeof value !== "object") return false;
  const evidence = value as QualificationEvidenceV2;
  const expected = [
    "v", "protocol", "sender", "receiver", "browser", "transport", "attempts", "successes",
    "silentCorruptions", "meanGoodputKBs", "startedAt", "endedAt", "signer", "sig",
  ];
  const keys = Object.keys(evidence);
  return keys.length === expected.length && keys.every((key) => expected.includes(key)) && isQualificationBodyV2(evidence) &&
    !!evidence.signer && typeof evidence.signer === "object" && Object.keys(evidence.signer).length === 3 &&
    evidence.signer.alg === "ES256" && /^urn:kionel:key:sha256:[A-Za-z0-9_-]{43}$/.test(evidence.signer.kid) &&
    /^[A-Za-z0-9_-]{87}$/.test(evidence.signer.key) && /^[A-Za-z0-9_-]{86}$/.test(evidence.sig);
}

export function qualificationV2Bytes(
  body: QualificationEvidenceBodyV2,
  signer: KeyReferenceV2,
): CryptoBytes {
  return owned(new TextEncoder().encode(JSON.stringify([
    "KIONEL-V2-QUALIFICATION", body.v, body.protocol, body.sender, body.receiver, body.browser,
    body.transport, body.attempts, body.successes, body.silentCorruptions, body.meanGoodputKBs,
    body.startedAt, body.endedAt, [signer.alg, signer.kid, signer.key],
  ])));
}

export function isQualificationBodyV2(value: QualificationEvidenceBodyV2): boolean {
  return value.v === 2 && value.protocol === KIONEL_V2_PROTOCOL && label(value.sender) && label(value.receiver) &&
    value.sender !== value.receiver && label(value.browser) && label(value.transport) &&
    Number.isSafeInteger(value.attempts) && value.attempts > 0 && Number.isSafeInteger(value.successes) &&
    value.successes >= 0 && value.successes <= value.attempts && Number.isSafeInteger(value.silentCorruptions) &&
    value.silentCorruptions >= 0 && value.silentCorruptions <= value.attempts - value.successes &&
    Number.isFinite(value.meanGoodputKBs) && value.meanGoodputKBs >= 0 && value.meanGoodputKBs <= 1_000_000 &&
    timestamp(value.startedAt) && timestamp(value.endedAt) && Date.parse(value.endedAt) >= Date.parse(value.startedAt);
}

function label(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && value === value.normalize("NFC") &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);
}
function timestamp(value: string): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
