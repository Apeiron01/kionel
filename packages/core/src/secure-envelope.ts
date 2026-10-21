/**
 * L5 güvenli aktarım zarfı.
 *
 * Kripto katmanını core'a bağımlı kılmadan, imzalı sevk kaydı gibi açık
 * metaveriyi AES-GCM ile kapatılmış içerikle aynı fountain akışında taşır.
 *
 * [0]      version = 1
 * [1..4]   metadata length (u32, big endian)
 * [5..]    UTF-8 metadata + sealed payload
 */

const VERSION = 1;
const HEADER_BYTES = 5;
export const MAX_SECURE_METADATA_BYTES = 64 * 1024;

export interface SecureEnvelope {
  metadata: string;
  sealed: Uint8Array;
}

export function packSecureEnvelope({ metadata, sealed }: SecureEnvelope): Uint8Array {
  const meta = new TextEncoder().encode(metadata);
  if (meta.length > MAX_SECURE_METADATA_BYTES) throw new Error("güvenli zarf metaverisi sınırı aşıldı");
  const out = new Uint8Array(HEADER_BYTES + meta.length + sealed.length);
  out[0] = VERSION;
  new DataView(out.buffer).setUint32(1, meta.length);
  out.set(meta, HEADER_BYTES);
  out.set(sealed, HEADER_BYTES + meta.length);
  return out;
}

export function unpackSecureEnvelope(bytes: Uint8Array): SecureEnvelope | null {
  if (bytes.length < HEADER_BYTES || bytes[0] !== VERSION) return null;
  const metaLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
  const payloadAt = HEADER_BYTES + metaLength;
  if (metaLength > MAX_SECURE_METADATA_BYTES || payloadAt > bytes.length) return null;
  try {
    return {
      metadata: new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(HEADER_BYTES, payloadAt)),
      sealed: bytes.subarray(payloadAt),
    };
  } catch {
    return null;
  }
}
