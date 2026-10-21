/**
 * L2 — LT fountain code (Luby 2002), Robust Soliton dağılımı.
 * Encoder ve decoder komşu kümesini yalnızca `seed` + `k`'dan türetir;
 * bu yüzden çerçeveler kendi kendini tanımlar, manifest gerekmez.
 */

/** mulberry32 — 32-bit deterministik PRNG. Kripto için DEĞİL (kripto Faz 3, Web Crypto). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LtOptions {
  /** Robust soliton c: küçük = daha çok yüksek dereceli blok. */
  c?: number;
  /** Hedef başarısızlık olasılığı. */
  delta?: number;
  /** false: yalnız soyma (ölçüm karşılaştırması için; research/). Varsayılan true. */
  eliminate?: boolean;
}

export interface Range {
  /** Dahil başlangıç blok indeksi. */
  start: number;
  /** Hariç bitiş blok indeksi. */
  end: number;
}

export interface DecoderCheckpoint {
  v: 1;
  totalBytes: number;
  blockSize: number;
  recovered: { index: number; data: Uint8Array }[];
}

/** En yüksek bit sistematik (ham kaynak) bloğunu fountain seed'inden ayırır. */
export const SYSTEMATIC_FLAG = 0x80000000;
export const MAX_SOURCE_BLOCKS = 1_000_000;
/**
 * Soyma takılınca Gauss eliminasyonuna geçilen en çok bilinmeyen sayısı. Üstünde
 * soyma tek başına yeter (fountain akışı sürer); altında kalan birkaç blok için
 * yeni kare beklemek yerine eldeki denklemler çözülür.
 */
export const MAX_ELIMINATION = 256;

export function systematicSeed(index: number): number {
  if (!Number.isInteger(index) || index < 0 || index >= SYSTEMATIC_FLAG) throw new Error("geçersiz blok indeksi");
  return (SYSTEMATIC_FLAG | index) >>> 0;
}

export function systematicIndex(seed: number): number | null {
  return (seed & SYSTEMATIC_FLAG) !== 0 ? (seed & ~SYSTEMATIC_FLAG) >>> 0 : null;
}

/** Kümülatif Robust Soliton dağılımı. k başına bir kez hesaplanır. */
export class LtParams {
  readonly k: number;
  readonly cdf: Float64Array;
  private readonly scratch: Uint32Array;
  // parametre-property yok: node --experimental-strip-types desteklemiyor
  constructor(k: number, { c = 0.03, delta = 0.5 }: LtOptions = {}) {
    this.k = k;
    const rho = new Float64Array(k + 1);
    rho[1] = 1 / k;
    for (let i = 2; i <= k; i++) rho[i] = 1 / (i * (i - 1));

    const s = c * Math.log(k / delta) * Math.sqrt(k);
    const pivot = Math.max(1, Math.round(k / s));
    const tau = new Float64Array(k + 1);
    for (let i = 1; i < pivot; i++) tau[i] = s / (k * i);
    if (pivot <= k) tau[pivot] = (s * Math.log(s / delta)) / k;

    let z = 0;
    for (let i = 1; i <= k; i++) z += rho[i] + tau[i];
    this.cdf = new Float64Array(k + 1);
    let acc = 0;
    for (let i = 1; i <= k; i++) {
      acc += (rho[i] + tau[i]) / z;
      this.cdf[i] = acc;
    }
    this.scratch = new Uint32Array(k);
    for (let i = 0; i < k; i++) this.scratch[i] = i;
  }

  private degree(u: number): number {
    // ponytail: doğrusal tarama, k<~5000 için ölçülebilir maliyeti yok.
    // Darboğaz olursa ikili arama.
    for (let i = 1; i <= this.k; i++) if (u <= this.cdf[i]) return i;
    return this.k;
  }

