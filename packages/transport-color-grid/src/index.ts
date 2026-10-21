/**
 * L1 color-grid-v1 laboratuvar sürücüsü.
 *
 * Sekiz kalibre edilmiş renk = hücre başına 3 bit. Dört 3×3 köşe işareti hizalama
 * içindir; köşeler verildiğinde görüntü homografiyle normalize edilir.
 */
import { crc32, type TransportDriver } from "@kionel/core";

export const id = "color-grid-v1-experimental";
export const DEFAULT_CELLS = 120;
const MAGIC = [0x50, 0x48] as const; // "PH"
const WRAPPER_BYTES = 8; // magic 2 + length 2 + CRC32 4

// Küp köşeleri: kanal başına geniş mesafe, kalibrasyondan sonra nearest-neighbor.
const PALETTE = [
  [0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255],
  [255, 255, 0], [255, 0, 255], [0, 255, 255], [255, 255, 255],
] as const;

export interface ColorGridOptions {
  cells?: number;
  cellPixels?: number;
  /** Kalibre edilmiş renge izin verilen azami Öklid uzaklığı. */
  tolerance?: number;
  /** Saat yönünde: sol üst, sağ üst, sağ alt, sol alt görüntü koordinatları. */
  corners?: Quad;
}

export interface Point { x: number; y: number }
export type Quad = readonly [Point, Point, Point, Point];

export interface ColorGridBitmap {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

export function capacityBytes(cells = DEFAULT_CELLS): number {
  validateCells(cells);
  return Math.min(0xffff, Math.floor(dataCellCount(cells) * 3 / 8) - WRAPPER_BYTES);
}

export function encodeColorGrid(
  payload: Uint8Array,
  { cells = DEFAULT_CELLS, cellPixels = 4 }: ColorGridOptions = {},
): ColorGridBitmap {
  validateCells(cells);
  if (!Number.isInteger(cellPixels) || cellPixels < 1) throw new Error("geçersiz hücre piksel boyutu");
  if (payload.length > capacityBytes(cells)) throw new Error(`color-grid kapasitesi aşıldı: ${payload.length} > ${capacityBytes(cells)}`);

  const wrapped = new Uint8Array(WRAPPER_BYTES + payload.length);
  wrapped.set(MAGIC, 0);
  new DataView(wrapped.buffer).setUint16(2, payload.length);
  wrapped.set(payload, 4);
  new DataView(wrapped.buffer).setUint32(4 + payload.length, crc32(payload));
  const symbols = bytesToSymbols(wrapped);
  const side = cells * cellPixels;
  const data = new Uint8ClampedArray(side * side * 4);
  let symbolAt = 0;

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const reserved = reservedSymbol(x, y, cells);
      const symbol = reserved ?? symbols[symbolAt++] ?? 0;
      paintCell(data, side, x, y, cellPixels, PALETTE[symbol]);
    }
  }
  return { data, width: side, height: side };
}

export function decodeColorGrid(
  image: ImageData | ColorGridBitmap,
  { cells = DEFAULT_CELLS, cellPixels = 4, tolerance = 80, corners }: ColorGridOptions = {},
): Uint8Array | null {
  validateCells(cells);
  if (corners) {
    try {
      image = rectifyPerspective(image, corners, cells, cellPixels);
    } catch {
      return null;
    }
  }
  if (image.width !== image.height || image.width % cells !== 0) return null;
  const sampleSize = image.width / cells;
  const calibrated = Array.from({ length: 8 }, (_, index) => sampleCell(image.data, image.width, 4 + index, 0, sampleSize));
  if (!finderPatternsValid(image, cells, sampleSize, calibrated, tolerance)) return null;
  const symbols: number[] = [];
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      if (reservedSymbol(x, y, cells) !== null) continue;
      const sample = sampleCell(image.data, image.width, x, y, sampleSize);
      const nearest = nearestColor(sample, calibrated);
      if (nearest.distance > tolerance * tolerance) return null;
      symbols.push(nearest.index);
    }
  }
  const bytes = symbolsToBytes(symbols);
  if (bytes.length < WRAPPER_BYTES || bytes[0] !== MAGIC[0] || bytes[1] !== MAGIC[1]) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(2);
  if (length > capacityBytes(cells) || 4 + length + 4 > bytes.length) return null;
  const payload = bytes.slice(4, 4 + length);
  const expected = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4 + length);
  return crc32(payload) === expected ? payload : null;
}

/** Verilen dört dış köşeyi kare rastere ters homografiyle örnekler. */
export function rectifyPerspective(
  image: ImageData | ColorGridBitmap,
  corners: Quad,
  cells = DEFAULT_CELLS,
  cellPixels = 4,
): ColorGridBitmap {
  validateCells(cells);
  if (!Number.isInteger(cellPixels) || cellPixels < 1 || !validQuad(corners)) throw new Error("geçersiz perspektif profili");
  const side = cells * cellPixels;
  const data = new Uint8ClampedArray(side * side * 4);
  for (let y = 0; y < side; y++) {
    const v = side === 1 ? 0 : y / (side - 1);
    for (let x = 0; x < side; x++) {
      const u = side === 1 ? 0 : x / (side - 1);
      const source = mapPerspectivePoint(corners, u, v);
      const sx = Math.round(source.x);
      const sy = Math.round(source.y);
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      const from = (sy * image.width + sx) * 4;
      const to = (y * side + x) * 4;
      data[to] = image.data[from];
      data[to + 1] = image.data[from + 1];
      data[to + 2] = image.data[from + 2];
      data[to + 3] = 255;
    }
  }
  return { data, width: side, height: side };
}

