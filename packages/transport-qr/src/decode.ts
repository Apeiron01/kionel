import { readBarcodes } from "zxing-wasm/reader";

export interface Box { x: number; y: number; w: number; h: number }

/** Kodlar ve görüntüdeki kapladıkları dikdörtgen: canlı okumada sonraki kare yalnız o bölgeden okunur. */
export async function decodeFramesWithBoxes(image: ImageData, max = 4): Promise<{ bytes: Uint8Array; box: Box }[]> {
  if (!Number.isInteger(max) || max < 1 || max > 9) throw new Error("qr-v1: kod sayısı 1–9 olmalı");
  const results = await readBarcodes(image, {
    formats: ["QRCode"], tryHarder: max > 1, tryRotate: false,
    tryInvert: false, tryDownscale: false, maxNumberOfSymbols: max,
  });
  return results.filter((r) => r.bytes?.length).map((r) => {
    const p = r.position;
    const xs = [p.topLeft.x, p.topRight.x, p.bottomLeft.x, p.bottomRight.x];
    const ys = [p.topLeft.y, p.topRight.y, p.bottomLeft.y, p.bottomRight.y];
    const x = Math.min(...xs), y = Math.min(...ys);
    return { bytes: r.bytes, box: { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y } };
  });
}

/**
 * Sonraki karede okunacak bölge: bulunan kodların birleşimi, her yandan boyutunun
 * yarısı kadar pay bırakılarak (el titremesi ve kaymaya yer), görüntüye kırpılmış.
 * Bölge karenin büyük kısmını kaplıyorsa kırpmanın kazancı yoktur: undefined.
 */
export function focusRegion(boxes: Box[], width: number, height: number): Box | undefined {
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const padX = (x1 - x0) / 2, padY = (y1 - y0) / 2;
  const x = Math.max(0, Math.floor(x0 - padX)), y = Math.max(0, Math.floor(y0 - padY));
  const w = Math.min(width, Math.ceil(x1 + padX)) - x, h = Math.min(height, Math.ceil(y1 + padY)) - y;
  return w * h > width * height * 0.7 ? undefined : { x, y, w, h };
}

/** Shared by the browser and the synthetic benchmark; WASM is configured by the caller. */
export async function decodeFrames(image: ImageData, max = 4): Promise<Uint8Array[]> {
  if (!Number.isInteger(max) || max < 1 || max > 9) throw new Error("qr-v1: kod sayısı 1–9 olmalı");
  const results = await readBarcodes(image, {
    // Fast row sampling can skip entire rows of a dense 3x3 grid (v40: 3/9
    // recovered even from pristine bitmaps). Exhaustive scanning trades CPU
    // for coverage in multi-symbol mode; the benchmark reports that cost.
    formats: ["QRCode"], tryHarder: max > 1, tryRotate: false,
    tryInvert: false, tryDownscale: false, maxNumberOfSymbols: max,
  });
  return results.map(result => result.bytes).filter((bytes): bytes is Uint8Array => !!bytes?.length);
}

export async function decodeFrame(image: ImageData): Promise<Uint8Array | null> {
  return (await decodeFrames(image, 1))[0] ?? null;
}
