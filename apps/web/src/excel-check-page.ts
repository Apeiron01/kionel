/**
 * Excel hasarı denetimi sayfası (EN, TR, DE). Dosyalar bu sekmede okunur; hiçbir
 * şey yüklenmez. Mantık excel-damage.ts'de.
 */
import "./report.css";
import { compareFiles, countByKind, decode, parseCsv, scanOne, type Finding, type Kind } from "./excel-damage.ts";
import { csvCell } from "./transfer-log.ts";

const lang = document.documentElement.lang === "tr" ? "tr" : document.documentElement.lang === "de" ? "de" : "en";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const MAX_BYTES = 50 * 1024 * 1024;
const SHOWN = 500;

const KIND: Record<Kind, [string, string, string]> = {
  "gene-date": ["Gene name turned into a date", "Tarihe dönmüş gen adı", "Gensymbol als Datum"],
  date: ["Text turned into a date", "Tarihe dönmüş metin", "Text als Datum"],
  sci: ["Long number shown in scientific notation", "Bilimsel gösterime dönmüş uzun sayı", "Lange Zahl in wissenschaftlicher Schreibweise"],
  digits: ["Digits after the 15th lost", "15. haneden sonrası kaybolmuş", "Stellen nach der 15. verloren"],
  zeros: ["Leading zeros removed", "Baştaki sıfırlar silinmiş", "Führende Nullen entfernt"],
  encoding: ["Characters garbled (encoding)", "Bozuk karakter (kodlama)", "Zeichen verstümmelt (Kodierung)"],
  "number-format": ["Same number, written differently", "Aynı sayı, farklı yazılmış", "Gleiche Zahl, anders geschrieben"],
  spaces: ["Spaces changed", "Boşluk değişmiş", "Leerzeichen geändert"],
  changed: ["Value changed", "Değer değişmiş", "Wert geändert"],
  shape: ["Number of rows or columns changed", "Satır ya da sütun sayısı değişmiş", "Zeilen- oder Spaltenzahl geändert"],
};
const t = (en: string, tr: string, de: string) => (lang === "tr" ? tr : lang === "de" ? de : en);
const num = (n: number) => n.toLocaleString(lang);
const label = (kind: Kind) => KIND[kind][lang === "tr" ? 1 : lang === "de" ? 2 : 0];
/** Tahmin metinleri excel-damage.ts'de İngilizce; Türkçe ve Almanca sayfada çevrilir. */
const hint = (text: string) => lang === "en" ? text : text
  .replace(" (a decimal number)", t("", " (ondalık sayı)", " (eine Dezimalzahl)"))
  .replace(", or a well position or ratio", t("", ", ya da bir kuyu konumu veya oran", ", oder eine Well-Position oder ein Verhältnis"))
  .replace("(now ", t("", "(yeni adı ", "(heute "))
  .replace(/ rows$/, t("", " satır", " Zeilen")).replace(/ columns$/, t("", " sütun", " Spalten"));

interface Loaded { name: string; bytes: Uint8Array; text: string; utf8: boolean; rows: string[][]; delimiter: string }
const files: { after?: Loaded; original?: Loaded } = {};
let findings: Finding[] = [];

function status(text: string, ok: boolean): void {
  const box = $("xl-status");
  box.textContent = text;
  box.className = `evidence-status ${ok ? "is-ok" : "is-bad"}`;
  box.hidden = false;
}

const IDLE = {
  after: t("Drop the CSV to check, or click to choose", "Denetlenecek CSV'yi bırakın ya da tıklayıp seçin", "CSV zum Prüfen hier ablegen oder klicken"),
  original: t("Optional: drop the original file, before Excel", "İsteğe bağlı: özgün dosyayı, Excel'den önceki halini bırakın", "Optional: die Originaldatei vor Excel ablegen"),
};

