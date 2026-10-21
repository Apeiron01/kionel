// "Şimdi çek, sonra oku": kayıt bir tarayıcıda çekilir, başka bir tarayıcıda
// (başka cihaz, sayfa yeniden açılmış) kod elle yazılarak okunur.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const payload = randomBytes(30_000);
writeFileSync(`${SP}/phone.bin`, payload);
const want = createHash("sha256").update(payload).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-phone-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
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
  return { ev, setFile, errors, close: () => { ws.close(); chrome.kill(); } };
}
// 1) Çekim anı
const a = await browser(9396);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.setFile("#file", `${SP}/phone.bin`); await sleep(2000);
await a.ev(`document.getElementById("preset-record").click()`);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1500);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.ev(`document.getElementById("context-reference").value = "LATER-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const W = Number(process.env.W || 3840), H = Math.round(W * 9 / 16), QW = Math.round(W * 0.37);
const b64 = await a.ev(`new Promise((resolve) => { const src = document.getElementById("qr"); const big = document.createElement("canvas"); big.width = ${W}; big.height = ${H}; const g = big.getContext("2d"); let on = true; const draw = () => { g.fillStyle = "#1b2326"; g.fillRect(0, 0, ${W}, ${H}); g.imageSmoothingEnabled = true; g.drawImage(src, ${Math.round((W - QW) / 2)}, ${Math.round((H - QW) / 2)}, ${QW}, ${QW}); if (on) requestAnimationFrame(draw); }; draw(); const s = big.captureStream(30); const r = new MediaRecorder(s, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 25000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = async () => { on = false; const buf = new Uint8Array(await new Blob(c).arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); resolve(btoa(bin)); }; r.start(500); setTimeout(() => r.stop(), 8000); })`);
writeFileSync(`${SP}/phone.webm`, Buffer.from(b64, "base64"));
check("çekim kaydedildi", b64.length > 1000, `${Math.round(b64.length * 0.75 / 1024)} KB`);
{ const t = await a.ev(`document.getElementById("send-timer").textContent`); check("gönderen sayacı ilerliyor", /^Sending · 0:(0[5-9]|1[0-3])$/.test(t), t); }
a.close();

const b = await browser(9397);
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await b.ev(`document.querySelector('[data-read="file"]').click()`);
await b.ev(`document.getElementById("recording-code").value = "${code}"`);
await b.setFile("#record-open", `${SP}/phone.webm`);
let res = "", line = "";
for (let i = 0; i < 90; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); line = await b.ev(`document.getElementById("rec-progress").textContent + " | " + document.getElementById("recv-stats").textContent`); if (/verified|rejected/.test(res) || /ended|No Kionel|could not/.test(line)) break; }
check(`${W}p benzeri telefon kaydı (kod ~${QW}px) okundu`, /verified/.test(res), line.slice(0, 160));
const t1 = await b.ev(`document.getElementById("recv-timer").textContent`); await sleep(4000);
const t2 = await b.ev(`document.getElementById("recv-timer").textContent`);
check("okuma bitince sayaç duruyor", t1 === t2, `${t1} → ${t2}`);
check("JS hatası yok", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
b.close(); process.exit(fail ? 1 : 0);
