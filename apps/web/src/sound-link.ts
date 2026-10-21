/**
 * Sesle eşleşme — alıcının el sıkışma teklifi hoparlörden çalınır, kamerası
 * olmayan ama mikrofonu olan gönderen onu duyar.
 *
 * Sesle taşınan şey GİZLİ DEĞİLDİR: QR olarak gösterilen teklif kaydının
 * aynısıdır (herkese açık anahtarlar ve imza). Odadaki bir mikrofon onu duysa
 * bir şey öğrenmez; araya giren biri kendi teklifini çalsa iki ekrandaki
 * karşılaştırma kodu tutmaz. 12 karakterlik aktarım kodu ise gizlidir ve bu
 * yüzden sesle HİÇ gönderilmez: ses duvarın ötesine ve cepteki telefona ulaşır.
 *
 * Modem: 4 bant × 16 ton (MFSK), sembol başına 16 bit, 50 ms sembol → 40 bayt/s.
 * Reed–Solomon (32 eşlik baytı) 16 bozuk baytı düzeltir. 170 baytlık teklif
 * yaklaşık 5,5 saniye sürer.
 *
 * ponytail: bant 1,5–5,5 kHz ve 50 ms sembol, telefon hoparlörü → dizüstü
 * mikrofonu için ihtiyatlı seçildi. Gerçek cihaz ölçümü daha hızlısını
 * kaldırıyorsa BANKS ya da SYMBOL_S buradan ayarlanır; iki uç aynı sabitleri
 * kullanmak zorunda.
 */
const BASE_HZ = 1500;
const SPACING_HZ = 62.5;
const BANKS = 4;
const TONES = 16;
const SYMBOL_S = 0.05;
const TONE_S = 0.04;
/** Çözme penceresi tondan kısa: hizalama birkaç ms kaysa da pencere tonun içinde kalır. */
const WINDOW_S = 0.032;
const HOPS_PER_SYMBOL = 5;
const RAMP_S = 0.003;
const AMPLITUDE = 0.2;
const PARITY = 32;
/** Tek RS bloğu: 255 − 32 eşlik − 1 uzunluk baytı. */
export const SOUND_MAX_BYTES = 222;
const HEADER_COPIES = 3;

/** Eşzamanlama deseni: her bantta bilinen bir ton dizisi; rastgele gürültüde tutması olanaksız. */
const PREAMBLE: number[][] = Array.from({ length: 6 }, (_, i) =>
  Array.from({ length: BANKS }, (_, bank) => (i * 5 + 3 + bank * 3) % TONES));
const PREAMBLE_MIN_MATCHES = 19; // 24 karardan

const frequency = (bank: number, tone: number): number => BASE_HZ + (bank * TONES + tone) * SPACING_HZ;