async function load(slot: "after" | "original", file: File | undefined): Promise<void> {
  if (!file) return;
  const drop = $(`xl-${slot}-drop`);
  if (file.size > MAX_BYTES) {
    status(t(`${file.name} is larger than 50 MB; this check reads the whole file in the browser.`,
      `${file.name} 50 MB'tan büyük; bu denetim dosyanın tamamını tarayıcıda okur.`,
      `${file.name} ist größer als 50 MB; die Prüfung liest die ganze Datei im Browser.`), false);
    return;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { text, utf8 } = decode(bytes);
    files[slot] = { name: file.name, bytes, text, utf8, ...parseCsv(text) };
  } catch {
    status(t(`${file.name} could not be read. Try again.`, `${file.name} okunamadı. Yeniden deneyin.`, `${file.name} konnte nicht gelesen werden. Bitte erneut versuchen.`), false);
    return;
  }
  drop.classList.add("loaded");
  drop.querySelector("span")!.textContent = `✓ ${file.name} — ${t("drop another to replace", "değiştirmek için başka dosya bırakın", "zum Ersetzen eine andere ablegen")}`;
  $(`xl-${slot}-clear`).hidden = false;
  await run();
}

function clear(slot: "after" | "original"): void {
  const name = files[slot]?.name;
  delete files[slot];
  $<HTMLInputElement>(`xl-${slot}-file`).value = "";
  const drop = $(`xl-${slot}-drop`);
  drop.classList.remove("loaded");
  drop.querySelector("span")!.textContent = IDLE[slot];
  $(`xl-${slot}-clear`).hidden = true;
  if (files.after) void run();
  else { findings = []; $("xl-result").hidden = true; }
  status(t(`${name} removed.`, `${name} kaldırıldı.`, `${name} entfernt.`), true);
}

const sha256 = async (bytes: Uint8Array) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)), (b) => b.toString(16).padStart(2, "0")).join("");

async function run(): Promise<void> {
  const { after, original } = files;
  if (!after) {
    status(t("Now drop the file that went through Excel, above.", "Şimdi Excel'den geçmiş dosyayı yukarıya bırakın.", "Jetzt oben die Datei ablegen, die durch Excel gegangen ist."), true);
    return;
  }
  const cells = after.rows.reduce((sum, row) => sum + row.length, 0);
  const notes: string[] = [];
  if (!after.utf8) notes.push(t(" The file is not UTF-8: it was probably saved as \"CSV (Comma delimited)\", which uses the PC's legacy code page; characters outside it are lost.",
    " Dosya UTF-8 değil: büyük olasılıkla \"CSV (virgülle ayrılmış)\" olarak kaydedildi; bu, bilgisayarın eski kod sayfasını kullanır ve dışındaki karakterler kaybolur.",
    " Die Datei ist nicht UTF-8: Sie wurde vermutlich als \"CSV (Trennzeichen-getrennt)\" gespeichert, das die alte Codepage des PCs nutzt; Zeichen außerhalb gehen verloren."));
  if (original) {
    if (original.delimiter !== after.delimiter) notes.push(t(` The separator changed from "${original.delimiter}" to "${after.delimiter}".`,
      ` Ayırıcı "${original.delimiter}" yerine "${after.delimiter}" olmuş.`, ` Das Trennzeichen wurde von "${original.delimiter}" zu "${after.delimiter}".`));
    findings = compareFiles(original.rows, after.rows);
    const same = (await sha256(original.bytes)) === (await sha256(after.bytes));
    if (same) status(t("The two files are identical, byte for byte (same SHA-256). Excel did not change this file.",
      "İki dosya bayt bayt aynı (SHA-256 aynı). Excel bu dosyayı değiştirmemiş.",
      "Die beiden Dateien sind Byte für Byte gleich (gleicher SHA-256). Excel hat diese Datei nicht verändert."), true);
    else if (!findings.length) status(t("Every value is the same, but the files' bytes differ (quotes, line endings or encoding), so the SHA-256 changed.",
      "Bütün değerler aynı, ama dosyaların baytları farklı (tırnak, satır sonu ya da kodlama); SHA-256 değişmiş.",
      "Alle Werte sind gleich, aber die Bytes unterscheiden sich (Anführungszeichen, Zeilenenden oder Kodierung); der SHA-256 hat sich geändert.") + notes.join(""), true);
    else status(t(`${findings.length} differences from the original, in ${num(cells)} cells. Each is listed below with the likely reason.`,
      `Özgünden ${findings.length} fark var (${num(cells)} hücre). Her biri olası nedeniyle aşağıda.`,
      `${findings.length} Abweichungen vom Original in ${num(cells)} Zellen. Jede steht unten mit der wahrscheinlichen Ursache.`) + notes.join(""), false);
  } else {
    findings = scanOne(after.rows);
    if (!findings.length) status(t(`No sign of Excel damage in ${num(cells)} cells. This looks for the usual traces; only a comparison with the original, or its SHA-256, proves the file is unchanged.`,
      `${num(cells)} hücrede Excel izi yok. Bu denetim bilinen izleri arar; dosyanın değişmediğini yalnız özgünüyle karşılaştırma ya da SHA-256'sı kanıtlar.`,
      `Keine Spur von Excel in ${num(cells)} Zellen. Die Prüfung sucht die üblichen Spuren; dass die Datei unverändert ist, beweist nur der Vergleich mit dem Original oder sein SHA-256.`) + notes.join(""), !notes.length);
    else status(t(`${findings.length} possible traces of Excel in ${num(cells)} cells. Without the original these are likely, not certain; add the original below to be sure.`,
      `${num(cells)} hücrede ${findings.length} olası Excel izi. Özgün dosya olmadan bunlar kesin değil, olası; emin olmak için özgününü aşağıya ekleyin.`,
      `${findings.length} mögliche Excel-Spuren in ${num(cells)} Zellen. Ohne das Original sind sie wahrscheinlich, nicht sicher; für Gewissheit unten das Original hinzufügen.`) + notes.join(""), false);
  }
  render(Boolean(original));
}

