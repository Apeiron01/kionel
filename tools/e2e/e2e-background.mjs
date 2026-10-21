// "Şimdi çek, sonra oku": kayıt bir tarayıcıda çekilir, başka bir tarayıcıda
// (başka cihaz, sayfa yeniden açılmış) kod elle yazılarak okunur.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const payload = randomBytes(30_000);
writeFileSync(`${SP}/bg.bin`, payload);
const want = createHash("sha256").update(payload).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-bg-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
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
  return { ev, setFile, errors, port, close: () => { ws.close(); chrome.kill(); } };
}
// 1) Çekim anı
const a = await browser(9402);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.setFile("#file", `${SP}/bg.bin`); await sleep(2000);
await a.ev(`document.getElementById("preset-record").click()`);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1500);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.ev(`document.getElementById("context-reference").value = "LATER-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const b64 = await a.ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(30); const r = new MediaRecorder(s, { videoBitsPerSecond: 8000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = async () => { const buf = new Uint8Array(await new Blob(c).arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); resolve(btoa(bin)); }; r.start(500); setTimeout(() => r.stop(), 6000); })`);
writeFileSync(`${SP}/bg.webm`, Buffer.from(b64, "base64"));
check("çekim kaydedildi", b64.length > 1000, `${Math.round(b64.length * 0.75 / 1024)} KB`);
{ const t = await a.ev(`document.getElementById("send-timer").textContent`); check("gönderen sayacı ilerliyor", /^Sending · 0:0[5-9]$/.test(t), t); }
a.close();

const note = (x) => x.ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
// 2) Okunurken sekme arka plana geçer (8 s, bekçinin 6 s sınırından uzun), sonra geri gelir.
const b = await browser(9403);
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await b.ev(`document.querySelector('[data-read="file"]').click()`);
await b.ev(`document.getElementById("recording-code").value = "${code}"`);
await b.ev(`document.getElementById("rec-video").playbackRate = 0.25`);
await b.setFile("#record-open", `${SP}/bg.webm`); await sleep(800);
const pages = async () => (await (await fetch(`http://127.0.0.1:${b.port}/json`)).json()).filter((x) => x.type === "page");
const reader = (await pages()).find((x) => /transfer\.html/.test(x.url));
const other = await (await fetch(`http://127.0.0.1:${b.port}/json/new?about:blank`, { method: "PUT" })).json();
await fetch(`http://127.0.0.1:${b.port}/json/activate/${other.id}`);
await sleep(8000);
const whileHidden = await b.ev(`[document.hidden, document.getElementById("rec-progress").textContent, document.getElementById("result").textContent].join(" | ")`);
check("arka planda: okuma duraklıyor, hata yok", /^true \| Paused: this page is in the background/.test(whileHidden) && !/could not be read/.test(await note(b)), whileHidden.slice(0, 120));
await fetch(`http://127.0.0.1:${b.port}/json/activate/${reader.id}`);
let res = "";
for (let i = 0; i < 40; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(res)) break; }
check("öne gelince kaldığı yerden sürüp teslim ediyor", /verified/.test(res), res.slice(0, 90) || await note(b));
b.close();
// 3) Kodu olmayan bir cihaz aynı kaydı açar.
const c = await browser(9404);
await c.setFile("#license-file", LICENSE); await sleep(1500);
await c.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await c.ev(`document.querySelector('[data-read="file"]').click()`);
await c.setFile("#record-open", `${SP}/bg.webm`);
let stats = "";
for (let i = 0; i < 40; i++) { await sleep(1000); stats = await c.ev(`document.getElementById("recv-stats").textContent`); if (/Kionel codes|recording ended|could not be read/.test(stats)) break; }
check("kodsuz cihaz: 'kod var ama bu aktarımın kodu yok' deniyor", /has Kionel codes, but this device does not have the code/.test(await note(c)), (await note(c)).slice(0, 140));
check("JS hatası yok", [...b.errors, ...c.errors].length === 0, [...b.errors, ...c.errors].slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
c.close(); process.exit(fail ? 1 : 0);
