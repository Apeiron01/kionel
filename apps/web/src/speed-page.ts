/**
 * Hız hesaplayıcı: uygulamanın kendi süre formülleri (speed.ts), sitede.
 * Hiçbir şey yüklenmez; hesap bu sekmede yapılır.
 */
import { colourSeconds, liveSeconds, recordingSeconds } from "./speed.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const FREE_LIMIT = 5 * 1024 * 1024;
/** Metin dosyaları gönderilmeden önce küçülür; tahmin ihtiyatlı 4 kat varsayar. */
const TEXT_RATIO = 4;

const duration = (seconds: number) => {
  const s = Math.max(1, Math.round(seconds));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
};
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes % (1024 * 1024) ? 1 : 0)} MB` : `${Math.round(bytes / 1024)} KB`;

function rows(bytes: number, text: boolean): [string, string, string][] {
  const wire = Math.ceil(bytes / (text ? TEXT_RATIO : 1));
  const free = bytes <= FREE_LIMIT;
  return [
    ["Standard — the receiver reads live", duration(liveSeconds(wire)), free ? "Free" : "Business (over 5 MB)"],
    ["Fast — the receiver records the screen", duration(recordingSeconds(wire)), "Business"],
    ["Robust — colour code, the receiver records", duration(colourSeconds(wire)), "Business"],
  ];
}

function table(target: HTMLElement, head: string[], body: string[][]): void {
  const t = document.createElement("table");
  const tr = document.createElement("tr");
  for (const h of head) tr.append(Object.assign(document.createElement("th"), { textContent: h }));
  t.append(tr);
  for (const row of body) {
    const r = document.createElement("tr");
    for (const c of row) r.append(Object.assign(document.createElement("td"), { textContent: c }));
    t.append(r);
  }
  target.replaceChildren(t);
}

function calculate(): void {
  const value = Number($<HTMLInputElement>("calc-size").value);
  const unit = Number($<HTMLSelectElement>("calc-unit").value);
  const text = $<HTMLSelectElement>("calc-type").value === "text";
  if (!Number.isFinite(value) || value <= 0 || value * unit > 64 * 1024 * 1024) {
    $("calc-result").textContent = "Enter a size between 1 KB and 64 MB, the largest file Kionel accepts.";
    return;
  }
  const bytes = Math.round(value * unit);
  table($("calc-result"), ["Way of sending", "Estimated time", "Edition"], rows(bytes, text));
}

for (const id of ["calc-size", "calc-unit", "calc-type"]) $(id).addEventListener("input", calculate);
calculate();

const common = [100 * 1024, 1024 * 1024, 5 * 1024 * 1024, 20 * 1024 * 1024];
table($("calc-table"), ["File", "Live", "Recording", "Colour code"],
  common.flatMap((bytes) => [true, false].map((text) => {
    const [live, record, colour] = rows(bytes, text);
    return [`${size(bytes)} ${text ? "text (CSV, TXT)" : "PDF, image, ZIP"}`, live[1], record[1], colour[1]];
  })));