function render(compared: boolean): void {
  $("xl-result").hidden = !findings.length;
  if (!findings.length) return;
  const summary = $("xl-summary");
  summary.replaceChildren(...Object.entries(countByKind(findings)).map(([kind, n]) =>
    Object.assign(document.createElement("li"), { textContent: `${label(kind as Kind)}: ${n}` })));
  const table = $<HTMLTableElement>("xl-table");
  const head = document.createElement("tr");
  for (const name of [t("Row", "Satır", "Zeile"), t("Column", "Sütun", "Spalte"), t("Now", "Şimdi", "Jetzt"),
    compared ? t("Original", "Özgün", "Original") : t("Probably was", "Muhtemelen", "Vermutlich war"), t("What happened", "Ne olmuş", "Was passiert ist")]) {
    head.append(Object.assign(document.createElement("th"), { textContent: name }));
  }
  const body = findings.slice(0, SHOWN).map((f) => {
    const row = document.createElement("tr");
    for (const text of [f.row ? String(f.row) : "—", f.column, hint(f.value), hint(f.original ?? ""), label(f.kind)]) {
      row.append(Object.assign(document.createElement("td"), { textContent: text }));
    }
    return row;
  });
  table.replaceChildren(head, ...body);
  $("xl-more").textContent = findings.length > SHOWN
    ? t(`Showing the first ${SHOWN} of ${findings.length}. Download the list for all of them.`,
      `${findings.length} bulgunun ilk ${SHOWN} tanesi gösteriliyor. Tamamı için listeyi indirin.`,
      `Die ersten ${SHOWN} von ${findings.length} werden angezeigt. Für alle die Liste herunterladen.`)
    : "";
}

function download(): void {
  if (!findings.length) {
    status(t("Nothing to download: there are no findings.", "İndirilecek bir şey yok: bulgu yok.", "Nichts herunterzuladen: keine Befunde."), false);
    return;
  }
  const lines = [["row", "column", "value", "original", "finding"], ...findings.map((f) => [f.row, f.column, f.value, f.original ?? "", label(f.kind)])];
  const csv = `﻿${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`;
  const link = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
    download: `excel-check_${(files.after?.name ?? "file").replace(/\.[^.]+$/, "")}.csv`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  status(t(`${findings.length} findings downloaded as CSV (safe to open in Excel).`, `${findings.length} bulgu CSV olarak indirildi (Excel'de açmak güvenli).`,
    `${findings.length} Befunde als CSV heruntergeladen (sicher in Excel zu öffnen).`), true);
}

for (const slot of ["after", "original"] as const) {
  const input = $<HTMLInputElement>(`xl-${slot}-file`);
  const drop = $(`xl-${slot}-drop`);
  input.onchange = () => void load(slot, input.files?.[0]);
  drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (event) => {
    event.preventDefault();
    drop.classList.remove("is-over");
    void load(slot, event.dataTransfer?.files[0]);
  });
  $(`xl-${slot}-clear`).onclick = () => clear(slot);
}
$("xl-download").onclick = download;
