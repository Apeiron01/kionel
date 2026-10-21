/**
 * Kanıt görünümü: bir teslim makbuzunu veya sevk kaydını tarayıcıda doğrular,
 * sonucu insanın okuyacağı cümlelere çevirir ve yazdırılabilir rapor üretir.
 *
 * Denetçi JSON okumaz. Rapor imzalı kayıtların yerine geçmez — kanıt kayıtların
 * kendisidir — ama ne doğrulandığını tek sayfada, düz dille söyler.
 *
 * Doğrulama nedenleri kripto paketinden Türkçe gelir (komut satırı aracı
 * onları olduğu gibi yazar); burada İngilizce açıklamaya çevrilir.
 */
import {
  isReceiptV2, receiptHash, unb64, verifyDispatch, verifyReceipt,
  type Bytes, type Dispatch, type Receipt,
} from "@kionel/crypto";
import { DIGICERT_TRUSTED_ROOT_G4, anchorBytes, verifyTimestampWeb } from "@kionel/timestamp/web";
import "./report.css";

export type CheckState = "ok" | "fail" | "skip";
export interface Check { label: string; state: CheckState; detail: string }
export interface EvidenceReport {
  kind: "receipt" | "dispatch" | "unknown";
  ok: boolean;
  headline: string;
  checks: Check[];
  facts: [string, string][];
}

const REASONS: Record<string, string> = {
  "makbuz biçimi veya alan sınırları geçersiz": "this is not a Kionel receipt, or one of its fields was edited",
  "alıcı imzası geçersiz": "the receiver's signature does not match — the receipt was changed after it was signed",
  "sevk kaydı makbuzla tutarsız": "the dispatch record inside does not match the receipt",
  "gönderen imzası geçersiz": "the sender's signature does not match — the dispatch record was changed after it was signed",
  "boyut uyuşmuyor": "the selected file has a different size from the file that was transferred",
  "içerik hash'i uyuşmuyor": "the selected file is not the file that was transferred (its SHA-256 differs)",
  "sevk kaydı biçimi veya alan sınırları geçersiz": "this is not a Kionel dispatch record, or one of its fields was edited",
};
const CONTENT_REASONS = new Set(["boyut uyuşmuyor", "içerik hash'i uyuşmuyor"]);

/** Bilinmeyen bir neden sessizce yutulmaz; olduğu gibi gösterilir. */
export const explainReason = (reason: string): string => REASONS[reason] ?? reason;

const hex = (b64url: string): string => {
  try { return Array.from(unb64(b64url), (b) => b.toString(16).padStart(2, "0")).join(""); } catch { return b64url; }
};
const size = (n: number) => (n < 1024 ? `${n} bytes` : `${(n / 1024).toFixed(1)} KB (${n} bytes)`);
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function facts(record: Dispatch | Receipt, fileName?: string): [string, string][] {
  const context = "dispatch" in record && record.dispatch?.context ? record.dispatch.context : record.context;
  const rows: [string, string][] = [];
  if (fileName) rows.push(["File checked", fileName]);
  rows.push(["Size", size(record.bytes)], ["SHA-256", hex(record.hash)]);
  if (context?.reference) rows.push(["Work order / reference", context.reference]);
  if (context?.classification) rows.push(["Classification", context.classification]);
  if (context?.note) rows.push(["Target system", context.note]);
  if (context?.operator) rows.push(["Operator (declared)", context.operator]);
  const dispatchAt = "receiver" in record ? record.dispatch?.at : record.at;
  if (dispatchAt) rows.push(["Sent at (device clock)", dispatchAt]);
  if ("receiver" in record) rows.push(["Received at (device clock)", record.at]);
  rows.push(["Sender device key", record.sender]);
  if ("receiver" in record) rows.push(["Receiver device key", record.receiver]);
  rows.push(["Transfer session", String(record.session)]);
  return rows;
}

