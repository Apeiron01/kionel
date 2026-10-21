/**
 * Sevk kaydını tek bir QR karesi olarak PNG'ye yazar.
 *
 * Node'da canvas yok, o yüzden bitmap elle sıkıştırılıp PNG olarak kuruluyor.
 * Bir kütüphane eklemek yerine ~40 satır yazmak, çevrimdışı çalışması gereken
 * bir kanıt aracına yeni bir bağımlılık sokmamak demek.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
// Paket kökü tarayıcı çözücüsünü (ve onun wasm'ini) çekiyor; bu araç yalnız
// çiziyor, okumuyor. Doğrudan kodlayıcıyı almak CLI'yı Node'da çalışır tutuyor.
import { toBitmap } from "@kionel/transport-qr/encode";

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** QR sürümü otomatik seçilir: kayıt neyse ona sığan en küçük sürüm. */
export function drawFrameToPng(bytes: Uint8Array, path: string, scale = 8): void {
  // Kayda sığan en küçük sürüm: büyük sürüm gereksiz yere yoğun bir kare üretir
  // ve okunmasını zorlaştırır.
  let bitmap: ReturnType<typeof toBitmap> | undefined;
  for (const version of [10, 15, 20, 25, 27, 30, 35, 40]) {
    try {
      bitmap = toBitmap(bytes, { version, quietZone: 4 }, scale);
      break;
    } catch {
      // bu sürüme sığmadı, bir büyüğünü dene
    }
  }
  if (!bitmap) throw new Error("sevk kaydı tek bir QR karesine sığmıyor");
  const { width, height, data } = bitmap;

  // PNG scanline: her satırın başında filtre baytı (0 = filtresiz).
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let at = 0;
  for (let y = 0; y < height; y++) {
    raw[at++] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[at++] = data[i];
      raw[at++] = data[i + 1];
      raw[at++] = data[i + 2];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;  // bit derinliği
  header[9] = 2;  // renk tipi: truecolor
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array()),
  ]));
}
