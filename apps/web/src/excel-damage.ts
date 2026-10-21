/**
 * Excel hasarı denetimi: bir CSV'de Excel'in açıp kaydetmesinin bıraktığı izleri
 * bulur (tarihe dönmüş gen adları ve kuyu konumları, bilimsel gösterime dönmüş
 * uzun kimlikler, 15 haneden sonrası sıfırlanmış sayılar, silinmiş baştaki
 * sıfırlar, bozuk karakterler). Özgün dosya da verilirse hücre hücre karşılaştırır.
 *
 * Tek dosyada sonuç bir tahmindir ("olası"); iki dosyada kesindir. Sayfa bu farkı
 * söyler. Dosya tarayıcıdan çıkmaz. Saf fonksiyonlar, birim testli.
 */
export type Kind = "gene-date" | "date" | "sci" | "digits" | "zeros" | "encoding" | "number-format" | "spaces" | "changed" | "shape";

export interface Finding {
  /** Dosyadaki satır (başlık 1. satır). Biçim bulgularında 0. */
  row: number;
  column: string;
  value: string;
  kind: Kind;
  /** Özgün dosyadaki değer (karşılaştırmada) ya da olası özgün değer (tek dosyada). */
  original?: string;
}

// ---- okuma --------------------------------------------------------------------------

/** UTF-8 değilse Windows-1252 olarak okunur: Excel'in "CSV (Comma delimited)" kaydı eski kod sayfasıdır. */
export function decode(bytes: Uint8Array): { text: string; utf8: boolean } {
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^﻿/, ""), utf8: true };
  } catch {
    return { text: new TextDecoder("windows-1252").decode(bytes), utf8: false };
  }
}

/** Ayırıcı ilk satırdan seçilir: tırnak dışındaki virgül, noktalı virgül ve sekme sayılır. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in counts) counts[ch]++;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

/** RFC 4180: tırnaklı alan, alan içinde ayırıcı, satır sonu ve "" kaçışı. */
export function parseCsv(text: string): { rows: string[][]; delimiter: string } {
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return { rows, delimiter };
}

// ---- tek hücre örüntüleri -------------------------------------------------------------

// Excel'in kısa ay adları: İngilizce, Türkçe, Almanca. Anahtar küçük harf, değer ay numarası.
const MONTHS: Record<string, number> = Object.fromEntries([
  ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"],
  ["oca", "şub", "mar", "nis", "may", "haz", "tem", "ağu", "eyl", "eki", "kas", "ara"],
  ["jan", "feb", "mrz", "apr", "mai", "jun", "jul", "aug", "sep", "okt", "nov", "dez"],
].flatMap((names) => names.map((name, i) => [name, i + 1])));
// Excel'in "Genel" biçimi: en çok 6 anlamlı hane, üs 11 ve üstü. Ölçüm değerlerindeki 1.2E-05 gibi küçük sayılar dışarıda kalır.
const SCI = /^-?\d\.\d{1,5}E\+(1[1-9]|[2-9]\d)$/i;
const LETTERS = "A-Za-zÇĞİÖŞÜçğıöşüä";
// "1-Mar", "01.Ara", "2 Sep" (gün-ay) ve "Mar-01", "Sep-15" (ay-sayı).
const DAY_MONTH = new RegExp(`^(\\d{1,2})(-|\\. ?| )([${LETTERS}]{3})\\.?$`);
const MONTH_NUMBER = new RegExp(`^([${LETTERS}]{3})([-. ])(\\d{1,2})$`);
// UTF-8 baytlarının Windows-1252 diye okunmuş hali: ü → Ã¼, ı → Ä±, ş → ÅŸ, µ → Âµ, ° → Â°.
const MOJIBAKE = /Ã[\u0080-\u00BF]|Â[\u00A0-\u00BF]|Ä[\u0080-\u00BF\u0178\u0152\u0153]|Å[\u0080-\u00BF\u0178\u0161\u017E]|\uFFFD/;

/** Excel'in tarihe çevirdiği gen adlarının olası özgün hali (HGNC 2020 yeni adlarıyla). */
function geneFor(month: number, n: number): string | undefined {
  if (month === 3 && n >= 1 && n <= 11) return `MARCH${n} (now MARCHF${n})`;
  if (month === 9 && n >= 1 && n <= 15) return `SEPT${n} (now SEPTIN${n})`;
  if (month === 12 && n === 1) return "DEC1 (now DELEC1)";
  return undefined;
}

interface DateCell { month: number; n: number; separator: string; dayFirst: boolean }

function parseDate(value: string): DateCell | undefined {
  const dm = DAY_MONTH.exec(value);
  const m = dm ?? MONTH_NUMBER.exec(value);
  if (!m) return undefined;
  const [name, n] = dm ? [m[3], Number(m[1])] : [m[1], Number(m[3])];
  const month = MONTHS[name.toLocaleLowerCase("tr").replace("i̇", "i")] ?? MONTHS[name.toLowerCase()];
  return month ? { month, n, separator: m[2], dayFirst: Boolean(dm) } : undefined;
}

function dateLike(value: string): Kind | undefined {
  const d = parseDate(value);
  if (!d) return undefined;
  // Noktalı biçim Türkçe/Almanca Excel'in; orada "MARCH1" tarihe dönmez, "1.3" döner.
  return !d.separator.startsWith(".") && geneFor(d.month, d.n) ? "gene-date" : "date";
}

