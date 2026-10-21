// Canlı okuma hızı: gönderenin kodları kameraya benzer karelere (1280×720, kod karenin bir
// kısmında, gri arka plan) gömülür; alıcı bunları sahte kameradan, telefon hızına indirilmiş
// işlemciyle (CPU ×6) canlı okur. Teslim süresi ve okunan kod sayısı yazılır.
// Kullanım: node tools/e2e/e2e-livespeed.mjs <scratch> <site> [kb=40] [throttle=6]
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const [SP, BASE, KB = "40", THROTTLE = "6"] = process.argv.slice(2);
const payload = randomBytes(Number(KB) * 1024);
mkdirSync(`${SP}/src`, { recursive: true });
writeFileSync(`${SP}/src/speed.bin`, payload);
const want = createHash("sha256").update(payload).digest("hex");
const CODE = "7K3QM9XD4PAB";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function browser(port, extra = [], init = "") {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", ...extra, `--user-data-dir=${SP}/chrome-speed-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); ${init}` });
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  return { ev, send, setFile, errors, close: () => { ws.close(); chrome.kill(); } };
}

// 1) Gönderen: kodları ekranda gösterir; test canvas karelerini kamera karesine gömüp JPEG yapar.
const a = await browser(9421);
await a.send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(4000);
await a.ev(`document.getElementById("preset-live").click()`);
await a.setFile("#file", `${SP}/src/speed.bin`); await sleep(1500);
await a.ev(`document.getElementById("typed-code").value = "${CODE}"; document.getElementById("code-send").click()`); await sleep(1500);
// Kareyi çizim anında yakala: her gösterilen kod bir kamera karesi olur (30 fps akış).
const frames = await a.ev(`new Promise((resolve) => {
  const src = document.getElementById("qr"); const cam = document.createElement("canvas"); cam.width = 1280; cam.height = 720;
  const x = cam.getContext("2d"); const out = []; const until = performance.now() + 20000;
  const grab = () => {
    x.fillStyle = "#8a8a8a"; x.fillRect(0, 0, 1280, 720);
    x.drawImage(src, 700, 150, 440, 440); // kod karenin sağ yarısında, yüksekliğin %60'ı
    cam.toBlob(async (b) => { out.push(new Uint8Array(await b.arrayBuffer())); }, "image/jpeg", 0.9);
    if (performance.now() < until) setTimeout(grab, 1000 / 30); else setTimeout(() => resolve(out.length), 800);
  };
  window.__jpegs = out; grab();
})`);
const parts = [];
for (let i = 0; i < frames; i++) parts.push(Buffer.from(await a.ev(`(() => { const f = window.__jpegs[${i}]; let s = ""; for (let j = 0; j < f.length; j += 32768) s += String.fromCharCode(...f.subarray(j, j + 32768)); return btoa(s); })()`), "base64"));
writeFileSync(`${SP}/speed.mjpeg`, Buffer.concat(parts));
a.close();

// 2) Alıcı: sahte kamera, yavaşlatılmış işlemci.
const b = await browser(9422, ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${SP}/speed.mjpeg`],
  `sessionStorage.setItem("kionel.transfer-code.v1", JSON.stringify({ code: "${CODE}", at: Date.now() }));` +
  // HANG_WORKERS=1: QR işçileri hiç cevap vermez (betiği ağda takılan işçi). Alıcı kör kalmamalı.
  (process.env.HANG_WORKERS ? ` (() => { const W = Worker; window.Worker = function (url, options) { return /qr-worker/.test(String(url)) ? { postMessage() {}, terminate() {}, onmessage: null, onerror: null } : new W(url, options); }; })();` : ""));
await b.send("Emulation.setCPUThrottlingRate", { rate: Number(THROTTLE) });
await b.send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(4000);
await b.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
const t0 = Date.now();
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(300);
await b.ev(`document.querySelector('[data-pair="code"]').click(); document.querySelector('[data-read="live"]').click()`);
let result = "", stats = "";
for (let i = 0; i < 240; i++) { await sleep(500); result = await b.ev(`document.getElementById("result").textContent`); if (/verified|checked|intact|rejected/.test(result)) break; }
stats = await b.ev(`document.getElementById("recv-timer").textContent + " | " + document.getElementById("recv-stats").textContent.split("\\n").slice(0, 2).join(" | ")`);
await b.ev(`[...document.querySelectorAll("#result a[download]")].find(x => x.download === "speed.bin")?.click()`);
let got = "yok";
for (let i = 0; i < 20 && got === "yok"; i++) { await sleep(400); try { const f = readFileSync(`${SP}/speed.bin`); if (f.length === payload.length) got = createHash("sha256").update(f).digest("hex"); } catch { /* yok */ } }
console.log(`${KB} KB · CPU ×${THROTTLE} · ${frames} kamera karesi · ${((Date.now() - t0) / 1000).toFixed(1)} s toplam · ${stats}`);
console.log(`teslim: ${/verified|checked|intact/.test(result) ? "evet" : "HAYIR"} · dosya aynı: ${got === want} · JS hataları: ${b.errors.length ? b.errors.slice(0, 2).join(" | ") : "yok"}`);
b.close();
process.exit(/verified|checked|intact/.test(result) && got === want ? 0 : 1);
