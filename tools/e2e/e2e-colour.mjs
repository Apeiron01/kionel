// Renkli kod, gerçek uygulama üzerinden: gönderici cimbar ile gönderir, ekranı
// kaydedilir, alıcı kaydı açar ve renkli kodu kendisi tanıyıp çözer.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const [SP, BASE, LICENSE, SIZE = "400000", SECONDS = "15"] = process.argv.slice(2);
const file = `${SP}/colour-payload.bin`;
const payload = randomBytes(Number(SIZE));
writeFileSync(file, payload);
const want = createHash("sha256").update(payload).digest("hex");
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9341", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
  `--user-data-dir=${SP}/chrome-colour-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9341/json")).json()).find((t) => t.type === "page");
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
const notice = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + n.textContent.replace("×", "").trim().slice(0, 140))(document.getElementById("notice"))`);

await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
await send("Page.navigate", { url: `${BASE}/transfer.html` });
await sleep(4000);
// Işığa duyarlılık uyarısı bu testte onaylanmış sayılır; uyarının kendisi ayrı denetlenir.
await ev(`localStorage.setItem("kionel.flash-warning.v1", String(Date.now()))`);
await setFile("#license-file", LICENSE);
await sleep(1500);
await setFile("#file", file);
await sleep(4000);
await ev(`document.getElementById("preset-colour").click()`);
console.log("renkli kod seçildi:", await ev(`document.getElementById("preset-colour").getAttribute("aria-pressed")`), "|", await ev(`document.getElementById("record-plan").textContent`));

console.log("gönderici paneli:", await ev(`[...document.querySelectorAll("#send-flow .fg-compat li")].map(l => l.textContent).join(" | ")`));
await ev(`document.getElementById("tab-recv").click()`);
await sleep(1500);
await ev(`document.querySelector('[data-pair="code"]').click()`);
await ev(`document.querySelector('[data-read="file"]').click()`);
const code = await ev(`document.getElementById("code-display").textContent`);
console.log("alıcı paneli (hazır kayıt):", await ev(`[...document.querySelectorAll("#recv-flow .fg-compat li")].map(l => l.textContent).join(" | ")`));
await ev(`document.getElementById("tab-send").click()`);
await ev(`document.getElementById("context-reference").value = "COLOUR-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(4000);
console.log("gönderim:", await notice());
console.log("geri sayım:", await ev(`(e => e.hidden ? "gizli" : e.textContent)(document.getElementById("film-countdown"))`));
console.log("renkli canvas var:", await ev(`!!document.querySelector("#send-stage .colour-stage")`));

const size = await ev(`new Promise((resolve) => {
  const canvas = document.querySelector("#send-stage .colour-stage");
  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 40000000 });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => { window.__rec = new File(chunks, "colour.webm", { type: "video/webm" }); resolve(window.__rec.size); };
  rec.start(500);
  setTimeout(() => rec.stop(), ${Number(SECONDS) * 1000});
})`);
console.log("kayıt:", size, "bayt");
await ev(`document.getElementById("tab-recv").click()`);
const started = Date.now();
await ev(`(() => { const i = document.getElementById("record-open"); const d = new DataTransfer(); d.items.add(window.__rec); i.files = d.files; i.dispatchEvent(new Event("change")); })()`);
let line = "";
for (let i = 0; i < 300; i++) {
  await sleep(1000);
  line = await ev(`document.getElementById("result").textContent.slice(0, 50) + " | " + document.getElementById("rec-progress").textContent`);
  if (/verified|intact|rejected|ended|No Kionel|could not/.test(line + await ev(`document.getElementById("recv-stats").textContent`))) break;
}
console.log("okuma:", ((Date.now() - started) / 1000).toFixed(1), "s |", line.slice(0, 200));
await ev(`window.print = () => {}; document.querySelector("#result .report-button")?.click()`);
await sleep(1500);
const reported = await ev(`(() => { const dts = [...document.querySelectorAll("#print-report dt")]; const i = dts.findIndex(d => d.textContent === "SHA-256"); return i < 0 ? "yok" : document.querySelectorAll("#print-report dd")[i].textContent; })()`);
console.log("makbuzdaki SHA-256 = gönderilen dosya:", reported === want);
console.log("son bildirim:", await notice());
console.log("JS hataları:", errors.length ? errors.slice(0, 3) : "yok");
ws.close(); chrome.kill(); process.exit(0);
