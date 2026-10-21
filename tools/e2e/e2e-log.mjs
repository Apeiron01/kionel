// "Şimdi çek, sonra oku": kayıt bir tarayıcıda çekilir, başka bir tarayıcıda
// (başka cihaz, sayfa yeniden açılmış) kod elle yazılarak okunur.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const payload = randomBytes(30_000);
writeFileSync(`${SP}/log.bin`, payload);
const want = createHash("sha256").update(payload).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-log-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(4000);
  await ev(`localStorage.setItem("kionel.flash-warning.v1", String(Date.now()))`);
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  return { ev, setFile, errors, send, close: () => { ws.close(); chrome.kill(); } };
}
// 1) Çekim anı
const a = await browser(9412);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.setFile("#file", `${SP}/log.bin`); await sleep(2000);
await a.ev(`document.getElementById("preset-record").click()`);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1500);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.ev(`document.getElementById("context-reference").value = "LATER-1"; document.getElementById("context-operator").value = "QC-017"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const b64 = await a.ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(30); const r = new MediaRecorder(s, { videoBitsPerSecond: 8000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = async () => { const buf = new Uint8Array(await new Blob(c).arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); resolve(btoa(bin)); }; r.start(500); setTimeout(() => r.stop(), 6000); })`);
writeFileSync(`${SP}/log.webm`, Buffer.from(b64, "base64"));
// Gönderen bir de mühürler (günlükte "sealed").
await a.ev(`document.getElementById("send-stop").click(); document.getElementById("seal-only").click()`); await sleep(1500);
const aSummary = await a.ev(`(async () => { const d = document.getElementById("transfer-log"); d.open = true; await new Promise((r) => setTimeout(r, 800)); return document.getElementById("log-summary").textContent; })()`);
check("gönderen günlüğü: 1 gönderim, 1 mühür", /^2 entries in this period: 1 sent, 0 received, 1 sealed/.test(aSummary), aSummary);
check("çekim kaydedildi", b64.length > 1000, `${Math.round(b64.length * 0.75 / 1024)} KB`);
a.close();

const note = (x) => x.ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
const b = await browser(9413);
// Lisanssız: günlük dışa aktarımı işletme özelliği
await b.ev(`document.getElementById("transfer-log").open = true`); await sleep(300);
await b.ev(`document.getElementById("log-csv").click()`); await sleep(500);
check("lisanssız: günlük dışa aktarımı işletme uyarısı", /needs a business licence/.test(await note(b)), (await note(b)).slice(0, 90));
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await b.ev(`document.querySelector('[data-read="file"]').click()`);
await b.ev(`document.getElementById("recording-code").value = "${code}"`);
await b.setFile("#record-open", `${SP}/log.webm`);
let res = "";
for (let i = 0; i < 40; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(res)) break; }
await sleep(1500);
await b.ev(`(() => { const d = document.getElementById("transfer-log"); d.open = false; d.open = true; })()`); await sleep(800);
const bSummary = await b.ev(`document.getElementById("log-summary").textContent`);
check("alıcı günlüğü: 1 teslim", /^1 entries in this period: 0 sent, 1 received, 0 sealed/.test(bSummary), bSummary);
// Boş dönem
await b.ev(`(() => { const f = document.getElementById("log-from"); f.value = "2020-01-01"; const t = document.getElementById("log-to"); t.value = "2020-01-02"; t.dispatchEvent(new Event("change")); })()`); await sleep(600);
await b.ev(`document.getElementById("log-csv").click()`); await sleep(500);
check("boş dönem: uyarı, dosya yok", /^warn: No transfers are recorded in this period/.test(await note(b)), (await note(b)).slice(0, 80));
await b.ev(`(() => { document.getElementById("log-from").value = ""; const t = document.getElementById("log-to"); t.value = ""; t.dispatchEvent(new Event("change")); })()`); await sleep(400);
// CSV indir
await b.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
await b.ev(`document.getElementById("log-csv").click()`);
let csvName = ""; const { readdirSync, readFileSync } = await import("node:fs");
for (let i = 0; i < 20 && !csvName; i++) { await sleep(500); csvName = readdirSync(SP).find((f) => /^kionel-transfer-log_.*\.csv$/.test(f)) ?? ""; }
const csv = csvName ? readFileSync(`${SP}/${csvName}`, "utf8") : "";
check("CSV indirildi: BOM, başlık, iş emri, SHA-256, operatör", csv.startsWith("﻿time,event,file,bytes,sha256,work_order") && /,received,.*,[0-9a-f]{64},LATER-1,.*,QC-017\r\n/.test(csv), csv.slice(0, 120).replace(/\r?\n/g, " | "));
check("CSV: olumlu mesaj", /^ok: 1 entries exported as CSV/.test(await note(b)));
// JSON: imzalı kayıt komut satırı doğrulayıcısından geçmeli
await b.ev(`document.getElementById("log-json").click()`);
let jsonName = "";
for (let i = 0; i < 20 && !jsonName; i++) { await sleep(500); jsonName = readdirSync(SP).find((f) => /^kionel-transfer-records_.*\.json$/.test(f)) ?? ""; }
const records = jsonName ? JSON.parse(readFileSync(`${SP}/${jsonName}`, "utf8")) : [];
writeFileSync(`${SP}/log-record.json`, JSON.stringify(records[0]?.record ?? {}));
const { execFileSync } = await import("node:child_process");
const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const cli = (() => { try { return execFileSync("node", ["--experimental-strip-types", "--no-warnings", `${root}apps/verify/verify.ts`, `${SP}/log-record.json`], { encoding: "utf8", cwd: root }); } catch (e) { return String(e.stdout ?? e); } })();
check("JSON'daki imzalı kayıt bağımsız doğrulanıyor", /^GEÇERLİ/.test(cli), cli.split("\n")[0]);
// Rapor
await b.ev(`window.print = () => { window.__printed = true; }`);
await b.ev(`document.getElementById("log-report").click()`); await sleep(800);
check("rapor: tablo satırı, özet ve imza alanları", await b.ev(`(() => { const r = document.getElementById("print-report"); return !!r && window.__printed === true && r.querySelectorAll(".log-table:not(.sign) tr").length === 2 && /1 received/.test(r.textContent) && /Reviewed by/.test(r.textContent) && /LATER-1/.test(r.textContent) && /QC-017/.test(r.textContent); })()`) === true);
check("JS hatası yok", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
b.close(); process.exit(fail ? 1 : 0);