// ---- Reed–Solomon, GF(256), üreteç kökleri α^0..α^31 ---------------------------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a: number, b: number): number => (a && b ? EXP[LOG[a] + LOG[b]] : 0);
const inv = (a: number): number => EXP[255 - LOG[a]];
const GENERATOR = (() => {
  let g = [1];
  for (let i = 0; i < PARITY; i++) {
    const next = new Array<number>(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= mul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
})();

export function rsParity(message: Uint8Array): Uint8Array {
  const rem = new Uint8Array(PARITY);
  for (const byte of message) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[PARITY - 1] = 0;
    if (factor) for (let i = 0; i < PARITY; i++) rem[i] ^= mul(GENERATOR[i + 1], factor);
  }
  return rem;
}

function syndromes(code: Uint8Array): Uint8Array {
  const out = new Uint8Array(PARITY);
  for (let j = 0; j < PARITY; j++) {
    let s = 0;
    for (const byte of code) s = mul(s, EXP[j]) ^ byte;
    out[j] = s;
  }
  return out;
}

/** Kod sözcüğünü yerinde düzeltir; düzeltilemiyorsa false. En çok 16 bozuk bayt. */
export function rsCorrect(code: Uint8Array): boolean {
  const s = syndromes(code);
  if (s.every((v) => v === 0)) return true;
  // Berlekamp–Massey: hata konum polinomu (düşük dereceden yükseğe).
  let locator = [1];
  let previous = [1];
  let length = 0;
  let shift = 1;
  let lastDiscrepancy = 1;
  for (let n = 0; n < PARITY; n++) {
    let d = s[n];
    for (let i = 1; i <= length; i++) d ^= mul(locator[i] ?? 0, s[n - i]);
    if (d === 0) {
      shift++;
      continue;
    }
    const scale = mul(d, inv(lastDiscrepancy));
    const next = locator.slice();
    for (let i = 0; i < previous.length; i++) next[i + shift] = (next[i + shift] ?? 0) ^ mul(scale, previous[i]);
    if (2 * length <= n) {
      length = n + 1 - length;
      previous = locator;
      lastDiscrepancy = d;
      shift = 1;
    } else {
      shift++;
    }
    locator = next;
  }
  if (length > PARITY / 2) return false;
  // Chien: Λ(α^-p) = 0 ise sağdan p. konumda hata var.
  const powers: number[] = [];
  for (let p = 0; p < code.length; p++) {
    let value = 0;
    for (let i = 0; i <= length; i++) value ^= mul(locator[i] ?? 0, EXP[(255 - p) * i % 255]);
    if (value === 0) powers.push(p);
  }
  if (powers.length !== length) return false;
  // Büyüklükler: S_j = Σ e_k · α^(p_k·j). Vandermonde sistemi, Gauss ile (en çok 16 bilinmeyen).
  const rows = powers.map((_, j) => [...powers.map((p) => EXP[(p * j) % 255]), s[j]]);
  for (let col = 0; col < length; col++) {
    const pivot = rows.findIndex((row, r) => r >= col && row[col] !== 0);
    if (pivot < 0) return false;
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    const scale = inv(rows[col][col]);
    rows[col] = rows[col].map((v) => mul(v, scale));
    for (let r = 0; r < length; r++) {
      if (r === col || rows[r][col] === 0) continue;
      const factor = rows[r][col];
      rows[r] = rows[r].map((v, i) => v ^ mul(factor, rows[col][i]));
    }
  }
  powers.forEach((p, k) => { code[code.length - 1 - p] ^= rows[k][length]; });
  return syndromes(code).every((v) => v === 0);
}

// ---- gönderme ------------------------------------------------------------------
function symbolsFor(payload: Uint8Array): number[][] {
  if (payload.length === 0 || payload.length > SOUND_MAX_BYTES) throw new Error(`a sound frame carries 1 to ${SOUND_MAX_BYTES} bytes`);
  const message = new Uint8Array(payload.length + 1);
  message[0] = payload.length;
  message.set(payload, 1);
  const parity = rsParity(message);
  const header = [payload.length, payload.length ^ 0xff];
  const bytes = [...Array.from({ length: HEADER_COPIES }, () => header).flat(), ...payload, ...parity];
  if (bytes.length % 2) bytes.push(0);
  const data: number[][] = [];
  for (let i = 0; i < bytes.length; i += 2) data.push([bytes[i] >> 4, bytes[i] & 15, bytes[i + 1] >> 4, bytes[i + 1] & 15]);
  return [...PREAMBLE, ...data];
}

/** Çerçevenin ses örnekleri (−1..1). Önünde ve arkasında kısa sessizlik vardır; döngüde çalınabilir. */
export function soundSamples(payload: Uint8Array, sampleRate: number): Float32Array {
  const symbols = symbolsFor(payload);
  const symbolLength = Math.round(SYMBOL_S * sampleRate);
  const toneLength = Math.round(TONE_S * sampleRate);
  const ramp = Math.round(RAMP_S * sampleRate);
  const lead = symbolLength;
  const out = new Float32Array(lead + symbols.length * symbolLength + 4 * symbolLength);
  symbols.forEach((tones, index) => {
    const start = lead + index * symbolLength;
    tones.forEach((tone, bank) => {
      const step = (2 * Math.PI * frequency(bank, tone)) / sampleRate;
      for (let n = 0; n < toneLength; n++) {
        const edge = Math.min(n, toneLength - 1 - n);
        const envelope = edge < ramp ? 0.5 - 0.5 * Math.cos((Math.PI * edge) / ramp) : 1;
        out[start + n] += AMPLITUDE * envelope * Math.sin(step * n);
      }
    });
  });
  return out;
}

/** Bir çerçevenin süresi, saniye; arayüzdeki "yaklaşık N saniye" için. */
export const soundSeconds = (bytes: number): number =>
  (PREAMBLE.length + Math.ceil((2 * HEADER_COPIES + bytes + PARITY) / 2) + 5) * SYMBOL_S;

// ---- dinleme -------------------------------------------------------------------
interface Decision { tones: number[]; quality: number }

/** Mikrofon örneklerini alır; bir çerçeve çözülünce baytlarını döndürür. */
export class SoundReceiver {
  private readonly window: Float32Array;
  private readonly coefficients: Float32Array;
  private readonly hop: number;
  private readonly symbolLength: number;
  private samples: Float32Array;
  private length = 0;
  /** samples[0]'ın akıştaki mutlak konumu. */
  private origin = 0;
  private nextHop = 0;
  private recent: Decision[] = [];
  private candidate: { score: number; at: number; left: number } | undefined;
  private frame: { start: number; symbols: number[][]; size: number; total: number | undefined } | undefined;
  /** 0..1: çözülmekte olan çerçevenin ne kadarı duyuldu. */
  progress = 0;

  constructor(sampleRate: number) {
    const size = Math.round(WINDOW_S * sampleRate);
    this.window = Float32Array.from({ length: size }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (size - 1)));
    this.coefficients = Float32Array.from({ length: BANKS * TONES }, (_, i) =>
      2 * Math.cos((2 * Math.PI * (BASE_HZ + i * SPACING_HZ)) / sampleRate));
    this.symbolLength = Math.round(SYMBOL_S * sampleRate);
    this.hop = Math.round(this.symbolLength / HOPS_PER_SYMBOL);
    this.samples = new Float32Array(Math.round(sampleRate * 12));
  }

  push(chunk: Float32Array): Uint8Array | undefined {
    this.append(chunk);
    for (;;) {
      if (this.frame) {
        const done = this.readFrame();
        if (done === "wait") return undefined;
        if (done) return done;
        continue; // çerçeve bozuktu: aramaya dön
      }
      if (this.nextHop + this.window.length > this.origin + this.length) return undefined;
      this.search();
    }
  }

  private append(chunk: Float32Array): void {
    if (this.length + chunk.length > this.samples.length) {
      // Aramada işlenmiş örnekler gerekmez (kararlar saklanır); çerçeve okunurken çerçevenin başı gerekir.
      const keepFrom = Math.min(this.frame ? this.frame.start : this.nextHop, this.origin + this.length);
      const drop = Math.max(0, keepFrom - this.origin);
      this.samples.copyWithin(0, drop, this.length);
      this.length -= drop;
      this.origin += drop;
      if (this.length + chunk.length > this.samples.length) { // 12 saniyeyi aşan çerçeve olmaz; yine de taşmasın
        this.origin += this.length;
        this.length = 0;
        this.frame = undefined;
        this.recent = [];
        this.nextHop = this.origin;
      }
    }
    this.samples.set(chunk.subarray(0, Math.min(chunk.length, this.samples.length - this.length)), this.length);
    this.length += Math.min(chunk.length, this.samples.length - this.length);
  }

  /** Her bantta en güçlü ton; kalite, enerjinin o tonda toplanma payı (4 bandın toplamı). */
  private decide(at: number): Decision {
    const offset = at - this.origin;
    const tones: number[] = [];
    let quality = 0;
    for (let bank = 0; bank < BANKS; bank++) {
      let best = 0;
      let bestPower = -1;
      let total = 0;
      for (let tone = 0; tone < TONES; tone++) {
        const coefficient = this.coefficients[bank * TONES + tone];
        let s1 = 0;
        let s2 = 0;
        for (let n = 0; n < this.window.length; n++) {
          const s0 = this.samples[offset + n] * this.window[n] + coefficient * s1 - s2;
          s2 = s1;
          s1 = s0;
        }
        const power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
        total += power;
        if (power > bestPower) {
          bestPower = power;
          best = tone;
        }
      }
      tones.push(best);
      quality += total > 0 ? bestPower / total : 0;
    }
    return { tones, quality };
  }

  private search(): void {
    const at = this.nextHop;
    this.nextHop += this.hop;
    this.recent.push(this.decide(at));
    const span = (PREAMBLE.length - 1) * HOPS_PER_SYMBOL;
    if (this.recent.length > span + 1) this.recent.shift();
    if (this.recent.length <= span) return;
    let matches = 0;
    let quality = 0;
    PREAMBLE.forEach((expected, i) => {
      const decision = this.recent[i * HOPS_PER_SYMBOL];
      quality += decision.quality;
      expected.forEach((tone, bank) => { if (decision.tones[bank] === tone) matches++; });
    });
    if (matches >= PREAMBLE_MIN_MATCHES) {
      const score = matches * 100 + quality;
      if (!this.candidate || score > this.candidate.score) this.candidate = { score, at, left: HOPS_PER_SYMBOL - 1 };
    }
    // Pencere ton içinde kaydıkça birkaç sıçrama tutar; en temizi (en yüksek puan) seçilir.
    if (this.candidate && this.candidate.left-- <= 0) {
      this.frame = { start: this.candidate.at + this.symbolLength, symbols: [], size: 0, total: undefined };
      this.candidate = undefined;
      this.recent = [];
      this.progress = 0;
    }
  }

  private readFrame(): Uint8Array | "wait" | undefined {
    const frame = this.frame!;
    const fail = (): undefined => {
      // Aynı örneklerde yeniden arama: sahte eşzamanlamadan hemen sonra gerçek çerçeve gelebilir.
      this.nextHop = frame.start;
      this.frame = undefined;
      this.progress = 0;
      return undefined;
    };
    for (;;) {
      const at = frame.start + frame.symbols.length * this.symbolLength;
      if (at + this.window.length > this.origin + this.length) return "wait";
      const { tones } = this.decide(at);
      frame.symbols.push(tones);
      if (frame.total === undefined && frame.symbols.length === HEADER_COPIES) {
        const bytes = frame.symbols.map(([a, b, c, d]) => [(a << 4) | b, (c << 4) | d]);
        const copy = bytes.find(([size, check]) => (size ^ 0xff) === check && size > 0 && size <= SOUND_MAX_BYTES);
        if (!copy) return fail();
        frame.size = copy[0];
        frame.total = HEADER_COPIES + Math.ceil((frame.size + PARITY) / 2);
      }
      if (frame.total !== undefined) this.progress = frame.symbols.length / frame.total;
      if (frame.total !== undefined && frame.symbols.length === frame.total) {
        const { size } = frame;
        const bytes = frame.symbols.slice(HEADER_COPIES).flatMap(([a, b, c, d]) => [(a << 4) | b, (c << 4) | d]);
        const code = new Uint8Array(1 + size + PARITY);
        code[0] = size;
        code.set(bytes.slice(0, size + PARITY), 1);
        if (!rsCorrect(code) || code[0] !== size) return fail();
        this.nextHop = at + this.symbolLength;
        this.frame = undefined;
        this.progress = 1;
        return code.slice(1, 1 + size);
      }
    }
  }
}

