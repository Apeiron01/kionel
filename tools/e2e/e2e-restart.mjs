// Kullanıcının senaryosu: kısmi okuma oturum A'ya kilitler, gönderen yeniden
// başlatır (oturum B), yeni kayıt açılır. Alıcı B'ye geçmeli ve tamamlamalı.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const [SP, BASE, LICENSE] = process.argv.slice(2);
const file = `${SP}/payload2.bin`;
writeFileSync(file, randomBytes(400_000));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9336", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-rs-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9336/json")).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}` : r.result.value; };
const setFile = async (selector, path) => {
  const { root } = (await send("DOM.getDocument")).result;
  const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector })).result;
  await send("DOM.setFileInputFiles", { nodeId, files: [path] });
};
const notice = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + n.textContent.trim().slice(0, 120))(document.getElementById("notice"))`);
const record = (seconds) => ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(60); const r = new MediaRecorder(s, { videoBitsPerSecond: 25000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = () => { window.__rec = new File(c, "r.webm", { type: "video/webm" }); resolve(window.__rec.size); }; r.start(500); setTimeout(() => r.stop(), ${seconds * 1000}); })`);
const openRecording = async () => {
  await ev(`document.getElementById("tab-recv").click()`);
  await ev(`(() => { const i = document.getElementById("record-open"); const d = new DataTransfer(); d.items.add(window.__rec); i.files = d.files; i.dispatchEvent(new Event("change")); })()`);
  let line = "";
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    line = await ev(`document.getElementById("result").textContent.slice(0, 60) + " | " + document.getElementById("rec-progress").textContent + " | " + document.getElementById("recv-stats").textContent.split(String.fromCharCode(10))[0].slice(0, 90)`);
    if (/verified|rejected|ended|No Kionel|could not/.test(line)) break;
  }
  return line;
};

await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
await send("Page.navigate", { url: `${BASE}/transfer.html` });
await sleep(4000);
await ev(`localStorage.setItem("kionel.flash-warning.v1", String(Date.now()))`);
console.log("yenilikler paneli görünür:", await ev(`!document.getElementById("whats-new").hidden`));
await setFile("#license-file", LICENSE);
await sleep(1500);
await setFile("#file", file);
await sleep(2000);
await ev(`document.getElementById("preset-record").click()`);

// Alıcı modları
await ev(`document.getElementById("tab-recv").click()`);
await sleep(1500);
await ev(`document.querySelector('[data-pair="code"]').click()`);
await ev(`document.querySelector('[data-read="record"]').click()`);
console.log("özet:", (await ev(`document.getElementById("mode-summary").textContent`)).slice(0, 160));
console.log("kod paneli / kayıt paneli görünür:", await ev(`!document.getElementById("pair-code-panel").hidden + " / " + !document.getElementById("read-record-panel").hidden`));
const code = await ev(`document.getElementById("code-display").textContent`);

// Gönderim A — kısa kayıt, kısmi okuma
await ev(`document.getElementById("tab-send").click()`);
await ev(`document.getElementById("context-reference").value = "E2E-2"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
console.log("durdur düğmesi görünür:", await ev(`!document.getElementById("send-stop").hidden`));
await record(2);
console.log("A (kısmi):", (await openRecording()).slice(0, 220));

// Gönderen yeniden başlatır — oturum B
await ev(`document.getElementById("tab-send").click()`);
await ev(`document.getElementById("send-stop").click()`);
console.log("durdurulunca düğme gizli:", await ev(`document.getElementById("send-stop").hidden`), "| bildirim:", await notice());
await ev(`document.getElementById("code-send").click()`);
await sleep(1500);
await record(20);
console.log("B:", (await openRecording()).slice(0, 220));
console.log("geçiş bildirimi / son bildirim:", await notice());
console.log("JS hataları:", errors.length ? errors.slice(0, 3) : "yok");
ws.close(); chrome.kill(); process.exit(0);
