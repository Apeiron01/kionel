/**
 * Kâğıda basılan aktarım: şifreli dosya QR kodlu sayfalara basılır, sayfalar
 * sonra bir kamerayla (canlı, fotoğraf ya da tarama) herhangi bir sırayla okunur.
 * Yazıcısı olan ama ağı, USB'si ve kamerası olmayan cihaz bilgisayarları için;
 * aynı zamanda yıllar sonra geri okunacak kâğıt yedek.
 *
 * Kodlar fountain bloklarıdır: önce dosyanın tamamı, ardından %30 (en az iki
 * kod) yedek. Yedekler sıradan LT tohumları değil, blokların en az üçte birini
 * kapsayan seçilmiş tohumlardır: kâğıtta hangi kodun kaybolacağı bilinmez ve
 * düşük dereceli bir yedek çoğu zaman kaybolan bloğu hiç içermez. Alıcı onları
 * olağan LT karesi olarak okur; takıldığında çözücü kalanı Gauss eliminasyonuyla
 * çözer (fountain.ts). Lekelenen, yırtılan ya da taranmayan birkaç kod dosyayı kaybettirmez.
 * Saf fonksiyonlar, birim testli.
 */
import { encodeFrame, FRAME_OVERHEAD, FrameType, LtParams, systematicEncode } from "@kionel/core";
import { frameBytes } from "@kionel/transport-qr";

export type Density = "standard" | "dense";
/** Standart: 6,4 cm'lik kodlar, lazer ve mürekkep yazıcıda rahat okunur. Yoğun: 4,8 cm, iyi bir lazer yazıcı ister. A4 ve Letter'a sığar (report.css). */
export const DENSITY: Record<Density, { version: number; columns: number; rows: number }> = {
  standard: { version: 20, columns: 2, rows: 3 },
  dense: { version: 25, columns: 3, rows: 4 },
};
export const MAX_PAGES = 60;
/** Kişisel (ücretsiz) sürüm bu kadar sayfa basar ve okur; üstü işletme lisansıyla. */
export const FREE_PAPER_PAGES = 5;
const SPARE = 0.3;

export interface PaperPlan { version: number; columns: number; rows: number; blockSize: number; blocks: number; codes: number; pages: number }

export function paperPlan(bytes: number, density: Density): PaperPlan {
  const { version, columns, rows } = DENSITY[density];
  const blockSize = frameBytes(version) - FRAME_OVERHEAD;
  const blocks = Math.ceil(bytes / blockSize);
  const codes = blocks + Math.max(2, Math.ceil(blocks * SPARE));
  return { version, columns, rows, blockSize, blocks, codes, pages: Math.ceil(codes / (columns * rows)) };
}

/**
 * Okuyan taraf için: bir çerçevenin blok boyutu kâğıt yoğunluklarından birine uyuyorsa
 * aktarımın kaç sayfa tuttuğu. Uymuyorsa (ekrandan gelen akış) undefined.
 */
export function pagesFor(totalBytes: number, blockSize: number): number | undefined {
  const density = (Object.keys(DENSITY) as Density[]).find((d) => paperPlan(1, d).blockSize === blockSize);
  return density ? paperPlan(totalBytes, density).pages : undefined;
}

/** Blokların en az üçte birini kapsayan ilk `count` LT tohumu. */
export function denseSeeds(k: number, count: number): number[] {
  const params = new LtParams(k);
  const least = Math.min(k, Math.max(2, Math.floor(k / 3)));
  const seeds: number[] = [];
  // ponytail: doğrusal arama; 60 sayfada (k≈550) birkaç yüz bin tohum, tarayıcıda bir saniyenin altında.
  for (let seed = 1; seeds.length < count; seed++) if (params.neighbors(seed).length >= least) seeds.push(seed);
  return seeds;
}

/** Basılacak çerçeveler, sayfa sırasıyla. Son sayfanın boş kalan yerleri de yedek kodla doldurulur. */
export function paperFrames(wire: Uint8Array, density: Density, sessionId: number): Uint8Array[] {
  const plan = paperPlan(wire.length, density);
  const total = plan.pages * plan.columns * plan.rows;
  const frame = (seed: number, payload: Uint8Array) =>
    encodeFrame({ type: FrameType.Data, sessionId, seed, totalBytes: wire.length, blockSize: plan.blockSize, payload });
  const frames = [...systematicEncode(wire, plan.blockSize)].map(({ seed, payload }) => frame(seed, payload));
  const params = new LtParams(plan.blocks);
  for (const seed of denseSeeds(plan.blocks, total - frames.length)) {
    const payload = new Uint8Array(plan.blockSize);
    for (const index of params.neighbors(seed)) {
      const block = wire.subarray(index * plan.blockSize, (index + 1) * plan.blockSize);
      for (let i = 0; i < block.length; i++) payload[i] ^= block[i];
    }
    frames.push(frame(seed, payload));
  }
  return frames;
}
