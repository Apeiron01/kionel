// "Şimdi çek, sonra oku": kayıt bir tarayıcıda çekilir, başka bir tarayıcıda
// (başka cihaz, sayfa yeniden açılmış) kod elle yazılarak okunur.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const payload = randomBytes(30_000);
writeFileSync(`${SP}/later.bin`, payload);
const want = createHash("sha256").update(payload).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-later-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
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
const a = await browser(9346);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.setFile("#file", `${SP}/later.bin`); await sleep(2000);
await a.ev(`document.getElementById("preset-record").click()`);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1500);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.ev(`document.getElementById("context-reference").value = "LATER-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const b64 = await a.ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(30); const r = new MediaRecorder(s, { videoBitsPerSecond: 8000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = async () => { const buf = new Uint8Array(await new Blob(c).arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); resolve(btoa(bin)); }; r.start(500); setTimeout(() => r.stop(), 6000); })`);
writeFileSync(`${SP}/later.webm`, Buffer.from(b64, "base64"));
check("çekim kaydedildi", b64.length > 1000, `${Math.round(b64.length * 0.75 / 1024)} KB`);
{ const t = await a.ev(`document.getElementById("send-timer").textContent`); check("gönderen sayacı ilerliyor", /^Sending · 0:0[5-9]$/.test(t), t); }
a.close();
// 2) Sonra, başka cihaz: kod elle yazılır
const b = await browser(9347);
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await b.ev(`document.querySelector('[data-read="file"]').click()`);
await b.ev(`document.getElementById("recording-code").value = "${code}"`);
await b.setFile("#record-open", `${SP}/later.webm`);
let res = "";
for (let i = 0; i < 40; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(res)) break; }
check("başka cihazda, sonra, kod elle yazılarak okundu", /verified/.test(res), res.slice(0, 100));
await b.ev(`window.print = () => {}; document.querySelector("#result .report-button")?.click()`); await sleep(1200);
const reported = await b.ev(`(() => { const dts = [...document.querySelectorAll("#print-report dt")]; const i = dts.findIndex(d => d.textContent === "SHA-256"); return i < 0 ? "yok" : document.querySelectorAll("#print-report dd")[i].textContent; })()`);
check("dosya birebir aynı (makbuz SHA-256)", reported === want);
check("iş emri kayıtta", /LATER-1/.test(res));
{ const t = await b.ev(`document.getElementById("recv-timer").textContent`); const m = await b.ev(`document.getElementById("notice-text").textContent`); check("alan sayacı teslimde duruyor ve süre mesajda", /^Received in · \d+:\d\d$/.test(t) && /Time from the first code: \d+:\d\d/.test(m), `${t} | ${m.slice(-40)}`); }
// 3) Yanlış kodla aynı kayıt açılmamalı; okunan saklanmalı
await b.ev(`location.reload()`); await sleep(4000);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await b.ev(`document.querySelector('[data-read="file"]').click()`);
await b.ev(`document.getElementById("recording-code").value = "2222-2222-2222"`);
await b.setFile("#record-open", `${SP}/later.webm`);
for (let i = 0; i < 20; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected|does not open/.test(res)) break; }
check("yanlış kodla açılamıyor; okunan saklanıyor", /does not open this file/.test(res) && /what was read is kept/.test(res), res.slice(0, 110));
// Doğru kod yazılınca video yeniden okunmadan açılır.
await b.ev(`(i => { i.value = "${code}"; i.dispatchEvent(new Event("change")); })(document.getElementById("recording-code"))`);
for (let i = 0; i < 10; i++) { await sleep(500); res = await b.ev(`document.getElementById("result").textContent`); if (/verified/.test(res)) break; }
check("doğru kod: kayıt yeniden okunmadan açıldı", /verified/.test(res), res.slice(0, 100));
check("JS hatası yok", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
b.close();
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
