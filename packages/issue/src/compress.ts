// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Aktarım öncesi sıkıştırma.
 *
 * Optik kanal saniyede kilobaytlarla ölçülür; gönderilmeyen her bayt kazanılmış
 * süredir. Laboratuvar sonuçlarının çoğu CSV ve metindir ve 5–10 kat küçülür.
 * PDF, görüntü ve arşiv zaten sıkıştırılmıştır: o durumda ham gönderilir, çünkü
 * sıkıştırmanın büyüttüğü dosyayı göndermek süreyi uzatır.
 *
 * Şifrelemeden ÖNCE sıkıştırılır (şifreli veri sıkışmaz). Saldırganın içeriğe
 * kendi baytlarını karıştırabildiği bir senaryo yok; CRIME türü sızıntı burada
 * uygulanmaz.
 *
 * Biçim: [bayrak][gövde]. Bayrak değerleri eski zarfın ilk baytından (1)
 * ayrıdır, böylece alıcı eski sürümden gelen akışı da tanır.
 */
const RAW = 0xc0;
const DEFLATE = 0xc1;

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream, limit: number): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(transform).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    // Sıkıştırma bombası: açılan boyut sınırı aşarsa okumayı keser.
    if (total > limit) {
      await reader.cancel();
      throw new Error("the transferred content is larger than this device accepts");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/** Sıkıştırır; küçültmüyorsa ham bırakır. */
export async function shrink(bytes: Uint8Array): Promise<Uint8Array> {
  const packed = await pipe(bytes, new CompressionStream("deflate-raw"), Number.MAX_SAFE_INTEGER);
  const useful = packed.length < bytes.length;
  const body = useful ? packed : bytes;
  const out = new Uint8Array(body.length + 1);
  out[0] = useful ? DEFLATE : RAW;
  out.set(body, 1);
  return out;
}

/** `shrink` çıktısını açar; açılan boyut `limit`i aşarsa reddeder. */
export async function expand(bytes: Uint8Array, limit: number): Promise<Uint8Array> {
  if (bytes[0] === RAW) {
    if (bytes.length - 1 > limit) throw new Error("the transferred content is larger than this device accepts");
    return bytes.subarray(1);
  }
  if (bytes[0] === DEFLATE) return pipe(bytes.subarray(1), new DecompressionStream("deflate-raw"), limit);
  throw new Error("the sender runs a different version of Kionel — reload the page on both devices");
}

/** Eski (sıkıştırmasız) zarf mı? Eski sürümden gelen çift yönlü akış için. */
export const isShrunk = (bytes: Uint8Array): boolean => bytes[0] === RAW || bytes[0] === DEFLATE;
