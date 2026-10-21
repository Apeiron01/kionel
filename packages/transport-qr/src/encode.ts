/**
 * L1 qr-v1 — kodlama tarafı. DOM'a bağımlı değildir (test Node'da koşar).
 */
import QRCode from "qrcode";

/** QR sürüm -> ECC seviyesi L ile taşınabilen bayt (standart tablo). */
export const QR_CAPACITY_L: Record<number, number> = {
  10: 271, 15: 520, 20: 858, 25: 1273, 27: 1465, 30: 1732, 35: 2306, 40: 2953,
};

export interface QrOptions {
  /** QR sürümü. Büyük = çok veri, ama kamera için daha zor. */
  version: number;
  /** Kenar boşluğu (modül). Standart 4 der; ekran-kamera için 2 yeterli. */
  quietZone?: number;
}

/** Bir çerçevenin taşıyabileceği toplam bayt (Kionel başlığı dahil). */
export function frameBytes(version: number): number {
  const cap = QR_CAPACITY_L[version];
  if (!cap) throw new Error(`qr-v1: desteklenmeyen sürüm ${version}`);
  return cap;
}

export interface Bitmap {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** Baytları 1 modül = `scale` piksel olacak şekilde RGBA bitmap'e çizer. */
export function toBitmap(bytes: Uint8Array, { version, quietZone = 2 }: QrOptions, scale = 1): Bitmap {
  const qr = QRCode.create([{ data: bytes, mode: "byte" }], { errorCorrectionLevel: "L", version });
  const n = qr.modules.size;
  const side = (n + quietZone * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!qr.modules.data[y * n + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        const row = ((y + quietZone) * scale + dy) * side + (x + quietZone) * scale;
        for (let dx = 0; dx < scale; dx++) {
          const i = (row + dx) * 4;
          data[i] = data[i + 1] = data[i + 2] = 0;
        }
      }
    }
  }
  return { data, width: side, height: side };
}

/**
 * Birden fazla kareyi tek bir görüntüye ızgara hâlinde yerleştirir.
 *
 * Büyük ekranın asıl kaldıracı daha büyük bir QR değil, **aynı anda daha fazla
 * QR**. Bir monitör telefon ekranının kat kat fazlasını gösterir; kamera dört
 * kodu tek karede okursa verim dörde katlanır.
 *
 * Bedeli açık: aynı kamera pikseli dört kod arasında paylaşılır, yani her kodun
 * modülleri küçülür. Net kazanç ancak kameranın çözünürlük fazlası varsa doğar —
 * ki monitör → telefon senaryosu tam olarak budur (ekran büyük, kamera 1080p+).
 * Ucuz bir kamerada bu profil kaybettirir. Bu yüzden döşeme varsayılan değildir
 * ve cihaz çifti başına kalifiye edilmelidir.
 */
export function toTiledBitmap(
  frames: readonly Uint8Array[],
  options: QrOptions,
  scale = 1,
  gapModules = 2,
): Bitmap {
  if (frames.length === 0) throw new Error("qr-v1: döşenecek kare yok");
  if (frames.length === 1) return toBitmap(frames[0], options, scale);

  // Kare bir ızgara: 2 kod için 2×1 değil 2×2 kullanmak ekranı boşa harcar,
  // ama dikdörtgen ızgara da ekranın kısa kenarını sınırlar. Kare en dengelisi.
  const columns = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / columns);

  const tiles = frames.map((frame) => toBitmap(frame, options, scale));
  const cell = Math.max(...tiles.map((tile) => tile.width));
  const gap = gapModules * scale;
  const width = columns * cell + (columns - 1) * gap;
  const height = rows * cell + (rows - 1) * gap;

  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  tiles.forEach((tile, index) => {
    const originX = (index % columns) * (cell + gap);
    const originY = Math.floor(index / columns) * (cell + gap);
    for (let y = 0; y < tile.height; y++) {
      const source = y * tile.width * 4;
      const target = ((originY + y) * width + originX) * 4;
      data.set(tile.data.subarray(source, source + tile.width * 4), target);
    }
  });
  return { data, width, height };
}
