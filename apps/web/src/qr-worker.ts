/** QR çözme işçisi: canlı kamerada kareler ana iş parçacığını beklemeden, paralel çözülür (qr-pool.ts). */
import { decodeFramesWithBoxes } from "@kionel/transport-qr";

type Job = { id: number; max: number } & ({ bitmap: ImageBitmap } | { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number });

let canvas: OffscreenCanvas | undefined;

/** Karenin pikselleri burada okunur: telefonda en pahalı adım budur ve ana iş parçacığından alınır. */
function pixels(bitmap: ImageBitmap): ImageData {
  canvas ??= new OffscreenCanvas(bitmap.width, bitmap.height);
  if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
  }
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

addEventListener("message", (event: MessageEvent<Job>) => {
  const job = event.data;
  const started = performance.now();
  void (async () => decodeFramesWithBoxes("bitmap" in job ? pixels(job.bitmap) : new ImageData(job.data, job.width, job.height), job.max))()
    .catch(() => [])
    .then((found) => postMessage({ id: job.id, found, ms: performance.now() - started }));
});
