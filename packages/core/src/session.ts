/** L3 — yetenek müzakeresi, ACK kodlaması, akış kontrolü ve oturum durumu. */
import type { Range } from "./fountain.ts";

export interface SessionCapabilities {
  v: 1;
  transports: string[];
  maxFrameBytes: number;
  maxFps: number;
  duplex: boolean;
  arq: boolean;
  resume: boolean;
}

export interface NegotiatedCapabilities {
  transport: string;
  frameBytes: number;
  fps: number;
  duplex: boolean;
  arq: boolean;
  resume: boolean;
  /** Karşı taraf okunamadığında neden simplex'e düşüldüğünü görünür kılar. */
  fallback: boolean;
}

/** Kontrol karesinde taşınan kompakt yetenek kaydı. */
export function encodeCapabilities(capabilities: SessionCapabilities): Uint8Array {
  validateCapabilities(capabilities);
  const names = capabilities.transports.map((name) => new TextEncoder().encode(name));
  if (names.length > 255 || names.some((name) => name.length === 0 || name.length > 255)) {
    throw new Error("taşıma sürücüsü adı kapasiteyi aşıyor");
  }
  const out = new Uint8Array(7 + names.reduce((n, name) => n + 1 + name.length, 0));
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = (capabilities.duplex ? 1 : 0) | (capabilities.arq ? 2 : 0) | (capabilities.resume ? 4 : 0);
  view.setUint16(2, capabilities.maxFrameBytes);
  view.setUint16(4, capabilities.maxFps);
  out[6] = names.length;
  let at = 7;
  for (const name of names) {
    out[at++] = name.length;
    out.set(name, at);
    at += name.length;
  }
  return out;
}

export function decodeCapabilities(payload: Uint8Array): SessionCapabilities | null {
  if (payload.length < 7 || payload[0] !== 1 || (payload[1] & ~7) !== 0) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const transports: string[] = [];
  let at = 7;
  try {
    for (let i = 0; i < payload[6]; i++) {
      const length = payload[at++];
      if (!length || at + length > payload.length) return null;
      transports.push(new TextDecoder("utf-8", { fatal: true }).decode(payload.subarray(at, at + length)));
      at += length;
    }
  } catch {
    return null;
  }
  if (at !== payload.length) return null;
  const result: SessionCapabilities = {
    v: 1,
    transports,
    maxFrameBytes: view.getUint16(2),
    maxFps: view.getUint16(4),
    duplex: (payload[1] & 1) !== 0,
    arq: (payload[1] & 2) !== 0,
    resume: (payload[1] & 4) !== 0,
  };
  try {
    validateCapabilities(result);
    return result;
  } catch {
    return null;
  }
}

export const ControlKind = { Offer: 1, Reply: 2 } as const;
export type ControlKindValue = (typeof ControlKind)[keyof typeof ControlKind];

export interface HandshakeControl {
  kind: ControlKindValue;
  record: Uint8Array;
  capabilities: SessionCapabilities;
}

/** Kripto kaydını L3 yetenekleriyle tek QR kontrol mesajında birleştirir. */
export function encodeHandshakeControl(message: HandshakeControl): Uint8Array {
  const capabilities = encodeCapabilities(message.capabilities);
  if (message.record.length > 0xffff || capabilities.length > 0xffff) throw new Error("kontrol mesajı kapasiteyi aşıyor");
  const out = new Uint8Array(6 + message.record.length + capabilities.length);
  const view = new DataView(out.buffer);
  out[0] = 1;
  out[1] = message.kind;
  view.setUint16(2, message.record.length);
  view.setUint16(4, capabilities.length);
  out.set(message.record, 6);
  out.set(capabilities, 6 + message.record.length);
  return out;
}

export function decodeHandshakeControl(payload: Uint8Array): HandshakeControl | null {
  if (payload.length < 6 || payload[0] !== 1 || (payload[1] !== ControlKind.Offer && payload[1] !== ControlKind.Reply)) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const recordLength = view.getUint16(2);
  const capabilityLength = view.getUint16(4);
  if (6 + recordLength + capabilityLength !== payload.length) return null;
  const capabilities = decodeCapabilities(payload.subarray(6 + recordLength));
  if (!capabilities) return null;
  return {
    kind: payload[1] as ControlKindValue,
    record: payload.slice(6, 6 + recordLength),
    capabilities,
  };
}

/** Karşı taraf yoksa sessizce simplex/fountain moduna düşer. */
export function negotiateCapabilities(
  local: SessionCapabilities,
  remote?: SessionCapabilities,
): NegotiatedCapabilities {
  validateCapabilities(local);
  if (!remote) {
    return {
      transport: local.transports[0],
      frameBytes: local.maxFrameBytes,
      fps: local.maxFps,
      duplex: false,
      arq: false,
      resume: false,
      fallback: true,
    };
  }
  validateCapabilities(remote);
  const transport = local.transports.find((id) => remote.transports.includes(id));
  if (!transport) throw new Error("ortak taşıma sürücüsü yok");
  const duplex = local.duplex && remote.duplex;
  return {
    transport,
    frameBytes: Math.min(local.maxFrameBytes, remote.maxFrameBytes),
    fps: Math.min(local.maxFps, remote.maxFps),
    duplex,
    arq: duplex && local.arq && remote.arq,
    resume: duplex && local.resume && remote.resume,
    fallback: !duplex,
  };
}

