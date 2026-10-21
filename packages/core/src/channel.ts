/**
 * Sentetik kanal simülatörü — kamera olmadan CI'da koşar.
 * Bir ekran→kamera bağını "kare üretilir, bir kısmı okunamaz" seviyesinde modeller.
 * Optik detay (bulanıklık, açı, parlama) burada TEK bir sonuca indirgenir:
 * çerçeve ya okunur ya okunmaz. Gerçek optik ölçüm Faz 1'de kamerayla yapılacak.
 */
import { FrameType, FRAME_OVERHEAD, decodeFrame, encodeFrame } from "./frame.ts";
import {
  LtDecoder,
  ltEncode,
  mulberry32,
  blockCount,
  systematicEncode,
  type Range,
} from "./fountain.ts";
import { decodeAck, encodeAck } from "./session.ts";

export interface TransportProfile {
  id: string;
  /** Bir çerçevenin taşıdığı ham bayt (başlık dahil). */
  frameBytes: number;
  /** Saniyede gösterilip okunabilen çerçeve. */
  fps: number;
}

/**
 * frameBytes = QR sürüm/ECC-L veri sayfası kapasitesi (kesin).
 * fps = ekranın çerçeve başına 2 tazeleme döngüsü ayırdığı varsayımı:
 *   60 Hz -> 30 fps, 120 Hz (ProMotion) -> 60 fps.
 * Kaynak: benzer açık projelerin bildirdiği çalışma noktaları (v27-L @ 24 fps).
 * ponytail: bunlar HÂLÂ tahmindir — gerçek sınır kameranın yakalama hızı ve
 * çözme süresidir, ikisi de cihaza bağlı. apps/web canlı ölçümü basar;
 * o rakam geldiğinde burası güncellenir. Kalibrasyon kolu burasıdır.
 */
export const PROFILES: Record<string, TransportProfile> = {
  "qr-v15-L-30": { id: "qr-v15-L-30", frameBytes: 520, fps: 30 },
  "qr-v27-L-24": { id: "qr-v27-L-24", frameBytes: 1465, fps: 24 },
  "qr-v27-L-30": { id: "qr-v27-L-30", frameBytes: 1465, fps: 30 },
  "qr-v40-L-30": { id: "qr-v40-L-30", frameBytes: 2953, fps: 30 },
  "qr-v40-L-60": { id: "qr-v40-L-60", frameBytes: 2953, fps: 60 },
};

export interface ChannelParams {
  /** Kamera karesi hiç yakalanamadı (odak, titreme, kadraj dışı). */
  lossRate: number;
  /** Yakalandı ama bozuk çözüldü → CRC yakalar, çerçeve atılır. */
  corruptRate?: number;
  seed?: number;
}

export interface RunResult {
  ok: boolean;
  k: number;
  framesSent: number;
  framesDelivered: number;
  /** Alıcıya ulaşan / gerçekten gereken. 1.00 = teorik alt sınır. */
  overhead: number;
  seconds: number;
  goodputKBs: number;
}

export interface DuplexChannelParams extends ChannelParams {
  /** Alıcı ekranındaki ACK karesi okunamadı. */
  ackLossRate?: number;
  /** Bu kadar veri karesinden sonra decoder checkpoint'ten yeniden kurulur. */
  interruptAfterFrames?: number;
  resumeDelaySeconds?: number;
}

export interface DuplexRunResult extends RunResult {
  feedbackFrames: number;
  rounds: number;
  resumed: boolean;
}

