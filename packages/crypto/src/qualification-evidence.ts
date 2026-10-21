// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/** Fiziksel cihaz kalifikasyon sonucunu ölçümü yapan cihaz kimliğine bağlar. */
import { unb64, type Bytes } from "./index.ts";
import type { Verdict } from "./receipt.ts";

export interface QualificationEvidenceBody {
  v: 1;
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

export interface QualificationEvidence extends QualificationEvidenceBody {
  /** Ölçümü kaydeden cihazın Ed25519 açık anahtarı. */
  signer: string;
  sig: string;
}

export async function verifyQualificationEvidence(value: unknown): Promise<Verdict> {
  if (!isQualificationEvidence(value)) {
    return { ok: false, reason: "fiziksel qualification kanıtı biçimi geçersiz", signers: [] };
  }
  try {
    const { signer, sig, ...body } = value;
    const key = await globalThis.crypto.subtle.importKey("raw", unb64(signer), { name: "Ed25519" }, true, ["verify"]);
    const ok = await globalThis.crypto.subtle.verify(
      { name: "Ed25519" }, key, unb64(sig), qualificationEvidenceBytes(body, signer),
    );
    return ok
      ? { ok: true, reason: "fiziksel cihaz ölçüm imzası doğrulandı", signers: [signer] }
      : { ok: false, reason: "fiziksel cihaz ölçüm imzası geçersiz", signers: [] };
  } catch {
    return { ok: false, reason: "fiziksel cihaz ölçüm imzası doğrulanamadı", signers: [] };
  }
}

export function isQualificationEvidence(value: unknown): value is QualificationEvidence {
  if (!value || typeof value !== "object") return false;
  const evidence = value as QualificationEvidence;
  const keys = Object.keys(evidence);
  return keys.length === 13 && keys.every((key) => [
    "v", "sender", "receiver", "browser", "transport", "attempts", "successes",
    "silentCorruptions", "meanGoodputKBs", "startedAt", "endedAt", "signer", "sig",
  ].includes(key)) && isQualificationBody(evidence) && /^[A-Za-z0-9_-]{43}$/.test(evidence.signer) &&
    /^[A-Za-z0-9_-]{86}$/.test(evidence.sig);
}

export function isQualificationBody(value: QualificationEvidenceBody): boolean {
  return value.v === 1 && label(value.sender) && label(value.receiver) && value.sender !== value.receiver &&
    label(value.browser) && label(value.transport) && Number.isSafeInteger(value.attempts) && value.attempts > 0 &&
    Number.isSafeInteger(value.successes) && value.successes >= 0 && value.successes <= value.attempts &&
    Number.isSafeInteger(value.silentCorruptions) && value.silentCorruptions >= 0 &&
    value.silentCorruptions <= value.attempts - value.successes &&
    Number.isFinite(value.meanGoodputKBs) && value.meanGoodputKBs >= 0 && value.meanGoodputKBs <= 1_000_000 &&
    timestamp(value.startedAt) && timestamp(value.endedAt) && Date.parse(value.endedAt) >= Date.parse(value.startedAt);
}

export function qualificationEvidenceBytes(body: QualificationEvidenceBody, signer: string): Bytes {
  return new TextEncoder().encode(JSON.stringify([
    "kionel-qualification-evidence", body.v, body.sender, body.receiver, body.browser, body.transport,
    body.attempts, body.successes, body.silentCorruptions, body.meanGoodputKBs,
    body.startedAt, body.endedAt, signer,
  ]));
}
function label(value: string): boolean { return typeof value === "string" && value.length > 0 && value.length <= 120 }
function timestamp(value: string): boolean { return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value)) }