// ---- sesle teslim makbuzu ----------------------------------------------------------
/*
 * Kamerasız gönderen makbuzun QR'ını okuyamaz. Makbuzun gönderenin BİLMEDİĞİ yalnız
 * iki parçası vardır: alıcının imzası ve imza anı. Gerisini (oturum, içerik özeti,
 * boyut, iki açık anahtar, sevk kaydı) gönderen zaten bilir. Sesle yalnız bu iki
 * parça gider (77 bayt, yaklaşık 3,5 saniye); gönderen makbuzu kendi bildikleriyle
 * yeniden kurar ve alıcının imzasını doğrular. Alıcı başka bir dosya aldıysa ya da
 * araya biri girdiyse imza tutmaz. Yeni bir imza biçimi yoktur: doğrulanan, QR ile
 * dönen makbuzdaki imzanın aynısıdır.
 */
const RECEIPT_TAG = 0x52; // "R"
export const SOUND_RECEIPT_BYTES = 77;

export interface SoundReceipt { session: number; at: string; signature: Uint8Array<ArrayBuffer> }

export function packSoundReceipt(receipt: { session: number; at: string; signature: Uint8Array }): Uint8Array {
  const at = Date.parse(receipt.at);
  // Gönderen saati milisaniyeden geri kurar; aynı metin çıkmazsa imza tutmazdı.
  if (!Number.isFinite(at) || new Date(at).toISOString() !== receipt.at) throw new Error("the receipt time is not in the expected format");
  if (receipt.signature.length !== 64) throw new Error("the receipt signature must be 64 bytes");
  const out = new Uint8Array(SOUND_RECEIPT_BYTES);
  const view = new DataView(out.buffer);
  out[0] = RECEIPT_TAG;
  view.setUint32(1, receipt.session);
  view.setBigUint64(5, BigInt(at));
  out.set(receipt.signature, 13);
  return out;
}