  /** seed -> kaynak blok indeksleri. İki tarafta da aynı sonucu vermek ZORUNDA. */
  neighbors(seed: number): number[] {
    const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    rng(); // warm-up: ardışık seed'lerin ilk çıktısını dekorele et
    const d = this.degree(rng());
    const a = this.scratch;
    // Sonuç YALNIZCA seed'e bağlı olmalı: decoder çerçeveleri encoder'la aynı
    // sırada görmez. Scratch'i her çağrıda sıfırla — çağrı geçmişi sızmasın.
    for (let i = 0; i < this.k; i++) a[i] = i;
    // kısmi Fisher-Yates: ilk d eleman = tekrarsız örneklem
    for (let i = 0; i < d; i++) {
      const j = i + Math.floor(rng() * (this.k - i));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return Array.from(a.subarray(0, d));
  }
}

export function blockCount(totalBytes: number, blockSize: number): number {
  return Math.ceil(totalBytes / blockSize);
}

/** Sonsuz akış: gereken kadar çerçeve çek. */
export function* ltEncode(
  data: Uint8Array,
  blockSize: number,
  opts?: LtOptions,
): Generator<{ seed: number; payload: Uint8Array }> {
  const k = blockCount(data.length, blockSize);
  const p = new LtParams(k, opts);
  let seed = 1;
  for (;;) {
    const payload = new Uint8Array(blockSize);
    for (const idx of p.neighbors(seed)) {
      const src = data.subarray(idx * blockSize, (idx + 1) * blockSize);
      for (let i = 0; i < src.length; i++) payload[i] ^= src[i];
    }
    yield { seed, payload };
    seed = seed === SYSTEMATIC_FLAG - 1 ? 1 : seed + 1;
  }
}

/**
 * ARQ modu için kaynak bloklarını kimlikleriyle üretir. `ranges` verilmezse tüm
 * dosya; verilirse yalnızca alıcının istediği bloklar gönderilir.
 */
export function* systematicEncode(
  data: Uint8Array,
  blockSize: number,
  ranges: Range[] = [{ start: 0, end: blockCount(data.length, blockSize) }],
): Generator<{ seed: number; payload: Uint8Array }> {
  const k = blockCount(data.length, blockSize);
  for (const range of ranges) {
    const start = Math.max(0, Math.min(k, range.start | 0));
    const end = Math.max(start, Math.min(k, range.end | 0));
    for (let index = start; index < end; index++) {
      const payload = new Uint8Array(blockSize);
      payload.set(data.subarray(index * blockSize, Math.min(data.length, (index + 1) * blockSize)));
      yield { seed: systematicSeed(index), payload };
    }
  }
}

export class LtDecoder {
  readonly k: number;
  private readonly params: LtParams;
  private readonly recovered: (Uint8Array | undefined)[];
  private count = 0;
  // ponytail: seed -> bekleyen blok. Çözümde tüm bekleyenler taranır (O(pending)).
  // 1MB/700B ~ 1500 blokta ölçülemeyecek kadar ucuz; büyük k'da ters indeks ekle.
  private readonly pending = new Map<number, { nb: Set<number>; data: Uint8Array }>();
  /** Son eliminasyon denemesi: bilinmeyen ya da denklem sayısı değişmeden yeniden denenmez. */
  private eliminatedAt = { unknown: Infinity, pending: 0 };
  private readonly eliminates: boolean;

  readonly totalBytes: number;
  readonly blockSize: number;

  constructor(totalBytes: number, blockSize: number, opts?: LtOptions) {
    if (!Number.isInteger(totalBytes) || !Number.isInteger(blockSize) || totalBytes <= 0 ||
        totalBytes > 1024 * 1024 * 1024 || blockSize <= 0 || blockSize > 0xffff ||
        blockCount(totalBytes, blockSize) > MAX_SOURCE_BLOCKS) {
      throw new Error("decoder kaynak sınırı aşıldı");
    }
    this.totalBytes = totalBytes;
    this.blockSize = blockSize;
    this.k = blockCount(totalBytes, blockSize);
    this.params = new LtParams(this.k, opts);
    this.eliminates = opts?.eliminate !== false;
    this.recovered = new Array(this.k);
  }

  /** true = bu çerçeve ilerleme sağladı (fazlalık ölçümü için). */
  ingest(seed: number, payload: Uint8Array): boolean {
    if (this.done) return false;
    const data = payload.slice(0, this.blockSize);
    const sourceIndex = systematicIndex(seed);
    if (sourceIndex !== null) {
      if (sourceIndex >= this.k || this.recovered[sourceIndex]) return false;
      this.solve(sourceIndex, data);
      // Kareler her sırada gelebilir: yedekler önce bekleyip bloklar sonra gelirse de çözülmeli.
      this.eliminate();
      return true;
    }
    const nb = new Set<number>();
    for (const idx of this.params.neighbors(seed)) {
      const known = this.recovered[idx];
      if (known) xor(data, known);
      else nb.add(idx);
    }
    if (nb.size === 0) return false;
    if (nb.size > 1) {
      this.pending.set(seed, { nb, data });
      this.eliminate();
      return true;
    }
    const before = this.count;
    this.solve(nb.values().next().value as number, data);
    this.eliminate();
    return this.count > before;
  }

  /** Peeling: derece-1 bloğu çöz, bekleyenlerden düş, zinciri sürdür. */
  private solve(index: number, data: Uint8Array): void {
    const queue: [number, Uint8Array][] = [[index, data]];
    while (queue.length) {
      const [idx, block] = queue.pop()!;
      if (this.recovered[idx]) continue;
      this.recovered[idx] = block;
      this.count++;
      for (const [seed, p] of this.pending) {
        if (!p.nb.delete(idx)) continue;
        xor(p.data, block);
        if (p.nb.size <= 1) {
          this.pending.delete(seed);
          if (p.nb.size === 1) queue.push([p.nb.values().next().value as number, p.data]);
        }
      }
    }
  }

