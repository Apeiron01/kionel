/**
 * L1 — qr-v1 taşıma sürücüsü.
 *
 * Üst katmanlar (L2 fountain, L3 kanal) bu dosyanın varlığından habersizdir;
 * buradan dışarı yalnızca "bayt ver -> kare çiz" ve "kare ver -> bayt al"
 * sözleşmesi çıkar. Renkli ızgara sürücüsü aynı sözleşmeyi uygular.
 */
import { prepareZXingModule } from "zxing-wasm/reader";
import { decodeFrame } from "./decode.ts";
export { decodeFrame, decodeFrames, decodeFramesWithBoxes, focusRegion, type Box } from "./decode.ts";
import type { TransportDriver } from "@kionel/core";
// wasm CDN'den DEĞİL paketten yüklenir — çevrimdışı çalışmak zorunda.
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { frameBytes, toBitmap, toTiledBitmap, type QrOptions } from "./encode.ts";

export * from "./encode.ts";
export * from "./estimate.ts";
export const id = "qr-v1";

prepareZXingModule({ overrides: { locateFile: () => wasmUrl } });

/**
 * Baytları canvas'a çizer. Modül matrisi küçük bir bitmap'e yazılıp
 * ölçeklenerek kopyalanır — kare başına on binlerce fillRect'ten çok daha
 * hızlıdır ve 30 fps'te tek maliyet kalemi budur.
 */
export function drawFrame(canvas: HTMLCanvasElement, bytes: Uint8Array, opts: QrOptions): void {
  const bmp = toBitmap(bytes, opts);
  const scratch = getScratch(bmp.width, bmp.height);
  scratch.getContext("2d")!.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0);

  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = false; // modül kenarları keskin kalmalı
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.floor(Math.min(canvas.width, canvas.height) / bmp.width) || 1;
  const side = scale * bmp.width;
  ctx.drawImage(scratch, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side);
}

/**
 * Birden fazla kareyi tek ekrana çizer — büyük ekran profili.
 *
 * `drawFrame` ile aynı yolu kullanır, yalnız bitmap döşenmiş gelir. Ekran ne
 * kadar büyükse o kadar çok kod sığar; kamera hepsini tek karede okuduğunda
 * verim kod sayısıyla çarpılır.
 */
export function drawFrames(canvas: HTMLCanvasElement, frames: readonly Uint8Array[], opts: QrOptions): void {
  const bmp = toTiledBitmap(frames, opts);
  const scratch = getScratch(bmp.width, bmp.height);
  scratch.getContext("2d")!.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0);

  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.floor(Math.min(canvas.width / bmp.width, canvas.height / bmp.height)) || 1;
  const width = scale * bmp.width;
  const height = scale * bmp.height;
  ctx.drawImage(scratch, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
}

let scratchCanvas: HTMLCanvasElement | undefined;
function getScratch(width: number, height = width): HTMLCanvasElement {
  if (!scratchCanvas) scratchCanvas = document.createElement("canvas");
  if (scratchCanvas.width !== width) scratchCanvas.width = width;
  if (scratchCanvas.height !== height) scratchCanvas.height = height;
  return scratchCanvas;
}

/** Katmanlar arası kullanıma hazır qr-v1 sürücü nesnesi. */
export const driver: TransportDriver<QrOptions> = {
  id,
  capacityBytes: (options) => frameBytes(options.version),
  encode: (payload, options) => toBitmap(payload, options),
  decode: (frame) => decodeFrame(frame),
};