export function unpackSoundReceipt(bytes: Uint8Array): SoundReceipt | undefined {
  if (bytes.length !== SOUND_RECEIPT_BYTES || bytes[0] !== RECEIPT_TAG) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const at = Number(view.getBigUint64(5));
  if (!Number.isSafeInteger(at) || at > 8.64e15) return undefined;
  return { session: view.getUint32(1), at: new Date(at).toISOString(), signature: new Uint8Array(bytes.subarray(13)) };
}

// ---- tarayıcı: hoparlör ve mikrofon ----------------------------------------------
/** Çerçeveyi hoparlörden döngüde çalar; durdurma işlevini döndürür. Kullanıcı tıklamasından çağrılmalı. */
export async function playSound(payload: Uint8Array): Promise<() => void> {
  const context = new AudioContext();
  await context.resume();
  const samples = soundSamples(payload, context.sampleRate);
  const buffer = context.createBuffer(1, samples.length, context.sampleRate);
  buffer.getChannelData(0).set(samples);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  source.connect(context.destination);
  source.start();
  return () => {
    source.stop();
    void context.close();
  };
}

/**
 * Mikrofonu dinler. Ses yalnız bu sayfada, bellekte çözülür: kaydedilmez,
 * saklanmaz, hiçbir yere gönderilmez. Durdurma işlevi mikrofonu kapatır.
 */
