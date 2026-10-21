/**
 * Renkli kod taşıması — libcimbar (MPL-2.0), değiştirilmeden, işçilerde.
 *
 * Kionel yalnız kendi şifreli zarfını cimbar'a "dosya" olarak verir; şifreleme,
 * sevk ve teslim kayıtları QR yolundakiyle aynıdır. Cimbar'ın kendi fountain
 * kodu (wirehair) ve zstd'si taşımayı yapar.
 *
 * Ölçüm (başsız Chrome, kayıttan okuma, mod B): kare başına ~2,8 KB, çözülen
 * kare %98–99,5. Kare başına çözme QR'dan ~15 kat ağırdır; bu yüzden çözme
 * birden çok işçiye paralel dağıtılır — tek işçide 84 s süren 1 MB okuma, dört
 * işçide kayıt süresine (gerçek zamana) iner.
 */
const BASE = "/cimbar/";
const BUILD = "2026-08-21T2336";
/** İşçi adresleri; çevrimdışı pakette colour-offline.ts bunları bellekteki kopyalara çevirir. */
export const workerUrls = {
  send: `${BASE}send-worker.${BUILD}.js`,
  recv: `${BASE}recv-worker.${BUILD}.js`,
  sink: `${BASE}kionel-sink.js`,
};
export const COLOUR_MODE = 68; // libcimbar "B"
/** Ölçülen kare başına yük; kayıt süresi tahmini için. */
export const COLOUR_BYTES_PER_FRAME = 2770;
/**
 * Saniyede 15 kod: telefon kameraları çoğunlukla 30 fps kaydeder ve kod
 * değişirken çekilen kare iki kodun karışımı olur. 15'te her kod iki kamera
 * karesinde durur, en az biri temiz çıkar. libcimbar'ın varsayılanı da budur;
 * 30'da gerçek telefonda 34 s'lik kayıttan yalnız 3 kare okunabildi.
 */
export const COLOUR_FPS = 15;
/** Gerçek telefon kaydında okunabilir kare payı için ihtiyatlı tahmin. */
export const COLOUR_READABLE_SHARE = 0.6;
/** Bir karenin çözülmesi için beklenen en uzun süre. */
const FRAME_TIMEOUT_MS = 8000;

/** Gönderici: kodu verilen kapsayıcıdaki yeni bir canvas'a çizer. */
export class ColourSender {
  private constructor(private readonly worker: Worker, readonly canvas: HTMLCanvasElement) {}

  static async start(host: HTMLElement, wire: Uint8Array, fps = COLOUR_FPS): Promise<ColourSender> {
    // Bir canvas yalnız bir kez OffscreenCanvas'a devredilebilir; her gönderim yenisini kurar.
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    canvas.className = "stage colour-stage";
    host.append(canvas);
    const offscreen = canvas.transferControlToOffscreen();
    const worker = new Worker(workerUrls.send);
    const ready = new Promise<boolean>((resolve) => {
      worker.onmessage = (event) => { if (event.data?.fun === "startWasm") resolve(Boolean(event.data.args?.[0])); };
      worker.onerror = () => resolve(false);
    });
    worker.postMessage({ fun: "init_window", args: [offscreen] }, [offscreen]);
    if (!(await ready)) {
      worker.terminate();
      canvas.remove();
      throw new Error("the colour code needs WebGL, which this browser does not provide here");
    }
    worker.postMessage({ fun: "setMode", args: [COLOUR_MODE] });
    worker.postMessage({ fun: "setFPS", args: [fps] });
    worker.postMessage({ fun: "importFile", args: [new File([wire as BlobPart], "kionel.wire")] });
    worker.postMessage({ fun: "nextFrame", args: [] });
    return new ColourSender(worker, canvas);
  }

  stop(): void {
    this.worker.terminate();
    this.canvas.remove();
  }
}

export interface ColourFrame { pixels: Uint8Array; format: string; width: number; height: number }

const NATIVE_FORMATS = ["NV12", "I420"];
const fallbackCanvas = typeof document === "undefined" ? undefined : document.createElement("canvas");

/**
 * Kareyi kameranın kendi biçiminde alır. Tuvale çizip RGBA okumak telefonda
 * pahalıdır ve ölçekleme küçük renk hücrelerini bozar; libcimbar'ın kendi
 * alıcısı da VideoFrame kullanır.
 */
