/**
 * Fiziksel cihaz matrisi ölçümü — toplama tarafı.
 *
 * PRODUCT-READINESS P0/1: en az 5 cihaz, 5 yönlü çift, çift başına 1.000 aktarım,
 * en az %99 başarı, SIFIR sessiz bozulma. Değerlendirme mantığı zaten vardı;
 * eksik olan, gerçek telefonlarda o denemeleri yapıp imzalı kanıt üreten parçaydı.
 *
 * Tasarım kararı: alıcı ölçer. Başarıyı, bozulmayı ve süreyi yalnız alıcı
 * bilebilir; göndericinin "gönderdim" demesi ölçüm değildir.
 *
 * Sessiz bozulma tanımı: aktarım BAŞARIYLA tamamlandı (fountain çözüldü, CRC ve
 * AES-GCM etiketi geçti) ama içerik beklenenden farklı. Bu, kanalın değil
 * kodun hatasıdır ve tek bir tanesi bile kapıyı kapatır.
 */
import { type QualificationEvidenceV2 } from "@kionel/crypto";
import { issueQualificationEvidenceV2 } from "@kionel/issue";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";

export interface MatrixRunConfig {
  /** Çerçeve sessionId tabanı; deneme indeksi buna eklenir. */
  runId: number;
  /** Hedef deneme sayısı. Kapı 1.000 ister. */
  attempts: number;
  /** Deneme başına yük. Küçük tutulur: 1.000 aktarım makul sürede bitmeli. */
  payloadBytes: number;
}

export interface AttemptResult {
  index: number;
  /** Aktarım tamamlandı mı (fountain çözüldü, mühür açıldı). */
  completed: boolean;
  /** Tamamlandı ama içerik beklenenden farklı. */
  corrupted: boolean;
  bytes: number;
  seconds: number;
}

export interface MatrixSummary {
  attempts: number;
  successes: number;
  silentCorruptions: number;
  meanGoodputKBs: number;
  startedAt: string;
  endedAt: string;
}

export const MATRIX_GATE = Object.freeze({
  minAttemptsPerPair: 1000,
  minSuccessRate: 0.99,
  maxSilentCorruptions: 0,
});

/**
 * Deneme sınırı çerçevedeki `sessionId` ile taşınır: alıcı zaten sessionId
 * değişince decoder'ı sıfırlıyor, yani deneme sınırı bedava geliyor ve
 * protokolde tek bayt değişmiyor.
 */
export function frameSessionId(runId: number, index: number): number {
  return (runId + index) >>> 0;
}

export function attemptIndexFor(runId: number, sessionId: number, attempts: number): number | undefined {
  const index = (sessionId - runId) >>> 0;
  return index < attempts ? index : undefined;
}

/**
 * Deneme yükü iki tarafta da aynı şekilde türetilir; alıcı beklediğini
 * yeniden hesaplayıp bayt bayt karşılaştırabildiği için sessiz bozulma
 * gerçekten görülebilir hale gelir.
 */
export async function attemptPayload(runId: number, index: number, bytes: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(bytes) || bytes < 32 || bytes > 1024 * 1024) {
    throw new Error("deneme yükü 32 bayt ile 1 MiB arasında olmalı");
  }
  const out = new Uint8Array(bytes);
  const seed = new Uint8Array(12);
  const view = new DataView(seed.buffer);
  view.setUint32(0, runId >>> 0);
  view.setUint32(4, index);
  for (let at = 0, block = 0; at < bytes; block++) {
    view.setUint32(8, block);
    const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", seed));
    out.set(digest.subarray(0, Math.min(32, bytes - at)), at);
    at += 32;
  }
  return out;
}

/**
 * Deneme indeksi mühürlü zarfın İÇİNDEKİ dosya adında taşınır; AES-GCM ve CRC
 * ile korunduğu için kayan indeks yüzünden yanlış "sessiz bozulma" raporlanamaz.
 */
const MATRIX_FILE = /^kionel-matrix-(\d{1,6})\.bin$/;

export function matrixAttemptName(index: number): string {
  if (!Number.isSafeInteger(index) || index < 0 || index > 999_999) throw new Error("deneme indeksi 0..999999 olmalı");
  return `kionel-matrix-${index}.bin`;
}