export async function inspectEvidence(value: unknown, content?: Bytes, fileName?: string): Promise<EvidenceReport> {
  const unknown = (headline: string): EvidenceReport => ({ kind: "unknown", ok: false, headline, checks: [], facts: [] });
  if (!isObject(value)) return unknown("Not valid: this file is not a Kionel receipt or dispatch record.");
  if (isReceiptV2(value)) {
    return unknown("This is an enterprise (v2) receipt. Verify it with the command-line verifier, which also checks timestamps.");
  }

  const contentCheck = (failed: string | undefined): Check => !content
    ? { label: "File content", state: "skip", detail: "Not checked — add the original file to confirm it is the one that was transferred." }
    : failed
      ? { label: "File content", state: "fail", detail: explainReason(failed) }
      : { label: "File content", state: "ok", detail: "The file matches the signed SHA-256 and size." };

  if ("receiver" in value) {
    const receipt = value as unknown as Receipt;
    const verdict = await verifyReceipt(receipt, content);
    const time = await trustedTime(receipt);
    const receiverOk = verdict.signers.includes("alıcı");
    const senderOk = verdict.signers.includes("gönderen");
    const contentFailed = !verdict.ok && CONTENT_REASONS.has(verdict.reason) ? verdict.reason : undefined;
    const checks: Check[] = [
      { label: "Delivery signature (receiving device)", state: receiverOk ? "ok" : "fail",
        detail: receiverOk ? "Valid. The receipt has not been changed since the receiver signed it." : explainReason(verdict.reason) },
      receipt.dispatch
        ? { label: "Dispatch signature (sending device)", state: senderOk ? "ok" : receiverOk ? "fail" : "skip",
          detail: senderOk ? "Valid, and consistent with the receipt." : receiverOk ? explainReason(verdict.reason) : "Not checked — the receipt itself failed." }
        : { label: "Dispatch signature (sending device)", state: "skip", detail: "Not included: this receipt is signed by the receiver only." },
      contentCheck(contentFailed),
      time.check,
    ];
    const ok = verdict.ok && time.check.state !== "fail";
    const rows = isObject(receipt) && typeof receipt.hash === "string" && typeof receipt.bytes === "number" ? facts(receipt, fileName) : [];
    if (time.at) rows.push([`Trusted time (${time.authority})`, time.at]);
    return {
      kind: "receipt",
      ok,
      headline: ok
        ? `Valid: this delivery receipt is intact and signed by ${senderOk ? "both devices" : "the receiving device"}.` +
          `${content ? " The file matches." : ""}${time.at ? ` An independent authority confirms it existed at ${time.at}.` : ""}`
        : verdict.ok ? `Not valid: ${time.check.detail}` : `Not valid: ${explainReason(verdict.reason)}.`,
      checks,
      facts: rows,
    };
  }

  if ("sig" in value && "hash" in value) {
    const dispatch = value as unknown as Dispatch;
    const verdict = await verifyDispatch(dispatch, content);
    const signed = verdict.ok || CONTENT_REASONS.has(verdict.reason);
    return {
      kind: "dispatch",
      ok: verdict.ok,
      headline: verdict.ok
        ? `Valid: this dispatch record is intact and signed by the sending device.${content ? " The file matches." : ""}`
        : `Not valid: ${explainReason(verdict.reason)}.`,
      checks: [
        { label: "Dispatch signature (sending device)", state: signed ? "ok" : "fail",
          detail: signed ? "Valid. The record has not been changed since the sender signed it." : explainReason(verdict.reason) },
        { label: "Delivery receipt", state: "skip", detail: "A dispatch record proves what was sent, not what arrived. The receiver's receipt proves delivery." },
        contentCheck(!verdict.ok && CONTENT_REASONS.has(verdict.reason) ? verdict.reason : undefined),
      ],
      facts: typeof dispatch.hash === "string" && typeof dispatch.bytes === "number" ? facts(dispatch, fileName) : [],
    };
  }
  return unknown("Not valid: this JSON file is not a Kionel receipt or dispatch record.");
}

/**
 * Makbuza iliştirilen RFC 3161 damgası: makbuzun (iki imzasıyla birlikte) o anda
 * var olduğunu bağımsız bir otorite söyler. Damga makbuzun imzalı baytlarına
 * dokunmaz; bu tarayıcıda DigiCert köküne kadar doğrulanır.
 */
