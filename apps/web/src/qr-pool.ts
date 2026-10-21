/**
 * Canlı okumada QR çözme havuzu.
 *
 * Ekran saniyede 30 kod gösterir, kamera 30 kare verir; telefon ise bir kareyi ~150 ms'de
 * çözer. Çözme tek iş parçacığında sırayla yapılınca karelerin dörtte üçünden fazlası hiç
 * denenmeden atılıyordu. Havuz, kareleri boştaki işçilere dağıtır: çekirdek sayısı kadar
 * kare aynı anda çözülür. Gönderen ve aktarım biçimi değişmez.
 *
 * Havuz sayfa başına bir kez kurulur ve kamera kapanıp açılırken yaşar: her açılışta
 * işçileri yeniden kurmak betiklerini ağdan yeniden ister, ağ takılırsa işçiler hiç
 * cevap vermez ve alıcı kör kalırdı (canlı sitede görüldü). Cevap vermeyen işçi
 * süre dolunca havuzdan çıkarılır; hiç işçi kalmazsa çözme ana iş parçacığına döner.
 */
import { decodeFramesWithBoxes, type Box } from "@kionel/transport-qr";

export interface QrDecoded { found: { bytes: Uint8Array; box: Box }[]; ms: number }
export interface QrPool {
  /** Yeni bir kare alabilecek boş çözücü var. */
  readonly idle: boolean;
  /** İşçiler çalışıyor: kare ImageBitmap olarak verilebilir, pikselleri işçi okur. */
  readonly parallel: boolean;
  /** Bitmap yalnız `parallel` iken verilir; aksi hâlde ImageData. */
  decode(frame: ImageData | Promise<ImageBitmap>, max: number): Promise<QrDecoded>;
}

declare const __KIONEL_OFFLINE__: string;
const NOTHING: QrDecoded = { found: [], ms: 0 };
/** İlk kare işçinin ve WASM'ın yüklenmesini de bekler; sonrakiler yalnız çözmeyi. */
const FIRST_ANSWER_MS = 8000;
const ANSWER_MS = 4000;

function createQrPool(size: number): QrPool {
  const free: Worker[] = [];
  const answered = new WeakSet<Worker>();
  const waiting = new Map<number, { worker: Worker; resolve: (decoded: QrDecoded) => void; timer: number }>();
  let alive = 0, nextId = 0, inlineBusy = false;

  /** İşçi yüklenemedi, çöktü ya da cevap vermiyor: havuzdan çıkar, bekleyen karesi boş döner. */
  const retire = (worker: Worker) => {
    const at = free.indexOf(worker);
    if (at >= 0) free.splice(at, 1);
    for (const [id, job] of waiting) {
      if (job.worker !== worker) continue;
      waiting.delete(id);
      clearTimeout(job.timer);
      job.resolve(NOTHING);
    }
    worker.onmessage = worker.onerror = null;
    worker.terminate();
    alive--;
  };

  // ponytail: çevrimdışı paket tek dosyadır ve file:// ayrı işçi dosyası yükleyemez; orada
  // çözme ana iş parçacığında kalır. Gerekirse işçi, renkli koddaki gibi blob olarak gömülür.
  if (!__KIONEL_OFFLINE__ && typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined") {
    for (let i = 0; i < size; i++) {
      try {
        const worker = new Worker(new URL("./qr-worker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (event: MessageEvent<QrDecoded & { id: number }>) => {
          const job = waiting.get(event.data.id);
          if (!job) return;
          waiting.delete(event.data.id);
          clearTimeout(job.timer);
          answered.add(worker);
          free.push(worker);
          job.resolve({ found: event.data.found, ms: event.data.ms });
        };
        worker.onerror = () => retire(worker);
        free.push(worker);
        alive++;
      } catch { /* işçi kurulamadı: ana iş parçacığında çözülür */ }
    }
  }

  return {
    get idle() { return alive > 0 ? free.length > 0 : !inlineBusy; },
    get parallel() { return alive > 0; },
    async decode(frame, max) {
      // İşçi, kare hazırlanmadan önce ayrılır: sonraki kare aynı işçiyi alamaz.
      const worker = free.pop();
      if (worker) {
        let image: ImageData | ImageBitmap;
        try {
          image = await frame;
        } catch {
          free.push(worker);
          return NOTHING;
        }
        return new Promise((resolve) => {
          const id = nextId++;
          const timer = window.setTimeout(() => retire(worker), answered.has(worker) ? ANSWER_MS : FIRST_ANSWER_MS);
          waiting.set(id, { worker, resolve, timer });
          // Kare kopyalanmaz, işçiye devredilir.
          if (image instanceof ImageData) worker.postMessage({ id, data: image.data, width: image.width, height: image.height, max }, [image.data.buffer]);
          else worker.postMessage({ id, bitmap: image, max }, [image]);
        });
      }
      if (!(frame instanceof ImageData)) {
        // İşçiler bu kare hazırlanırken emekli oldu: kare atlanır, sonraki ana iş parçacığında çözülür.
        void frame.then((bitmap) => bitmap.close(), () => undefined);
        return NOTHING;
      }
      inlineBusy = true;
      const started = performance.now();
      try {
        return { found: await decodeFramesWithBoxes(frame, max), ms: performance.now() - started };
      } finally {
        inlineBusy = false;
      }
    },
  };
}

let shared: QrPool | undefined;

/** Sayfanın tek havuzu; ilk kamera açılışında kurulur. */
export function qrPool(): QrPool {
  return shared ??= createQrPool(Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1)));
}
