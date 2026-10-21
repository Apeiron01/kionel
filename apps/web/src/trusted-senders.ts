/**
 * Alıcının kabul ettiği gönderenler ve tekrar gönderilen dosyalar.
 *
 * İmza, dosyayı hangi anahtarın imzaladığını söyler; o anahtarın kabul edilip
 * edilmeyeceğine alıcı karar verir. Liste boşken her gönderen kabul edilir (ilk
 * kurulum); bir gönderen sabitlenince yalnız listedekiler kabul edilir. Sertifika
 * otoritesi yoktur: güven, SSH'taki gibi, görülen anahtarın sabitlenmesidir.
 * Saf fonksiyonlar: DOM ve depolama yok.
 */
import { unb64, type Dispatch } from "@kionel/crypto";
import type { LogEntry } from "./transfer-log.ts";

export interface TrustedSender {
  /** Gönderen cihazın açık anahtarı (kayıttaki biçimiyle). */
  key: string;
  /** Sabitlendiği an (ISO). */
  at: string;
  /** Sabitlenirken alınan dosyanın adı; listeyi okuyan için ipucu. */
  file?: string;
}

export const TRUSTED_SENDER_LIMIT = 50;

/** İnsanın iki göndereni ayırt etmesi için kısa gösterim; karar tam anahtarla verilir. */
export function senderShort(key: string): string {
  try {
    const hex = Array.from(unb64(key).subarray(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
    return hex.replace(/(.{4})(?=.)/g, "$1 ");
  } catch {
    return key.slice(0, 16);
  }
}

export function isAccepted(list: readonly TrustedSender[], key: string): boolean {
  return list.length === 0 || list.some((sender) => sender.key === key);
}

/** Göndereni listeye ekler; zaten varsa liste değişmez. */
export function pinSender(list: readonly TrustedSender[], key: string, at: string, file?: string): TrustedSender[] {
  if (list.some((sender) => sender.key === key)) return [...list];
  if (list.length >= TRUSTED_SENDER_LIMIT) throw new Error(`this device already pins ${TRUSTED_SENDER_LIMIT} senders`);
  return [...list, { key, at, ...(file ? { file } : {}) }];
}

/**
 * Bu sevk daha önce alındı mı? Kimlik, sevk kaydının imzasıdır: aynı dosya yeniden
 * seçilip gönderilirse yeni bir sevktir ve teslim edilir; eski bir aktarımın bayt
 * bayt tekrarı ise aynı imzayı taşır.
 */
export function alreadyReceived(entries: readonly LogEntry[], dispatch: Dispatch): LogEntry | undefined {
  return entries.find((entry) => entry.kind === "received" && "dispatch" in entry.record && entry.record.dispatch?.sig === dispatch.sig);
}