/** Birim kareyi verilen dörtgene götüren projektif dönüşüm. */
export function mapPerspectivePoint(corners: Quad, u: number, v: number): Point {
  const [p0, p1, p2, p3] = corners;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    if (Math.abs(denominator) < 1e-9) throw new Error("tekil homografi");
    g = (dx3 * dy2 - dx2 * dy3) / denominator;
    h = (dx1 * dy3 - dx3 * dy1) / denominator;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  const scale = g * u + h * v + 1;
  return { x: (a * u + b * v + p0.x) / scale, y: (d * u + e * v + p0.y) / scale };
}

function dataCellCount(cells: number): number {
  return cells * cells - 4 * 9 - 8; // dört finder + sekiz kalibrasyon hücresi
}

function reservedSymbol(x: number, y: number, cells: number): number | null {
  const cornerX = x < 3 ? x : x >= cells - 3 ? x - (cells - 3) : -1;
  const cornerY = y < 3 ? y : y >= cells - 3 ? y - (cells - 3) : -1;
  if (cornerX >= 0 && cornerY >= 0) return cornerX === 1 && cornerY === 1 ? 7 : 0;
  if (y === 0 && x >= 4 && x < 12) return x - 4;
  return null;
}

function finderPatternsValid(
  image: ImageData | ColorGridBitmap,
  cells: number,
  size: number,
  palette: number[][],
  tolerance: number,
): boolean {
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const expected = reservedSymbol(x, y, cells);
      if (expected === null || (y === 0 && x >= 4 && x < 12)) continue;
      const nearest = nearestColor(sampleCell(image.data, image.width, x, y, size), palette);
      if (nearest.index !== expected || nearest.distance > tolerance * tolerance) return false;
    }
  }
  return true;
}

function validQuad(corners: Quad): boolean {
  if (corners.length !== 4 || corners.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const next = corners[(i + 1) % 4];
    area += corners[i].x * next.y - next.x * corners[i].y;
  }
  return Math.abs(area) > 100;
}

function paintCell(
  target: Uint8ClampedArray,
  side: number,
  cellX: number,
  cellY: number,
  size: number,
  color: readonly number[],
): void {
  for (let py = cellY * size; py < (cellY + 1) * size; py++) {
    for (let px = cellX * size; px < (cellX + 1) * size; px++) {
      const at = (py * side + px) * 4;
      target[at] = color[0];
      target[at + 1] = color[1];
      target[at + 2] = color[2];
      target[at + 3] = 255;
    }
  }
}

function sampleCell(data: Uint8ClampedArray, side: number, x: number, y: number, size: number): number[] {
  const inset = Math.max(0, Math.floor(size / 4));
  const fromX = x * size + inset;
  const fromY = y * size + inset;
  const toX = (x + 1) * size - inset;
  const toY = (y + 1) * size - inset;
  const sum = [0, 0, 0];
  let count = 0;
  for (let py = fromY; py < toY; py++) {
    for (let px = fromX; px < toX; px++) {
      const at = (py * side + px) * 4;
      sum[0] += data[at];
      sum[1] += data[at + 1];
      sum[2] += data[at + 2];
      count++;
    }
  }
  return sum.map((value) => value / count);
}

function nearestColor(sample: number[], palette: number[][]): { index: number; distance: number } {
  let index = 0;
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i++) {
    const candidate = (sample[0] - palette[i][0]) ** 2 +
      (sample[1] - palette[i][1]) ** 2 + (sample[2] - palette[i][2]) ** 2;
    if (candidate < distance) {
      index = i;
      distance = candidate;
    }
  }
  return { index, distance };
}

function bytesToSymbols(bytes: Uint8Array): number[] {
  const symbols: number[] = [];
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 3) {
      bits -= 3;
      symbols.push((value >>> bits) & 7);
      value &= (1 << bits) - 1;
    }
  }
  if (bits) symbols.push((value << (3 - bits)) & 7);
  return symbols;
}

function symbolsToBytes(symbols: number[]): Uint8Array {
  const bytes = new Uint8Array(Math.floor(symbols.length * 3 / 8));
  let value = 0;
  let bits = 0;
  let at = 0;
  for (const symbol of symbols) {
    value = (value << 3) | symbol;
    bits += 3;
    while (bits >= 8 && at < bytes.length) {
      bits -= 8;
      bytes[at++] = (value >>> bits) & 0xff;
      value &= (1 << bits) - 1;
    }
  }
  return bytes;
}

function validateCells(cells: number): void {
  if (!Number.isInteger(cells) || cells < 16 || cells > 512) throw new Error("geçersiz ızgara boyutu");
}

/** Köşe tespiti üst kamera adaptöründedir; bulunan köşeler `options.corners` ile verilir. */
export const driver: TransportDriver<ColorGridOptions> = {
  id,
  capacityBytes: (options) => capacityBytes(options.cells),
  encode: (payload, options) => encodeColorGrid(payload, options),
  decode: async (frame, options) => decodeColorGrid(frame, options),
};