export async function grabColourFrame(video: HTMLVideoElement): Promise<ColourFrame | undefined> {
  if (!video.videoWidth) return undefined;
  if (typeof VideoFrame !== "undefined") {
    let frame: VideoFrame | undefined;
    try {
      frame = new VideoFrame(video);
      const options: VideoFrameCopyToOptions = NATIVE_FORMATS.includes(frame.format ?? "") ? {} : { format: "RGBA" };
      const pixels = new Uint8Array(frame.allocationSize(options));
      // copyTo asenkron: beklenmezse kare, pikseller yazılmadan işçiye devredilir
      // ve boş çözülür. Çözücü boşken hep böyle oluyordu; canlı okuma hiç tutmuyordu.
      await frame.copyTo(pixels, options);
      return { pixels, format: options.format ?? frame.format ?? "RGBA", width: frame.displayWidth, height: frame.displayHeight };
    } catch {
      /* aşağıdaki tuval yolu */
    } finally {
      frame?.close();
    }
  }
  const canvas = fallbackCanvas!;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(video, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { pixels: new Uint8Array(image.data.buffer), format: "RGBA", width: image.width, height: image.height };
}

/** Alıcı: kareleri paralel çözer, parçaları tek dosyada birleştirir. */
export class ColourReader {
  private readonly slots: { worker: Worker; inFlight: number; timer: number }[] = [];
  private readonly waiters: (() => void)[] = [];
  private sink!: Worker;
  /** Bu okuyucuya verilen ve kod bulunan kare sayısı. */
  parts = 0;
  frames = 0;
  progress = 0;

  private constructor() {}

  static async create(onFile: (bytes: Uint8Array) => void, onProgress: () => void): Promise<ColourReader> {
    const reader = new ColourReader();
    // Telefonda bellek sınırlı: her çözücü kendi WASM yığınını taşır ve dördü birden
    // bir işçinin sessizce çökmesine yol açabilir. Telefonda iki, bilgisayarda en fazla dört.
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    const count = Math.max(1, Math.min(mobile ? 2 : 4, (navigator.hardwareConcurrency || 2) - 1));
    const loads: Promise<void>[] = [];
    reader.sink = new Worker(workerUrls.sink);
    loads.push(new Promise((resolve, reject) => {
      reader.sink.onmessage = (event) => {
        if (event.data.type === "ready") resolve();
        if (event.data.type === "progress") { reader.progress = event.data.progress; onProgress(); }
        if (event.data.type === "file") onFile(event.data.bytes);
      };
      reader.sink.onerror = () => reject(new Error("the colour-code decoder could not start"));
    }));
    for (let i = 0; i < count; i++) {
      const worker = new Worker(workerUrls.recv);
      const slot = { worker, inFlight: 0, timer: 0 };
      loads.push(new Promise((resolve, reject) => {
        worker.onmessage = (event) => {
          if (event.data.type === "startWasm") return resolve();
          if (event.data.buff) {
            reader.parts++;
            reader.sink.postMessage({ chunk: event.data.buff, mode: COLOUR_MODE }, [event.data.buff.buffer]);
          }
          window.clearTimeout(slot.timer);
          slot.inFlight = Math.max(0, slot.inFlight - 1);
          reader.waiters.shift()?.();
        };
        worker.onerror = () => reject(new Error("the colour-code decoder could not start"));
      }));
      reader.slots.push(slot);
    }
    await Promise.all(loads);
    return reader;
  }

  /** Her çözücüde en fazla bu kadar kare sırada bekler. */
  private static readonly QUEUE = 3;

  get idle(): boolean {
    return this.slots.some((slot) => slot.inFlight < ColourReader.QUEUE);
  }

  /**
   * Kareyi boş bir çözücüye verir. `wait` doğruysa boş çözücü beklenir (kayıttan
   * okurken video durur, kare atlanmaz); değilse ve hepsi meşgulse kare atlanır
   * (canlı kamerada yenisi zaten gelir).
   */
  async submit(frame: ColourFrame, wait: boolean): Promise<boolean> {
    const pick = () => this.slots
      .filter((s) => s.inFlight < ColourReader.QUEUE)
      .sort((a, b) => a.inFlight - b.inFlight)[0];
    let slot = pick();
    while (!slot) {
      if (!wait) return false;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
      slot = pick();
    }
    slot.inFlight++;
    this.frames++;
    // Cevap gelmezse (işçi bellek yüzünden çöktüyse) kare sayılmaz, sıra açılır;
    // aksi hâlde okuma sonsuza kadar beklerdi.
    const current = slot;
    window.clearTimeout(current.timer);
    current.timer = window.setTimeout(() => {
      current.inFlight = 0;
      this.waiters.shift()?.();
    }, FRAME_TIMEOUT_MS);
    slot.worker.postMessage(
      { pixels: frame.pixels, format: frame.format, width: frame.width, height: frame.height, mode: COLOUR_MODE },
      [frame.pixels.buffer],
    );
    return true;
  }

  close(): void {
    for (const slot of this.slots) slot.worker.terminate();
    this.sink.terminate();
    for (const wake of this.waiters.splice(0)) wake();
  }
}