async function trustedTime(receipt: Receipt): Promise<{ check: Check; at?: string; authority?: string }> {
  const tst = (receipt as Receipt & { tst?: unknown }).tst;
  const label = "Trusted time (independent timestamp)";
  if (tst === undefined) {
    return { check: { label, state: "skip", detail: "Not included: the times shown are the devices' own clocks." } };
  }
  const bad = (detail: string) => ({ check: { label, state: "fail" as const, detail } });
  if (!isObject(tst) || typeof tst.token !== "string" || typeof tst.at !== "string") return bad("the timestamp attached to this receipt is malformed.");
  let token: Uint8Array;
  try { token = Uint8Array.from(atob(tst.token), (c) => c.charCodeAt(0)); } catch { return bad("the timestamp attached to this receipt is malformed."); }
  let imprint: Uint8Array;
  try { imprint = await receiptHash(receipt); } catch { return bad("the receipt could not be hashed for the timestamp check."); }
  const verdict = await verifyTimestampWeb(token, imprint, [anchorBytes(DIGICERT_TRUSTED_ROOT_G4)]);
  if (!verdict.ok) {
    return bad(verdict.code === "imprint-mismatch"
      ? "the attached timestamp belongs to a different receipt."
      : `the attached timestamp did not verify (${verdict.code}).`);
  }
  const at = `${verdict.at.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")} UTC`;
  // Okunabilir kopya jetonla çelişiyorsa dosya elle düzenlenmiştir; jeton geçerli olsa da bu bir bulgudur.
  if (tst.at !== verdict.at.toISOString()) return bad("the readable time next to the timestamp was edited; it no longer matches the signed token.");
  const authority = verdict.authority.startsWith("DigiCert") ? "DigiCert" : verdict.authority;
  return {
    check: { label, state: "ok", detail: `${at}, signed by ${verdict.authority}. The receipt, with both signatures, existed at that time.` },
    at,
    authority,
  };
}

// ---- ekrana ve kâğıda -----------------------------------------------------------

function printCodeFigure(code: PrintCode): HTMLElement {
  const figure = document.createElement("figure");
  figure.className = "report-code";
  const img = document.createElement("img");
  img.src = code.image;
  img.alt = "Machine-readable code of this signed record";
  figure.append(img, Object.assign(document.createElement("figcaption"), { textContent: code.caption }));
  return figure;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

const STATE_LABEL: Record<CheckState, string> = { ok: "✓ Pass", fail: "✗ Fail", skip: "— Not checked" };

/** Sonucu verilen kaba çizer; ekranda ve yazdırmada aynı içerik. */
export function renderEvidence(report: EvidenceReport, target: HTMLElement): void {
  const status = el("p", report.headline, `evidence-status ${report.ok ? "is-ok" : "is-bad"}`);
  status.setAttribute("role", "status");
  const children: HTMLElement[] = [status];
  if (report.checks.length) {
    const table = el("table", undefined, "evidence-table");
    for (const check of report.checks) {
      const row = table.insertRow();
      row.append(el("th", check.label), el("td", STATE_LABEL[check.state], `state-${check.state}`), el("td", check.detail));
    }
    children.push(table);
  }
  if (report.facts.length) {
    const dl = el("dl", undefined, "evidence-facts");
    for (const [name, value] of report.facts) dl.append(el("dt", name), el("dd", value));
    children.push(dl);
  }
  target.replaceChildren(...children);
}

/**
 * Tarayıcının yazdırma penceresini açar; "PDF olarak kaydet" oradan seçilir.
 * Ayrı bir PDF kütüphanesi yok: tarayıcının yazdırması her dili ve yazı tipini
 * doğru basar, kendi PDF yazıcımız basmazdı.
 */
/** Rapora eklenen makine okunur kod: kâğıttaki kayıt sonradan bir kamerayla okunabilir. */
export interface PrintCode { image: string; caption: string }

export function printEvidence(report: EvidenceReport, title?: string, code?: PrintCode): void {
  document.getElementById("print-report")?.remove();
  const sheet = el("section");
  sheet.id = "print-report";
  const body = el("div");
  renderEvidence(report, body);
  sheet.append(
    el("p", "KIONEL · TRANSFER EVIDENCE REPORT", "report-eyebrow"),
    el("h1", title ?? (report.kind === "dispatch" ? "Dispatch record" : "Delivery receipt")),
    el("p", `Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC in the browser, without a network. ` +
      "The signed JSON records are the evidence; this page summarises what was verified.", "report-note"),
    body,
    ...(code ? [printCodeFigure(code)] : []),
    el("p", "Times are device clock times, not trusted timestamps. Anyone can repeat this check offline: " +
      "open kionel.com/verify.html or run the free command-line verifier (Apache-2.0).", "report-note"),
  );
  document.body.append(sheet);
  document.body.classList.add("printing-report");
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-report"), { once: true });
  window.print();
}
