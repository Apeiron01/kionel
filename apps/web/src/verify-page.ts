/**
 * Tarayıcıda makbuz doğrulama. Hiçbir şey yüklenmez: kayıt ve dosya bu
 * sekmede okunur, imzalar Web Crypto ile kontrol edilir. "Bize bağlı
 * değilsiniz" sözünün en kısa kanıtı budur.
 */
import type { Bytes } from "@kionel/crypto";
import { inspectEvidence, printEvidence, renderEvidence, type EvidenceReport } from "./evidence-view.ts";
import { reconcileLink, type LinkState } from "./reconcile.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let record: { value: unknown; name: string } | undefined;
let content: { data: Bytes; name: string } | undefined;
let last: EvidenceReport | undefined;

async function run(): Promise<void> {
  const result = $("verify-result");
  if (!record) {
    result.replaceChildren(Object.assign(document.createElement("p"), {
      textContent: "Add a receipt or dispatch record first (step 1).",
    }));
    $("verify-print").hidden = true;
    return;
  }
  last = await inspectEvidence(record.value, content?.data, content?.name);
  renderEvidence(last, result);
  $("verify-print").hidden = last.kind === "unknown";
}

function bindDrop(labelId: string, inputId: string, accept: (file: File) => Promise<string>, clear: () => void, after: () => Promise<void> = run): void {
  const label = $(labelId);
  const input = $<HTMLInputElement>(inputId);
  const idle = label.querySelector("span")!.textContent ?? "";
  // Etiketin içindeki düğme dosya seçiciyi açardı; kaldırma düğmesi etiketin yanında durur.
  const remove = Object.assign(document.createElement("button"), { type: "button", className: "button secondary drop-clear", textContent: "Remove", hidden: true });
  label.after(remove);
  remove.onclick = async () => {
    clear();
    input.value = "";
    label.classList.remove("loaded");
    label.querySelector("span")!.textContent = idle;
    remove.hidden = true;
    await after();
  };
  const take = async (file: File | undefined) => {
    if (!file) return;
    const text = await accept(file);
    label.classList.add("loaded");
    label.querySelector("span")!.textContent = text;
    remove.hidden = false;
    await after();
  };
  input.onchange = () => void take(input.files?.[0]);
  label.addEventListener("dragover", (event) => { event.preventDefault(); label.classList.add("is-over"); });
  label.addEventListener("dragleave", () => label.classList.remove("is-over"));
  label.addEventListener("drop", (event) => {
    event.preventDefault();
    label.classList.remove("is-over");
    void take(event.dataTransfer?.files[0]);
  });
}

bindDrop("record-drop", "record-file", async (file) => {
  let value: unknown = null;
  try { value = JSON.parse(await file.text()); } catch { /* inspectEvidence reddeder ve nedenini söyler */ }
  record = { value, name: file.name };
  return `✓ ${file.name} — drop another to replace`;
}, () => { record = undefined; });

bindDrop("content-drop", "content-file", async (file) => {
  content = { data: new Uint8Array(await file.arrayBuffer()) as Bytes, name: file.name };
  return `✓ ${file.name} — drop another to replace`;
}, () => { content = undefined; });

$("verify-print").onclick = () => { if (last) printEvidence(last); };

// ---- tek yönlü bağlantı mutabakatı: gönderenin ve alıcının kayıtları yan yana ----------
const link: { sent?: unknown; received?: unknown } = {};
const STATE_TEXT: Record<LinkState, string> = { delivered: "Delivered, receipt verified", missing: "No receipt", invalid: "Not verified" };
// ponytail: uzun dönemlerde ilk 500 satır gösterilir; eksikler en üsttedir, sayılar tam listedendir.
const LINK_ROWS = 500;

async function runLink(): Promise<void> {
  const status = $("link-status");
  const result = $("link-result");
  result.replaceChildren();
  status.hidden = false;
  if (link.sent === undefined || link.received === undefined) {
    status.className = "evidence-status is-bad";
    status.textContent = link.sent === undefined && link.received === undefined
      ? "Both files removed. Nothing was kept."
      : `Now add the ${link.sent === undefined ? "sender" : "receiver"}'s records.`;
    return;
  }
  try {
    const report = await reconcileLink(link.sent, link.received);
    const total = report.rows.length;
    const complete = report.delivered === total;
    status.className = `evidence-status ${complete ? "is-ok" : "is-bad"}`;
    status.textContent = (complete
      ? `All ${total} files in the sender's records have a verified receipt from the receiver.`
      : `${report.delivered} of ${total} files in the sender's records have a verified receipt. ${report.missing} have no receipt` +
        `${report.invalid ? `, ${report.invalid} could not be verified` : ""}. Send those again.`) +
      (report.unmatched ? ` ${report.unmatched} receipts are for files outside the sender's records, usually another period.` : "");
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    for (const title of ["File", "Sent", "Result", "Received"]) head.appendChild(Object.assign(document.createElement("th"), { textContent: title }));
    const body = table.createTBody();
    for (const row of report.rows.slice(0, LINK_ROWS)) {
      const line = body.insertRow();
      for (const text of [row.file, row.sentAt, row.reason ? `${STATE_TEXT[row.state]}: ${row.reason}` : STATE_TEXT[row.state], row.receivedAt ?? "—"]) line.insertCell().textContent = text;
      line.cells[2]!.className = row.state === "delivered" ? "ok" : "warn";
    }
    const scroll = Object.assign(document.createElement("div"), { className: "table-scroll" });
    scroll.append(table);
    result.append(scroll);
    if (total > LINK_ROWS) result.append(Object.assign(document.createElement("p"), { className: "note", textContent: `Showing the first ${LINK_ROWS} of ${total} files; files without a receipt come first.` }));
  } catch (error) {
    status.className = "evidence-status is-bad";
    status.textContent = (error as Error).message;
  }
}

const readRecords = (side: "sent" | "received") => async (file: File): Promise<string> => {
  // Okunamayan dosya boş değer olarak kalır; mutabakat nedenini söyler.
  try { link[side] = JSON.parse(await file.text()); } catch { link[side] = null; }
  return `✓ ${file.name} — drop another to replace`;
};
bindDrop("link-sent-drop", "link-sent-file", readRecords("sent"), () => { link.sent = undefined; }, runLink);
bindDrop("link-received-drop", "link-received-file", readRecords("received"), () => { link.received = undefined; }, runLink);
