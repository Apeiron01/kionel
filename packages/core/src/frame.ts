/** Kionel çerçeve kodlaması — SPEC.md §2. Sıfır bağımlılık. */

export const FRAME_VERSION = 1;
export const HEADER_BYTES = 16;
export const TRAILER_BYTES = 4;
export const FRAME_OVERHEAD = HEADER_BYTES + TRAILER_BYTES;
export const MAX_PROTOCOL_BYTES = 1024 * 1024 * 1024; // SDK üst sınırı: 1 GiB

export const FrameType = {
  Data: 0x01,
  Ack: 0x10,
  Control: 0x11,
} as const;
export type FrameTypeValue = (typeof FrameType)[keyof typeof FrameType];

export interface Frame {
  type: FrameTypeValue;
  sessionId: number;
  seed: number;
  totalBytes: number;
  blockSize: number;
  payload: Uint8Array;
}

let table: Uint32Array | undefined;
export function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function encodeFrame(f: Frame): Uint8Array {
  if (!Object.values(FrameType).includes(f.type) || !Number.isInteger(f.sessionId) ||
      !Number.isInteger(f.seed) || !Number.isInteger(f.totalBytes) ||
      !Number.isInteger(f.blockSize) || f.sessionId < 0 || f.seed < 0 ||
      f.totalBytes <= 0 || f.totalBytes > MAX_PROTOCOL_BYTES ||
      f.blockSize <= 0 || f.blockSize > 0xffff ||
      (f.type === FrameType.Data && f.payload.length !== f.blockSize)) {
    throw new Error("geçersiz Kionel çerçevesi");
  }
  const out = new Uint8Array(FRAME_OVERHEAD + f.payload.length);
  const dv = new DataView(out.buffer);
  out[0] = FRAME_VERSION;
  out[1] = f.type;
  dv.setUint16(2, f.blockSize);
  dv.setUint32(4, f.sessionId);
  dv.setUint32(8, f.seed);
  dv.setUint32(12, f.totalBytes);
  out.set(f.payload, HEADER_BYTES);
  dv.setUint32(out.length - TRAILER_BYTES, crc32(out, 0, out.length - TRAILER_BYTES));
  return out;
}

/** Bozuk / yabancı / yanlış sürümlü çerçevede null döner — atılır, oturum bozulmaz. */
export function decodeFrame(bytes: Uint8Array): Frame | null {
  if (bytes.length < FRAME_OVERHEAD || bytes[0] !== FRAME_VERSION) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - TRAILER_BYTES;
  if (dv.getUint32(end) !== crc32(bytes, 0, end)) return null;
  const type = bytes[1] as FrameTypeValue;
  const blockSize = dv.getUint16(2);
  const totalBytes = dv.getUint32(12);
  if (!Object.values(FrameType).includes(type) || blockSize === 0 || totalBytes === 0 ||
      totalBytes > MAX_PROTOCOL_BYTES || (type === FrameType.Data && end - HEADER_BYTES !== blockSize)) return null;
  return {
    type,
    blockSize,
    sessionId: dv.getUint32(4),
    seed: dv.getUint32(8),
    totalBytes,
    payload: bytes.subarray(HEADER_BYTES, end),
  };
}
