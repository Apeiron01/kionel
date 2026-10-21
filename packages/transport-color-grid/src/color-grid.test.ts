import { expect, test } from "vitest";
import {
  capacityBytes,
  decodeColorGrid,
  encodeColorGrid,
  mapPerspectivePoint,
  type ColorGridBitmap,
  type Quad,
} from "./index.ts";

const payload = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 73 + 19) & 0xff);

test("3-bit renkli ızgara ikili veriyi kayıpsız döndürür", () => {
  const input = payload(4000);
  const bitmap = encodeColorGrid(input);
  expect([...decodeColorGrid(bitmap)!]).toEqual([...input]);
});

test("kalibrasyon renk kanalı kazancı ve sensör gürültüsünü telafi eder", () => {
  const input = payload(1000);
  const bitmap = encodeColorGrid(input, { cellPixels: 3 });
  for (let i = 0; i < bitmap.data.length; i += 4) {
    bitmap.data[i] = Math.min(255, bitmap.data[i] * 0.78 + 12 + ((i / 4) % 5));
    bitmap.data[i + 1] = Math.min(255, bitmap.data[i + 1] * 0.92 + 5);
    bitmap.data[i + 2] = Math.min(255, bitmap.data[i + 2] * 0.70 + 18);
  }
  expect([...decodeColorGrid(bitmap)!]).toEqual([...input]);
});

test("hücre kurcalaması CRC ile reddedilir", () => {
  const bitmap = encodeColorGrid(payload(200), { cellPixels: 2 });
  const side = bitmap.width;
  const cell = 2;
  // Veri alanındaki bir hücreyi başka geçerli renge boya: renk çözülür ama CRC düşer.
  const first = (cell * side + cell * 20) * 4;
  const replacement = bitmap.data[first] === 255 && bitmap.data[first + 1] === 255 && bitmap.data[first + 2] === 255 ? 0 : 255;
  for (let y = cell; y < cell * 2; y++) {
    for (let x = cell * 20; x < cell * 21; x++) {
      const at = (y * side + x) * 4;
      bitmap.data[at] = replacement;
      bitmap.data[at + 1] = replacement;
      bitmap.data[at + 2] = replacement;
    }
  }
  expect(decodeColorGrid(bitmap)).toBeNull();
});

test("120×120 ızgara QR v27'nin üç katından fazla ham kapasite taşır", () => {
  expect(capacityBytes()).toBeGreaterThan(1465 * 3);
});

test("dört köşe homografisi perspektif bozulmuş rasteri geri kurar", () => {
  const input = payload(1000);
  const flat = encodeColorGrid(input, { cells: 60, cellPixels: 4 });
  const corners: Quad = [
    { x: 70, y: 35 }, { x: 560, y: 75 }, { x: 515, y: 435 }, { x: 105, y: 400 },
  ];
  const projected = project(flat, corners, 640, 480);
  expect([...decodeColorGrid(projected, { cells: 60, cellPixels: 4, corners })!]).toEqual([...input]);
});

test("hizalama işareti bozulursa raster veri gibi yorumlanmaz", () => {
  const bitmap = encodeColorGrid(payload(50), { cells: 32, cellPixels: 3 });
  // Sol üst finder'ın beyaz merkezini siyaha çevir.
  for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) {
    const at = (y * bitmap.width + x) * 4;
    bitmap.data[at] = bitmap.data[at + 1] = bitmap.data[at + 2] = 0;
  }
  expect(decodeColorGrid(bitmap, { cells: 32 })).toBeNull();
});

function project(source: ColorGridBitmap, corners: Quad, width: number, height: number): ColorGridBitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data[i + 3] = 255;
  for (let sy = 0; sy < source.height; sy++) {
    for (let sx = 0; sx < source.width; sx++) {
      const point = mapPerspectivePoint(corners, sx / (source.width - 1), sy / (source.height - 1));
      const cx = Math.round(point.x);
      const cy = Math.round(point.y);
      const from = (sy * source.width + sx) * 4;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const to = (y * width + x) * 4;
        data[to] = source.data[from];
        data[to + 1] = source.data[from + 1];
        data[to + 2] = source.data[from + 2];
        data[to + 3] = 255;
      }
    }
  }
  return { data, width, height };
}
