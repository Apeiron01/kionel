// Canlı kamerada kodu olmayan alıcı: ekranda Kionel aktarımı varken ne yapacağını söylemeli.
// Kullanım: node tools/e2e/e2e-livecode.mjs <scratch> <site> <license.json>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port, flags = []) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", ...flags, `--user-data-dir=${SP}/chrome-livecode-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); } catch {}` });
  await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  const note = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
  return { ev, setFile, note, errors, close: () => { ws.close(); chrome.kill(); } };
}
// Gönderen: kendi alıcı sekmesindeki kodla canlı QR gönderir; ekranı sahte kamera karelerine çevrilir.
writeFileSync(`${SP}/livecode.csv`, "numune,sonuc\nL-1,0.8\n");
const a = await browser(9410);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.setFile("#file", `${SP}/livecode.csv`); await sleep(1500);
await a.ev(`document.getElementById("context-reference").value = "LIVE-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const count = await a.ev(`new Promise((resolve) => { const src = document.getElementById("qr"); const c = document.createElement("canvas"); c.width = src.width; c.height = src.height; const g = c.getContext("2d"); window.__frames = []; let n = 0; const tick = () => { g.drawImage(src, 0, 0); c.toBlob(async (b) => { window.__frames.push(new Uint8Array(await b.arrayBuffer())); if (++n >= 60) resolve(window.__frames.length); }, "image/jpeg", 0.95); if (n < 60) setTimeout(tick, 33); }; tick(); })`);
const parts = [];
for (let i = 0; i < count; i++) parts.push(Buffer.from(await a.ev(`(() => { const f = window.__frames[${i}]; let s = ""; for (let j = 0; j < f.length; j += 32768) s += String.fromCharCode(...f.subarray(j, j + 32768)); return btoa(s); })()`), "base64"));
writeFileSync(`${SP}/livecode.mjpeg`, Buffer.concat(parts));
a.close();
// Alıcı: varsayılan kipte (gönderende kamera var), kodu yok.
const b = await browser(9411, ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${SP}/livecode.mjpeg`]);
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`);
let n = "";
for (let i = 0; i < 20; i++) { await sleep(1000); n = await b.note(); if (/no code for it/.test(n)) break; }
check("kodsuz canlı alıcı: ne yapacağını söylüyor", /^warn: A Kionel transfer is on the sending screen, but this device has no code for it/.test(n), n.slice(0, 140));
check("JS hatası yok", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
b.close(); process.exit(fail ? 1 : 0);
