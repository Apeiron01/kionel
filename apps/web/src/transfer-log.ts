/**
 * Aktarım günlüğü: bu cihazın gönderdiği, aldığı ve mühürlediği her dosya,
 * imzalı kaydıyla birlikte. Dönemsel denetim kaydı incelemesi (Annex 11,
 * Part 11) bunun üzerinden yapılır: CSV dışa aktarım ve yazdırılabilir rapor.
 *
 * Günlükteki her satır imzalı bir kayıttan türetilir; kayıt da satırla birlikte
 * saklanır, böylece raporda görünen her şey kayda karşı doğrulanabilir.
 * Burada DOM ve depolama yok: saf fonksiyonlar, birim testli.
 */
import { unb64, type Dispatch, type Receipt } from "@kionel/crypto";

export type LogKind = "sent" | "received" | "sealed";
export interface LogEntry {
  kind: LogKind;
  /** Olayın bu cihazdaki zamanı (ISO). İmzalı kayıttaki zaman ayrıca `record` içindedir. */
  at: string;
  file: string;
  bytes: number;
  sha256: string;
  reference?: string;
  classification?: string;
  target?: string;
  /** Gönderenin beyan ettiği operatör (imzalı kayıttan). */
  operator?: string;
  /** Karşı tarafın cihaz anahtarı (gönderende alıcı bilinmez). */
  peer?: string;
  /** Güvenilir zaman damgası varsa okunabilir zamanı. */
  trustedTime?: string;
  /** Aktarım anında etkin site politikası (ad ve revizyon); yoksa boş. */
  policy?: string;
  record: Dispatch | Receipt;
}

export const LOG_LIMIT = 10_000;

const hex = (b64url: string): string => {
  try { return Array.from(unb64(b64url), (b) => b.toString(16).padStart(2, "0")).join(""); } catch { return b64url; }
};

/** İmzalı kayıttan günlük satırı. Alanlar yalnız kayıttan alınır; elle girilen bir şey yok. */
export function entryFor(kind: LogKind, file: string, record: Dispatch | Receipt, at = new Date(), policy?: string): LogEntry {
  const receipt = "receiver" in record ? record : undefined;
  const dispatch = receipt ? receipt.dispatch : record as Dispatch;
  const context = dispatch?.context;
  const tst = (record as { tst?: { at?: unknown } }).tst;
  return {
    kind, at: at.toISOString(), file, bytes: record.bytes, sha256: hex(record.hash),
    ...(context?.reference ? { reference: context.reference } : {}),
    ...(context?.classification ? { classification: context.classification } : {}),
    ...(context?.note ? { target: context.note } : {}),
    ...(context?.operator ? { operator: context.operator } : {}),
    ...(receipt ? { peer: receipt.sender } : {}),
    ...(typeof tst?.at === "string" ? { trustedTime: tst.at } : {}),
    ...(policy ? { policy } : {}),
    record,
  };
}

/** [from, to] gün aralığı, yerel takvimle; to günün sonuna kadar dahil. */
export function inPeriod(entries: LogEntry[], from?: string, to?: string): LogEntry[] {
  const start = from ? new Date(`${from}T00:00:00`).getTime() : -Infinity;
  const end = to ? new Date(`${to}T23:59:59.999`).getTime() : Infinity;
  return entries.filter((entry) => {
    const at = new Date(entry.at).getTime();
    return at >= start && at <= end;
  });
}

/**
 * Excel'de açılacak: =, +, -, @ (ve sekme/CR) ile başlayan hücre formül sayılabilir.
 * Önüne ' konur (OWASP CSV injection önerisi); tırnak ve ayırıcılar kaçışlanır.
 */
export function csvCell(value: unknown): string {
  let text = value === undefined || value === null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const COLUMNS: [string, (entry: LogEntry) => unknown][] = [
  ["time", (e) => e.at], ["event", (e) => e.kind], ["file", (e) => e.file], ["bytes", (e) => e.bytes],
  ["sha256", (e) => e.sha256], ["work_order", (e) => e.reference], ["classification", (e) => e.classification],
  ["target_system", (e) => e.target], ["peer_device_key", (e) => e.peer], ["trusted_time", (e) => e.trustedTime], ["site_policy", (e) => e.policy], ["operator", (e) => e.operator],
];

export function toCsv(entries: LogEntry[]): string {
  const rows = [COLUMNS.map(([name]) => name).join(","), ...entries.map((entry) => COLUMNS.map(([, get]) => csvCell(get(entry))).join(","))];
  // Excel UTF-8'i BOM ile tanır; yoksa ş, ğ, µ bozuk görünür.
  return `﻿${rows.join("\r\n")}\r\n`;
}

export function summary(entries: LogEntry[]): { sent: number; received: number; sealed: number; timestamped: number } {
  return {
    sent: entries.filter((e) => e.kind === "sent").length,
    received: entries.filter((e) => e.kind === "received").length,
    sealed: entries.filter((e) => e.kind === "sealed").length,
    timestamped: entries.filter((e) => e.trustedTime).length,
  };
}

// ---- yazdırılabilir gözden geçirme raporu (DOM) ------------------------------------

const cell = (tag: "td" | "th", text: string, className?: string) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
};

/** Dönemsel inceleme raporu: satırlar, özet ve kalite biriminin imza alanları. */
export function reviewReport(entries: LogEntry[], meta: { from?: string; to?: string; device: string }): HTMLElement {
  const sheet = document.createElement("section");
  sheet.id = "print-report";
  const p = (text: string, className?: string) => Object.assign(document.createElement("p"), { textContent: text, className: className ?? "" });
  const counts = summary(entries);
  const period = `${meta.from || "the first entry"} to ${meta.to || "today"}`;
  const title = document.createElement("h1");
  title.textContent = "Transfer log — periodic review";
  const table = document.createElement("table");
  table.className = "log-table";
  const head = document.createElement("tr");
  for (const name of ["Time", "Event", "File", "Bytes", "SHA-256", "Work order", "Class.", "Target", "Operator", "Trusted time"]) head.append(cell("th", name));
  table.append(head);
  for (const e of entries) {
    const row = document.createElement("tr");
    row.append(cell("td", new Date(e.at).toLocaleString()), cell("td", e.kind), cell("td", e.file), cell("td", String(e.bytes)),
      cell("td", e.sha256, "hash"), cell("td", e.reference ?? ""), cell("td", e.classification ?? ""), cell("td", e.target ?? ""), cell("td", e.operator ?? ""),
      cell("td", e.trustedTime ? e.trustedTime.replace("T", " ").replace(/\.\d+Z$/, " UTC") : ""));
    table.append(row);
  }
  const sign = document.createElement("table");
  sign.className = "log-table sign";
  for (const role of ["Reviewed by", "Signature", "Date", "Findings / comments"]) {
    const row = document.createElement("tr");
    row.append(cell("th", role), cell("td", ""));
    sign.append(row);
  }
  sheet.append(
    p("KIONEL · TRANSFER LOG", "report-eyebrow"), title,
    p(`Period: ${period}. Device key: ${meta.device}. Generated ${new Date().toLocaleString()} in the browser; nothing was uploaded.`, "report-note"),
    p(`${entries.length} entries: ${counts.sent} sent, ${counts.received} received, ${counts.sealed} sealed; ${counts.timestamped} with a trusted timestamp.`),
    table,
    p("Each line comes from a signed record kept on this device, downloadable with the log as JSON. Any record can be checked independently at kionel.com/verify.html or with the offline verifier. Times are this device's clock unless a trusted time is shown.", "report-note"),
    sign,
  );
  return sheet;
}
