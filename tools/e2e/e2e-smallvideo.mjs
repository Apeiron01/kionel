// Mesajlaşma uygulamasının küçülttüğü gerçek bir video: uygulama nedeni söylemeli,
// saçma bir "N saniye daha çek" demeden, ve okuma bitince sayaç durmalı.
// Kullanım: node tools/e2e/e2e-smallvideo.mjs <scratch> <site> <license.json> [video]
// Video verilmezse 478x850'lik (WhatsApp'ın ürettiği boyut) kısa bir video üretilir.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE, GIVEN] = process.argv.slice(2);
let VIDEO = GIVEN;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--remote-debugging-port=9399", "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-small-${Date.now()}`, "about:blank"], { stdio: "ignore" });
await sleep(4000);
const t = (await (await fetch("http://127.0.0.1:9399/json")).json()).find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
const note = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);
await setFile("#license-file", LICENSE); await sleep(1500);
if (!VIDEO) {
  const b64 = await ev(`new Promise((resolve) => { const c = document.createElement("canvas"); c.width = 478; c.height = 850; const g = c.getContext("2d"); let on = true; const draw = () => { for (let i = 0; i < 400; i++) { g.fillStyle = Math.random() < 0.5 ? "#000" : "#fff"; g.fillRect(Math.random() * 478, Math.random() * 850, 12, 12); } if (on) requestAnimationFrame(draw); }; draw(); const r = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 1500000 }); const parts = []; r.ondataavailable = (e) => parts.push(e.data); r.onstop = async () => { on = false; const b = new Uint8Array(await new Blob(parts).arrayBuffer()); let s = ""; for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); resolve(btoa(s)); }; r.start(500); setTimeout(() => r.stop(), 3000); })`);
  VIDEO = `${SP}/small-478x850.webm`;
  writeFileSync(VIDEO, Buffer.from(b64, "base64"));
}
await ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await ev(`document.querySelector('[data-read="file"]').click()`);
await setFile("#record-open", VIDEO);
// Kısa videoda bitiş mesajı başlangıç uyarısının üstüne yazılır: uyarı sık yoklanır.
let early = "";
for (let i = 0; i < 40 && !/probably too small/.test(early); i++) { await sleep(100); early = await note(); }
check("açılışta: video küçük uyarısı ve nedeni", /^warn: This video is \d+×\d+, probably too small to read\. .*WhatsApp.*document/.test(early), early.slice(0, 160));
let stats = "";
for (let i = 0; i < 90; i++) { await sleep(1000); stats = await ev(`document.getElementById("recv-stats").textContent`); if (/recording ended|No Kionel codes|could not be read/.test(stats)) break; }
const end = await note();
check("bitişte: çözünürlük ve aktarma önerisi", /\d+×\d+, too small for the codes\..*Quick Share/.test(end), end.slice(0, 200));
check("bitişte: saçma saniye tahmini yok", !/Record about \d+ more seconds/.test(end) && !(await ev(`!document.getElementById("record-need").hidden && /\d{3} more seconds/.test(document.getElementById("record-need").textContent)`)));
const t1 = await ev(`document.getElementById("recv-timer").textContent`); await sleep(4000);
const t2 = await ev(`document.getElementById("recv-timer").textContent`);
check("okuma bitince sayaç duruyor", t1 === t2 && !/^Reading/.test(t2), `${t1} → ${t2}`);
check("JS hatası yok", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
