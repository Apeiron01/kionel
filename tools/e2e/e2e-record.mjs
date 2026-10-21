// Kayıt modunun uçtan uca testi: gönderici ekranı MediaRecorder ile videoya
// alınır, video alıcıya "kayıt" olarak verilir, çıkan dosya karşılaştırılır.
import { spawn } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const [SP, BASE, LICENSE, SIZE = "300000", VERSION = "27", HOLD = "1", SECONDS = "20"] = process.argv.slice(2);
const file = `${SP}/payload.bin`;
const payload = randomBytes(Number(SIZE));
writeFileSync(file, payload);
const want = createHash("sha256").update(payload).digest("hex");

const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9335", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-e2e-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9335/json")).json()).find((t) => t.type === "page");
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
await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
if (process.env.THROTTLE) await send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.THROTTLE) });
await send("Page.navigate", { url: `${BASE}/transfer.html` });
await sleep(4000);

await ev(`localStorage.setItem("kionel.flash-warning.v1", String(Date.now()))`);
await setFile("#license-file", LICENSE);
await sleep(1500);
console.log("lisans:", await ev(`document.getElementById("license-status").dataset.state + " | " + document.getElementById("license-status").textContent`));
if (process.env.ONLY_LICENSE) { ws.close(); chrome.kill(); process.exit(0); }
await ev(`document.getElementById("version").value = "${VERSION}"; document.getElementById("hold").value = "${HOLD}"; document.getElementById("version").dispatchEvent(new Event("change"))`);
await setFile("#file", file);
await sleep(4000);
console.log("seçim:", await ev(`document.getElementById("send-stats").textContent.split(String.fromCharCode(10))[1]`));

await ev(`document.getElementById("tab-recv").click()`);
await sleep(2000);
await ev(`document.getElementById("code-show").click()`);
const code = await ev(`document.getElementById("code-display").textContent`);
console.log("kod:", code);
await ev(`document.getElementById("tab-send").click()`);
await ev(`document.getElementById("context-reference").value = "E2E-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);

// Gönderici ekranını kaydet.
const recorded = await ev(`new Promise((resolve) => {
  const canvas = document.getElementById("qr");
  const stream = canvas.captureStream(60);
  const type = MediaRecorder.isTypeSupported("video/webm;codecs=vp9") ? "video/webm;codecs=vp9" : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: ${Number(process.env.BITRATE ?? 25_000_000)} });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => { window.__recording = new File(chunks, "screen.webm", { type }); resolve(window.__recording.size); };
  rec.start(1000);
  setTimeout(() => rec.stop(), ${Number(SECONDS) * 1000});
})`);
console.log("kayıt boyutu:", recorded, "bayt");

await ev(`document.getElementById("tab-recv").click()`);
const started = Date.now();
await ev(`(() => { const input = document.getElementById("record-open"); const dt = new DataTransfer(); dt.items.add(window.__recording); input.files = dt.files; input.dispatchEvent(new Event("change")); })()`);
let result = "";
for (let i = 0; i < 240; i++) {
  await sleep(1000);
  result = await ev(`document.getElementById("result").textContent + " | " + document.getElementById("recv-stats").textContent.split(String.fromCharCode(10)).slice(0,2).join(" / ")`);
  if (/verified|rejected|ended|No Kionel/.test(result)) break;
}
console.log("okuma süresi:", ((Date.now() - started) / 1000).toFixed(1), "s");
if (process.env.TWICE && /ended/.test(result)) {
  console.log("ilk kayıttan sonra:", result.slice(result.indexOf("|"), result.indexOf("|") + 60));
  await ev(`document.getElementById("tab-send").click()`);
  await ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(60); const r = new MediaRecorder(s, { videoBitsPerSecond: 25000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = () => { window.__recording = new File(c, "second.webm", { type: "video/webm" }); resolve(); }; r.start(1000); setTimeout(() => r.stop(), ${Number(SECONDS) * 1000}); })`);
  await ev(`document.getElementById("tab-recv").click()`);
  await ev(`(() => { const input = document.getElementById("record-open"); const dt = new DataTransfer(); dt.items.add(window.__recording); input.files = dt.files; input.dispatchEvent(new Event("change")); })()`);
  for (let i = 0; i < 240; i++) {
    await sleep(1000);
    result = await ev(`document.getElementById("result").textContent + " | " + document.getElementById("recv-stats").textContent.split(String.fromCharCode(10)).slice(0,2).join(" / ")`);
    if (/verified|rejected|ended|No Kionel/.test(result)) break;
  }
  console.log("ikinci kayıttan sonra");
}
console.log("sonuç:", result.slice(0, 260));
console.log("sonuç kutusu:", (await ev(`document.getElementById("result").textContent`)).slice(0, 200));
console.log("bildirim:", await ev(`document.getElementById("notice").textContent.slice(0, 200)`));
const got = await ev(`(async () => { const a = [...document.querySelectorAll("#result a.dl")].find(x => !x.classList.contains("secondary")); if (!a) return "yok"; const b = new Uint8Array(await (await fetch(a.href)).arrayBuffer()); const h = await crypto.subtle.digest("SHA-256", b); return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join(""); })()`);
console.log("dosya birebir aynı:", got === want, got === "yok" ? "(indirme yok)" : "", "beklenen", want.slice(0, 12), "gelen", String(got).slice(0, 12));
console.log("bağlantılar:", await ev(`[...document.querySelectorAll("#result a.dl")].map(a => a.download + (a.classList.contains("secondary") ? "*" : "")).join(", ")`));
await ev(`window.print = () => {}; document.querySelector("#result .report-button")?.click()`);
await sleep(1500);
const reported = await ev(`(() => { const dts = [...document.querySelectorAll("#print-report dt")]; const i = dts.findIndex(d => d.textContent === "SHA-256"); return i < 0 ? "yok" : document.querySelectorAll("#print-report dd")[i].textContent; })()`);
console.log("makbuzdaki SHA-256 = gönderilen dosya:", reported === want, "| rapor durumu:", await ev(`document.querySelector("#print-report .evidence-status")?.textContent`));
console.log("JS hataları:", errors.length ? errors.slice(0, 3) : "yok");
ws.close(); chrome.kill(); process.exit(0);
