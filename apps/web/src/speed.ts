/**
 * Süre tahminleri: uygulama ve sitedeki hesaplayıcı aynı formülleri kullanır,
 * sitede yazan sayı uygulamanın göstereceğinden farklı olamaz.
 *
 * Bunlar model, cihaz ölçümü değil. Varsayımlar ihtiyatlıdır: kayıttan okumada
 * görüntülerin %60'ının okunduğu, %10 fountain ve %20 güvenlik payı.
 */
import { FRAME_OVERHEAD } from "@kionel/core";
import { estimateTransfer, frameBytes } from "@kionel/transport-qr";
import { COLOUR_BYTES_PER_FRAME, COLOUR_FPS, COLOUR_READABLE_SHARE } from "./colour.ts";

/**
 * Alıcının ne kadar kaydetmesi gerektiği. Ölçüme dayanır: 60 fps kayıtta
 * karelerin yaklaşık yarısı kullanılabilir kod verir (tarayıcı testi, 1 MB / 16 s).
 * Kod başına yük yoğun ayardaki (sürüm 40) kapasitedir; %10 fountain payı ve
 * %25 güvenlik payı eklenir, çünkü eksik kayıt ikinci bir çekim demektir.
 */
export function recordingSeconds(wireSize: number): number {
  const codes = Math.ceil((wireSize / (frameBytes(40) - FRAME_OVERHEAD)) * 1.1);
  // Saniyede 20 kod gösterilir; telefon kaydında ~%60'ı okunur (ihtiyatlı).
  return Math.ceil((codes / (20 * 0.6)) * 1.2) + 3;
}

/** Renkli kod: ölçülen kare başına yük ve ihtiyatlı okunma payı; %10 pay ve 3 s başlangıç. */
export function colourSeconds(wireSize: number): number {
  return Math.ceil((wireSize / (COLOUR_BYTES_PER_FRAME * COLOUR_FPS * COLOUR_READABLE_SHARE)) * 1.1) + 3;
}

/**
 * Canlı okumada telefonun bir kodu çözmesi için geçen süre. Ekran saniyede 30 kod
 * gösterse de telefon canlı akıştan çok daha azını çözer.
 *
 * İki gerçek ölçüm: 117 KB, canlı okuma 10–24 s; 105 KB (Redmi Note 13 Pro, 24"
 * ekran) 16 s ve 13 s. 150 ms bu dosya için 15,9 s öngörür — ikisinin yavaş
 * olanıyla aynı. İhtiyatlı uç bilerek seçildi: tahmin gerçekten hızlı çıkarsa
 * kullanıcı beklediğinden uzun bekler.
 * ponytail: iki telefon ölçümü; yeni cihaz ölçümü geldikçe güncellenmeli.
 */
export const LIVE_DECODE_MS = 150;

/** Canlı okuma: uygulamanın varsayılan ayarı (sürüm 27, saniyede 30 kod), telefonun çözme hızıyla sınırlı. */
export function liveSeconds(wireSize: number): number {
  return estimateTransfer(wireSize, { version: 27, hold: 2, decodeMs: LIVE_DECODE_MS }).seconds;
}
