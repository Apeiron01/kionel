/**
 * L5 — içerik zarfı. Çerçeve formatı (L2) sadece bayt taşır; dosya adının ve
 * bütünlük özetinin yeri burasıdır. Böylece yeni meta alanı eklemek protokol
 * sürümünü kırmaz.
 *
 * [0]     version = 1
 * [1]     nameLen (u8, utf8 bayt)
 * [2..5]  içerik CRC32
 * [6..]   ad (utf8) + veri
 *
 * CRC32 kazara bozulmayı yakalar, sahteciliği DEĞİL. Güvenli web akışında bu
 * zarf AES-GCM ile mühürlenir; SHA-256 + imza teslim makbuzunda taşınır.
 */
import { crc32 } from "./frame.ts";

export interface Envelope {
  name: string;
  data: Uint8Array;
}

export function pack({ name, data }: Envelope): Uint8Array {
  const nameBytes = new TextEncoder().encode(name).subarray(0, 255);
  const out = new Uint8Array(6 + nameBytes.length + data.length);
  out[0] = 1;
  out[1] = nameBytes.length;
  new DataView(out.buffer).setUint32(2, crc32(data));
  out.set(nameBytes, 6);
  out.set(data, 6 + nameBytes.length);
  return out;
}

export function unpack(bytes: Uint8Array): (Envelope & { intact: boolean }) | null {
  if (bytes.length < 6 || bytes[0] !== 1) return null;
  const nameLen = bytes[1];
  if (6 + nameLen > bytes.length) return null;
  const expected = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2);
  const data = bytes.subarray(6 + nameLen);
  return {
    name: new TextDecoder().decode(bytes.subarray(6, 6 + nameLen)),
    data,
    intact: crc32(data) === expected,
  };
}