function guessOriginal(kind: Kind, value: string): string | undefined {
  const d = parseDate(value);
  if (!d) return undefined;
  if (kind === "gene-date") return geneFor(d.month, d.n);
  if (!d.dayFirst) return undefined;
  // "01.Ara" Türkçe/Almanca Excel'de 1.12 gibi noktalı bir ondalıktan; "2-Jan" İngilizce Excel'de 1-2 gibi bir kuyu konumu ya da orandan.
  return d.separator.startsWith(".") ? `${d.n}.${d.month} (a decimal number)` : `${d.month}-${d.n}, or a well position or ratio`;
}

/** Tek hücrede görülebilen hasar. Baştaki sıfırlar sütuna bakmayı gerektirir; orada ayrıca. */
function cellKind(value: string): Kind | undefined {
  if (MOJIBAKE.test(value)) return "encoding";
  if (SCI.test(value)) return "sci";
  // 16+ hane ve 15. haneden sonrası hep sıfır: Excel 15 anlamlı hane tutar.
  if (/^\d{16,}$/.test(value) && /^0+$/.test(value.slice(15))) return "digits";
  return dateLike(value);
}

// ---- tek dosya -----------------------------------------------------------------------

const columnName = (header: string[] | undefined, index: number) => header?.[index]?.trim() || `column ${index + 1}`;

/**
 * Yalnız hasar görmüş olabilecek dosya elimizdeyse: izleri arar. Kesin değil;
 * bulgular "olası" diye gösterilir.
 */
export function scanOne(rows: string[][]): Finding[] {
  const header = rows[0];
  const findings: Finding[] = [];
  rows.forEach((row, r) => row.forEach((value, c) => {
    const kind = cellKind(value.trim());
    if (kind) findings.push({ row: r + 1, column: columnName(header, c), value, kind, original: guessOriginal(kind, value.trim()) });
  }));
  // Baştaki sıfırlar: sütunun çoğu sıfırla doldurulmuş sabit uzunluktaysa, kısa kalan saf sayılar şüphelidir.
  const width = Math.max(0, ...rows.map((row) => row.length));
  for (let c = 0; c < width; c++) {
    const values = rows.slice(1).map((row) => (row[c] ?? "").trim()).filter(Boolean);
    const padded = values.filter((v) => /^0\d+$/.test(v));
    // Az satırlı dosyada da iş görsün: ya en az üç ve %30, ya da en az iki ve yarısı.
    const mostly = (padded.length >= 3 && padded.length >= values.length * 0.3) || (padded.length >= 2 && padded.length >= values.length * 0.5);
    if (!mostly) continue;
    const lengths = padded.map((v) => v.length).sort((a, b) => a - b);
    const usual = lengths[Math.floor(lengths.length / 2)];
    rows.forEach((row, r) => {
      const v = (row[c] ?? "").trim();
      if (r > 0 && /^[1-9]\d*$/.test(v) && v.length < usual) {
        findings.push({ row: r + 1, column: columnName(header, c), value: row[c], kind: "zeros", original: v.padStart(usual, "0") });
      }
    });
  }
  return findings.sort((a, b) => a.row - b.row);
}

// ---- iki dosya -----------------------------------------------------------------------

const numeric = (v: string) => v.trim() !== "" && Number.isFinite(Number(v.trim()));

function diffKind(original: string, after: string): Kind {
  const a = original.trim(), b = after.trim();
  if (a === b) return "spaces";
  if (/^0+\d/.test(a) && a.replace(/^0+(?=\d)/, "") === b) return "zeros";
  if (MOJIBAKE.test(b) && !MOJIBAKE.test(a)) return "encoding";
  if (/^\d{16,}$/.test(a) && (SCI.test(b) || /^\d+$/.test(b))) return "digits";
  if (SCI.test(b)) return "sci";
  const date = dateLike(b);
  if (date && !dateLike(a)) return date;
  if (numeric(a) && numeric(b) && Number(a) === Number(b)) return "number-format";
  return "changed";
}

/** Özgün dosya ile Excel'den geçmiş hali: her farklı hücre, nedeniyle. */
export function compareFiles(original: string[][], after: string[][]): Finding[] {
  const findings: Finding[] = [];
  const header = original[0];
  if (original.length !== after.length) {
    findings.push({ row: 0, column: "", value: `${after.length} rows`, original: `${original.length} rows`, kind: "shape" });
  }
  const widthA = Math.max(0, ...original.map((r) => r.length)), widthB = Math.max(0, ...after.map((r) => r.length));
  if (widthA !== widthB) findings.push({ row: 0, column: "", value: `${widthB} columns`, original: `${widthA} columns`, kind: "shape" });
  const rows = Math.min(original.length, after.length);
  for (let r = 0; r < rows; r++) {
    const width = Math.max(original[r].length, after[r].length);
    for (let c = 0; c < width; c++) {
      const a = original[r][c] ?? "", b = after[r][c] ?? "";
      if (a !== b) findings.push({ row: r + 1, column: columnName(header, c), value: b, original: a, kind: diffKind(a, b) });
    }
  }
  return findings;
}

/** Bulguları türüne göre sayar; sayfa özeti ve testler için. */
export function countByKind(findings: Finding[]): Partial<Record<Kind, number>> {
  const counts: Partial<Record<Kind, number>> = {};
  for (const f of findings) counts[f.kind] = (counts[f.kind] ?? 0) + 1;
  return counts;
}