function validateCapabilities(value: SessionCapabilities): void {
  if (value.v !== 1 || !value.transports.length || !Number.isInteger(value.maxFrameBytes) ||
      !Number.isInteger(value.maxFps) || value.maxFrameBytes <= 0 || value.maxFrameBytes > 0xffff ||
      value.maxFps <= 0 || value.maxFps > 0xffff) {
    throw new Error("geçersiz oturum yetenekleri");
  }
}

// ACK payload: ver(1), flags(1), rangeCount(2), sequence(4), received(4),
// total(4), decodeMicros(4), ardından her aralık için start(4), endExclusive(4).
const ACK_HEADER_BYTES = 20;
const ACK_VERSION = 1;
const COMPLETE = 1;

export interface AckMessage {
  sequence: number;
  receivedBlocks: number;
  totalBlocks: number;
  decodeMicros: number;
  missing: Range[];
  complete: boolean;
}

export function encodeAck(ack: AckMessage): Uint8Array {
  if (ack.missing.length > 0xffff) throw new Error("ACK aralık sayısı kapasiteyi aşıyor");
  validateRanges(ack.missing, ack.totalBlocks);
  const out = new Uint8Array(ACK_HEADER_BYTES + ack.missing.length * 8);
  const view = new DataView(out.buffer);
  out[0] = ACK_VERSION;
  out[1] = ack.complete ? COMPLETE : 0;
  view.setUint16(2, ack.missing.length);
  view.setUint32(4, ack.sequence);
  view.setUint32(8, ack.receivedBlocks);
  view.setUint32(12, ack.totalBlocks);
  view.setUint32(16, ack.decodeMicros);
  for (let i = 0; i < ack.missing.length; i++) {
    view.setUint32(ACK_HEADER_BYTES + i * 8, ack.missing[i].start);
    view.setUint32(ACK_HEADER_BYTES + i * 8 + 4, ack.missing[i].end);
  }
  return out;
}

export function decodeAck(payload: Uint8Array): AckMessage | null {
  if (payload.length < ACK_HEADER_BYTES || payload[0] !== ACK_VERSION || (payload[1] & ~COMPLETE) !== 0) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const count = view.getUint16(2);
  if (payload.length !== ACK_HEADER_BYTES + count * 8) return null;
  const totalBlocks = view.getUint32(12);
  const missing: Range[] = [];
  for (let i = 0; i < count; i++) {
    missing.push({
      start: view.getUint32(ACK_HEADER_BYTES + i * 8),
      end: view.getUint32(ACK_HEADER_BYTES + i * 8 + 4),
    });
  }
  try {
    validateRanges(missing, totalBlocks);
  } catch {
    return null;
  }
  return {
    sequence: view.getUint32(4),
    receivedBlocks: view.getUint32(8),
    totalBlocks,
    decodeMicros: view.getUint32(16),
    missing,
    complete: (payload[1] & COMPLETE) !== 0,
  };
}

function validateRanges(ranges: Range[], totalBlocks: number): void {
  let previousEnd = 0;
  for (const range of ranges) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) ||
        range.start < previousEnd || range.start < 0 || range.end <= range.start || range.end > totalBlocks) {
      throw new Error("ACK eksik blok aralıkları geçersiz");
    }
    previousEnd = range.end;
  }
}

export interface FlowSample {
  sent: number;
  received: number;
  /** Alıcının bir kareyi çözme süresi. */
  decodeMs: number;
}

/** ACK örneklerine göre ekran kare hızını küçük adımlarla uyarlar. */
export class AdaptiveFlowController {
  readonly minFps: number;
  readonly maxFps: number;
  private healthySamples = 0;
  private value: number;

  constructor(initialFps: number, minFps = 5, maxFps = 60) {
    if (minFps <= 0 || initialFps < minFps || maxFps < initialFps) throw new Error("geçersiz FPS sınırları");
    this.value = initialFps;
    this.minFps = minFps;
    this.maxFps = maxFps;
  }

  get fps(): number {
    return this.value;
  }

  observe(sample: FlowSample): number {
    const loss = sample.sent > 0 ? 1 - sample.received / sample.sent : 0;
    const overloaded = sample.decodeMs > 1000 / this.value;
    if (loss > 0.2 || overloaded) {
      this.value = Math.max(this.minFps, Math.floor(this.value * 0.8));
      this.healthySamples = 0;
    } else if (loss < 0.05 && sample.decodeMs < 700 / this.value) {
      if (++this.healthySamples >= 3) {
        this.value = Math.min(this.maxFps, Math.ceil(this.value * 1.1));
        this.healthySamples = 0;
      }
    } else {
      this.healthySamples = 0;
    }
    return this.value;
  }
}

export const SessionState = {
  Discovery: "discovery",
  Negotiation: "negotiation",
  Transfer: "transfer",
  Interrupted: "interrupted",
  Verification: "verification",
  Complete: "complete",
  Failed: "failed",
} as const;
export type SessionStateValue = (typeof SessionState)[keyof typeof SessionState];

const NEXT: Record<SessionStateValue, SessionStateValue[]> = {
  discovery: ["negotiation", "failed"],
  negotiation: ["transfer", "failed"],
  transfer: ["interrupted", "verification", "failed"],
  interrupted: ["transfer", "failed"],
  verification: ["complete", "failed"],
  complete: [],
  failed: [],
};

export class SessionStateMachine {
  private current: SessionStateValue = SessionState.Discovery;
  get state(): SessionStateValue { return this.current; }

  transition(next: SessionStateValue): void {
    if (!NEXT[this.current].includes(next)) throw new Error(`geçersiz oturum geçişi: ${this.current} -> ${next}`);
    this.current = next;
  }
}