export async function listenSound(
  onFrame: (bytes: Uint8Array) => void,
  onProgress: (share: number, peak: number) => void,
): Promise<() => void> {
  // Tarayıcının konuşma için yaptığı iyileştirmeler (yankı ve gürültü bastırma,
  // otomatik kazanç) tonları bozar; üçü de kapatılır.
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const context = new AudioContext();
  await context.resume();
  const receiver = new SoundReceiver(context.sampleRate);
  const source = context.createMediaStreamSource(stream);
  // ponytail: ScriptProcessorNode kullanımdan kalkmış sayılır, ama file:// paketinde
  // ve katı CSP altında ek betik dosyası olmadan çalışan tek yol. Tarayıcılar
  // kaldırırsa AudioWorklet'e taşınır.
  const node = context.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < input.length; i++) peak = Math.max(peak, Math.abs(input[i]));
    const bytes = receiver.push(input);
    onProgress(receiver.progress, peak);
    if (bytes) onFrame(bytes);
  };
  // Düğüm ancak çıkışa bağlıyken çalışır; sıfır kazanç mikrofonun hoparlörden geri çalınmasını önler.
  const silent = context.createGain();
  silent.gain.value = 0;
  source.connect(node);
  node.connect(silent);
  silent.connect(context.destination);
  return () => {
    node.onaudioprocess = null;
    node.disconnect();
    source.disconnect();
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
  };
}