  /**
   * Soyma yalnız derecesi bire inen denklemle ilerler; birkaç blok kalınca,
   * elde yeterince denklem olsa bile takılabilir (kâğıtta birkaç kod okunamadığında
   * tam bu olur). O zaman kalan bilinmeyenler GF(2) üzerinde çözülür. Önce yalnız
   * bitlerle rütbe denenir (ucuz); tam rütbe çıkarsa yükler bir kez işlenir.
   */
  private eliminate(): void {
    const unknown = this.k - this.count;
    if (!this.eliminates || unknown === 0 || unknown > MAX_ELIMINATION || this.pending.size < unknown) return;
    const last = this.eliminatedAt;
    if (unknown >= last.unknown && this.pending.size < last.pending + Math.max(1, Math.ceil(unknown / 20))) return;
    this.eliminatedAt = { unknown, pending: this.pending.size };
    const columns: number[] = [];
    const column = new Map<number, number>();
    for (let i = 0; i < this.k; i++) if (!this.recovered[i]) { column.set(i, columns.length); columns.push(i); }
    const words = Math.ceil(unknown / 32);
    const equations = [...this.pending.values()];
    const bitsOf = (nb: Set<number>) => {
      const bits = new Uint32Array(words);
      for (const index of nb) { const c = column.get(index)!; bits[c >>> 5] |= 1 << (c & 31); }
      return bits;
    };
    const run = (withData: boolean): Uint8Array[] | null => {
      const rows = equations.map((e) => ({ bits: bitsOf(e.nb), data: withData ? e.data.slice() : e.data }));
      for (let c = 0; c < unknown; c++) {
        const w = c >>> 5, m = 1 << (c & 31);
        let r = c;
        while (r < rows.length && !(rows[r].bits[w] & m)) r++;
        if (r === rows.length) return null; // eksik rütbe: daha çok kare gerekir
        [rows[c], rows[r]] = [rows[r], rows[c]];
        const pivot = rows[c];
        for (let i = 0; i < rows.length; i++) {
          if (i === c || !(rows[i].bits[w] & m)) continue;
          for (let j = 0; j < words; j++) rows[i].bits[j] ^= pivot.bits[j];
          if (withData) xor(rows[i].data, pivot.data);
        }
      }
      return rows.slice(0, unknown).map((row) => row.data);
    };
    if (!run(false)) return;
    const solved = run(true)!;
    for (let c = 0; c < unknown; c++) this.solve(columns[c], solved[c]);
  }

  get progress(): number {
    return this.count / this.k;
  }
  get done(): boolean {
    return this.count === this.k;
  }

  /** ARQ geri kanalı için ardışık eksik blokları sıkıştırır. */
  missingRanges(): Range[] {
    const ranges: Range[] = [];
    let start = -1;
    for (let i = 0; i <= this.k; i++) {
      const missing = i < this.k && !this.recovered[i];
      if (missing && start < 0) start = i;
      if (!missing && start >= 0) {
        ranges.push({ start, end: i });
        start = -1;
      }
    }
    return ranges;
  }

  /** Kesinti sonrası devam için yalnızca çözülmüş kaynak blokları saklar. */
  checkpoint(): DecoderCheckpoint {
    const recovered: DecoderCheckpoint["recovered"] = [];
    for (let index = 0; index < this.k; index++) {
      const data = this.recovered[index];
      if (data) recovered.push({ index, data: data.slice() });
    }
    return { v: 1, totalBytes: this.totalBytes, blockSize: this.blockSize, recovered };
  }

  static fromCheckpoint(checkpoint: DecoderCheckpoint): LtDecoder {
    if (checkpoint.v !== 1 || checkpoint.totalBytes <= 0 || checkpoint.blockSize <= 0) {
      throw new Error("geçersiz decoder checkpoint'i");
    }
    const decoder = new LtDecoder(checkpoint.totalBytes, checkpoint.blockSize);
    for (const block of checkpoint.recovered) {
      if (!Number.isInteger(block.index) || block.index < 0 || block.index >= decoder.k || block.data.length !== decoder.blockSize) {
        throw new Error("checkpoint blok verisi geçersiz");
      }
      decoder.solve(block.index, block.data.slice());
    }
    return decoder;
  }

  result(): Uint8Array | null {
    if (!this.done) return null;
    const out = new Uint8Array(this.k * this.blockSize);
    for (let i = 0; i < this.k; i++) out.set(this.recovered[i]!, i * this.blockSize);
    return out.subarray(0, this.totalBytes);
  }
}

function xor(target: Uint8Array, other: Uint8Array): void {
  for (let i = 0; i < target.length; i++) target[i] ^= other[i];
}
