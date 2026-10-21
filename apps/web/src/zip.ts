/**
 * Birden çok dosyayı tek aktarımda göndermek için ZIP (yalnız "stored").
 *
 * Sıkıştırma yok: aktarım zaten zarfı sıkıştırıyor, iki kez sıkıştırmak bir
 * şey kazandırmaz. ZIP seçildi çünkü alıcı tarafta Windows, macOS ve LIMS
 * içe aktarıcıları onu kurulum gerektirmeden açar. İçine her dosyanın
 * SHA-256'sını sha256sum biçiminde yazan bir manifest eklenir; imzalı kayıt
 * ZIP'in özetini taşıdığı için manifest de imzanın kapsamındadır.
 *
 * ponytail: ZIP64 yok — aktarım sınırı (64 MB) 4 GB'ın çok altında.
 */
import { crc32 } from "@kionel/core";

export const MANIFEST_NAME = "MANIFEST-SHA256.txt";

interface Entry { name: string; data: Uint8Array; modified: Date }

const utf8 = new TextEncoder();

/** MS-DOS tarih/saat: ZIP'in kendi biçimi (2 saniye çözünürlük, 1980'den itibaren). */
function dosTime(at: Date): [number, number] {
  const year = Math.max(1980, at.getFullYear());
  return [
    (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  ];
}

export function buildZip(entries: Entry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const crc = crc32(entry.data) >>> 0;
    const [time, date] = dosTime(entry.modified);
    const local = new Uint8Array(30 + name.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);          // gereken sürüm 2.0
    l.setUint16(6, 0x0800, true);      // bit 11: ad UTF-8
    l.setUint16(8, 0, true);           // stored
    l.setUint16(10, time, true);
    l.setUint16(12, date, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, entry.data.length, true);
    l.setUint32(22, entry.data.length, true);
    l.setUint16(26, name.length, true);
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, time, true);
    c.setUint16(14, date, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, entry.data.length, true);
    c.setUint32(24, entry.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.set(name, 46);

    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + entry.data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, entries.length, true);
  e.setUint16(10, entries.length, true);
  e.setUint32(12, centralSize, true);
  e.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, at); at += part.length; }
  return out;
}

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

/** Dosyalar + manifest; aynı ad iki kez gelirse ikincisi "ad (2)" olur. */
export async function bundleFiles(files: { name: string; data: Uint8Array; modified: Date }[]): Promise<Uint8Array> {
  const used = new Set<string>([MANIFEST_NAME.toLowerCase()]);
  const entries: Entry[] = [];
  const lines: string[] = [];
  for (const file of files) {
    let name = file.name.replace(/[\\/]/g, "_") || "file";
    const dot = name.lastIndexOf(".");
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      name = dot > 0 ? `${file.name.slice(0, dot)} (${n})${file.name.slice(dot)}` : `${file.name} (${n})`;
    }
    used.add(name.toLowerCase());
    entries.push({ name, data: file.data, modified: file.modified });
    lines.push(`${hex(await crypto.subtle.digest("SHA-256", file.data as BufferSource))}  ${name}`);
  }
  entries.push({ name: MANIFEST_NAME, data: utf8.encode(`${lines.join("\n")}\n`), modified: new Date() });
  return buildZip(entries);
}