export function matrixAttemptIndex(name: string): number | undefined {
  const match = MATRIX_FILE.exec(name);
  return match ? Number(match[1]) : undefined;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export class MatrixRunRecorder {
  readonly config: MatrixRunConfig;
  private readonly results = new Map<number, AttemptResult>();
  private highest = -1;
  private startedAt?: number;
  private endedAt?: number;

  constructor(config: MatrixRunConfig) {
    if (!Number.isSafeInteger(config.attempts) || config.attempts < 1 || config.attempts > 100_000) {
      throw new Error("deneme sayısı 1..100000 olmalı");
    }
    if (!Number.isSafeInteger(config.runId) || config.runId < 0 || config.runId > 0xffffffff) {
      throw new Error("runId 32 bit olmalı");
    }
    this.config = config;
  }

  /** Aynı indeks iki kez gelirse ilki korunur: tekrar sayarak başarı şişirilemez. */
  record(result: AttemptResult): void {
    if (!Number.isSafeInteger(result.index) || result.index < 0 || result.index >= this.config.attempts) {
      throw new Error("deneme indeksi koşu dışında");
    }
    if (this.results.has(result.index)) return;
    if (result.seconds < 0 || !Number.isFinite(result.seconds)) throw new Error("deneme süresi geçersiz");
    this.results.set(result.index, result);
    this.highest = Math.max(this.highest, result.index);
    const now = Date.now();
    this.startedAt ??= now;
    this.endedAt = now;
  }

  /**
   * Gönderici ilerlediyse aradaki denemeler hiç tamamlanmamıştır. Bunları
   * saymamak başarı oranını yapay olarak yükseltirdi.
   */
  failMissingBefore(index: number): void {
    for (let missing = this.highest + 1; missing < index && missing < this.config.attempts; missing++) {
      this.record({ index: missing, completed: false, corrupted: false, bytes: 0, seconds: 0 });
    }
  }

  get observed(): number { return this.results.size }

  get progress(): number { return this.results.size / this.config.attempts }

  summary(): MatrixSummary {
    if (this.results.size === 0) throw new Error("kayıtlı deneme yok");
    let successes = 0;
    let silentCorruptions = 0;
    let bytes = 0;
    let seconds = 0;
    for (const result of this.results.values()) {
      if (result.corrupted) silentCorruptions++;
      else if (result.completed) {
        successes++;
        bytes += result.bytes;
        seconds += result.seconds;
      }
    }
    const started = this.startedAt ?? Date.now();
    return {
      attempts: this.results.size,
      successes,
      silentCorruptions,
      meanGoodputKBs: seconds > 0 ? bytes / 1024 / seconds : 0,
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(Math.max(this.endedAt ?? started, started)).toISOString(),
    };
  }

  /** Kapıyı yerelde de gösterir; nihai karar yine `evaluateDeviceMatrix`'tedir. */
  gate(): { pass: boolean; reason: string } {
    const summary = this.summary();
    if (summary.attempts < MATRIX_GATE.minAttemptsPerPair) {
      return { pass: false, reason: `${summary.attempts}/${MATRIX_GATE.minAttemptsPerPair} deneme tamamlandı` };
    }
    if (summary.silentCorruptions > MATRIX_GATE.maxSilentCorruptions) {
      return { pass: false, reason: `${summary.silentCorruptions} sessiz bozulma görüldü` };
    }
    const rate = summary.successes / summary.attempts;
    if (rate < MATRIX_GATE.minSuccessRate) {
      return { pass: false, reason: `başarı %${(rate * 100).toFixed(2)}, eşik %99` };
    }
    return { pass: true, reason: `%${(rate * 100).toFixed(2)} başarı, sessiz bozulma yok` };
  }
}

export interface MatrixLabels {
  sender: string;
  receiver: string;
  browser: string;
  transport: string;
}

/** Ölçümü imzalar. İmzasız ölçüm, kanıt değil iddiadır. */
export async function issueMatrixEvidence(
  identity: PlatformSigningIdentity,
  recorder: MatrixRunRecorder,
  labels: MatrixLabels,
): Promise<QualificationEvidenceV2> {
  return issueQualificationEvidenceV2(identity, { ...labels, ...recorder.summary() });
}

/** `pnpm matrix:merge` ve `pnpm qualify --device-matrix=` bu belgeyi bekler. */
export function deviceMatrixDocument(runs: readonly QualificationEvidenceV2[]): {
  schema: "kionel-device-matrix/v2";
  runs: readonly QualificationEvidenceV2[];
} {
  return { schema: "kionel-device-matrix/v2", runs };
}
