/**
 * Seri kablo taşıması: ekran-kamera yerine RS-232/USB-seri hat. Kionel çerçeveleri
 * (SPEC §2, CRC32'li) bir bayt akışına dizilir; alıcı akıştan çerçeveleri geri
 * ayıklar. Geri kanal yoktur: alıcının TX ucu bağlanmazsa hat fiziksel olarak tek
 * yönlüdür (düşük maliyetli bir veri diyotu). Kayıp ve bozulmayı fountain kod ve
 * çerçeve CRC'si karşılar; bu katman yalnız sınırları bulur.
 *
 * Paket: "KNSL" (4 bayt) · uzunluk (u16, büyük endian) · çerçeve. Bozuk bir
 * uzunluk akışı kaydırmasın diye aday çerçeve CRC'den geçmezse ayıklayıcı bir
 * bayt ilerleyip yeniden işaret arar.
 */
import { decodeFrame } from "@kionel/core";

export const MAGIC = [0x4b, 0x4e, 0x53, 0x4c]; // "KNSL"
const PREFIX = MAGIC.length + 2;
export const MAX_FRAME = 4096;
export const SERIAL_BLOCK = 1024;
export const BAUD_RATES = [115200, 230400, 460800, 921600];

export function wrap(frame: Uint8Array): Uint8Array {
  if (frame.length > MAX_FRAME) throw new Error("frame too large for the serial link");
  const out = new Uint8Array(PREFIX + frame.length);
  out.set(MAGIC);
  out[4] = frame.length >> 8;
  out[5] = frame.length & 0xff;
  out.set(frame, PREFIX);
  return out;
}

/** Parça parça gelen baytlardan geçerli çerçeveleri çıkarır; gerisini atar. */
export class Unwrapper {
  private buffer = new Uint8Array(0);
  /** Atılan bayt sayısı: hat gürültüsü ya da yanlış baud hızı için gösterge. */
  discarded = 0;

  push(chunk: Uint8Array): Uint8Array[] {
    const joined = new Uint8Array(this.buffer.length + chunk.length);
    joined.set(this.buffer);
    joined.set(chunk, this.buffer.length);
    const frames: Uint8Array[] = [];
    let at = 0;
    while (joined.length - at >= PREFIX) {
      if (!MAGIC.every((b, i) => joined[at + i] === b)) { at++; this.discarded++; continue; }
      const length = (joined[at + 4] << 8) | joined[at + 5];
      if (length === 0 || length > MAX_FRAME) { at++; this.discarded++; continue; }
      if (joined.length - at < PREFIX + length) break; // gerisi sonraki parçada
      const frame = joined.slice(at + PREFIX, at + PREFIX + length);
      if (decodeFrame(frame)) { frames.push(frame); at += PREFIX + length; }
      else { at++; this.discarded++; }
    }
    this.buffer = joined.slice(at);
    // Yanlış hızda akan çöp birikip belleği doldurmasın.
    if (this.buffer.length > 4 * (PREFIX + MAX_FRAME)) {
      this.discarded += this.buffer.length - PREFIX;
      this.buffer = this.buffer.slice(-PREFIX);
    }
    return frames;
  }
}

// ---- Web Serial (Chrome/Edge masaüstü) ------------------------------------------------

export interface SerialPortLike {
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike { requestPort(): Promise<SerialPortLike> }

export const serialSupported = () => "serial" in navigator;

/** Tarayıcının port seçicisini açar. Kullanıcı tıklamasının içinde, ilk await'ten önce çağrılmalı. */
export function choosePort(): Promise<SerialPortLike> {
  return (navigator as unknown as { serial: SerialLike }).serial.requestPort();
}

/** Seçici kapatıldıysa (port seçilmedi) sessiz geçilir. */
export const portCancelled = (error: unknown) => (error as Error)?.name === "NotFoundError";

/** Açılış hatasını kullanıcının düzeltebileceği bir cümleye çevirir. */
export function portProblem(error: unknown): string {
  const name = (error as Error)?.name;
  if (name === "InvalidStateError") return "the port is already open, perhaps in another tab or program";
  if (name === "NetworkError") return "the port could not be opened; another program (a terminal, the instrument software) may be using it";
  return (error as Error)?.message || "the port could not be opened";
}