/** Tek yönlü aktarımı uçtan uca koşturur: encode → kanal → decode → doğrula. */
export function simulate(
  data: Uint8Array,
  profile: TransportProfile,
  params: ChannelParams,
  maxFrames = 100_000,
): RunResult {
  const blockSize = profile.frameBytes - FRAME_OVERHEAD;
  const rng = mulberry32(params.seed ?? 1);
  const decoder = new LtDecoder(data.length, blockSize);
  const corrupt = params.corruptRate ?? 0;

  let sent = 0;
  let delivered = 0;
  for (const { seed, payload } of ltEncode(data, blockSize)) {
    if (++sent > maxFrames) break;
    const wire = encodeFrame({
      type: FrameType.Data,
      sessionId: 1,
      seed,
      totalBytes: data.length,
      blockSize,
      payload,
    });
    if (rng() < params.lossRate) continue;
    if (rng() < corrupt) wire[FRAME_OVERHEAD + (Math.floor(rng() * payload.length) | 0)] ^= 0xff;
    const frame = decodeFrame(wire);
    if (!frame) continue; // CRC reddi — bozuk kare sessizce düşer
    delivered++;
    decoder.ingest(frame.seed, frame.payload);
    if (decoder.done) break;
  }

  const out = decoder.result();
  const seconds = sent / profile.fps;
  return {
    ok: out !== null && eq(out, data),
    k: blockCount(data.length, blockSize),
    framesSent: sent,
    framesDelivered: delivered,
    overhead: delivered / decoder.k,
    seconds,
    goodputKBs: out ? data.length / 1024 / seconds : 0,
  };
}

/**
 * Zaman bölmeli duplex ARQ: ilk turda sistematik bloklar, sonraki turlarda ACK'in
 * bildirdiği eksikler gönderilir. ACK kaybı yalnızca bir geri-kanal turuna mal olur.
 */
export function simulateDuplex(
  data: Uint8Array,
  profile: TransportProfile,
  params: DuplexChannelParams,
  maxFrames = 100_000,
): DuplexRunResult {
  const blockSize = profile.frameBytes - FRAME_OVERHEAD;
  const rng = mulberry32(params.seed ?? 1);
  const corrupt = params.corruptRate ?? 0;
  const ackLoss = params.ackLossRate ?? params.lossRate;
  let decoder = new LtDecoder(data.length, blockSize);
  let sent = 0;
  let delivered = 0;
  let feedbackFrames = 0;
  let rounds = 0;
  let resumed = false;

  const transmit = (ranges: Range[]) => {
    for (const { seed, payload } of systematicEncode(data, blockSize, ranges)) {
      if (++sent > maxFrames) return;
      const wire = encodeFrame({
        type: FrameType.Data,
        sessionId: 1,
        seed,
        totalBytes: data.length,
        blockSize,
        payload,
      });
      if (rng() >= params.lossRate) {
        if (rng() < corrupt) wire[FRAME_OVERHEAD + (Math.floor(rng() * payload.length) | 0)] ^= 0xff;
        const frame = decodeFrame(wire);
        if (frame) {
          delivered++;
          decoder.ingest(frame.seed, frame.payload);
        }
      }
      if (!resumed && params.interruptAfterFrames !== undefined && sent >= params.interruptAfterFrames) {
        decoder = LtDecoder.fromCheckpoint(decoder.checkpoint());
        resumed = true;
      }
    }
  };

  transmit([{ start: 0, end: decoder.k }]);
  while (!decoder.done && sent < maxFrames && rounds++ < 10_000) {
    feedbackFrames++;
    const payload = encodeAck({
      sequence: rounds,
      receivedBlocks: decoder.k - decoder.missingRanges().reduce((n, r) => n + r.end - r.start, 0),
      totalBlocks: decoder.k,
      decodeMicros: 0,
      missing: decoder.missingRanges(),
      complete: false,
    });
    if (rng() < ackLoss) continue;
    const ack = decodeAck(payload);
    if (ack) transmit(ack.missing);
  }
  feedbackFrames++; // tamamlandı ACK'i

  const out = decoder.result();
  const seconds = (sent + feedbackFrames) / profile.fps + (resumed ? params.resumeDelaySeconds ?? 0 : 0);
  return {
    ok: out !== null && eq(out, data),
    k: blockCount(data.length, blockSize),
    framesSent: sent,
    framesDelivered: delivered,
    feedbackFrames,
    rounds,
    resumed,
    overhead: delivered / decoder.k,
    seconds,
    goodputKBs: out ? data.length / 1024 / seconds : 0,
  };
}

function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
