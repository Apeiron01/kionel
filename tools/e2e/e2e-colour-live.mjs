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
  "--headless=new", "--remote-debugging-port=9361", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist",
  `--user-data-dir=${SP}/chrome-colourlive-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9361/json")).json()).find((t) => t.type === "page");
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

// Kaydı sahte kamera için MJPEG karelerine çevir (kamera ~30 kare/s görür).
const count = await ev(`new Promise(async (resolve) => {
  const v = document.createElement("video"); v.muted = true; v.src = URL.createObjectURL(window.__rec);
  const c = document.createElement("canvas"); c.width = 1024; c.height = 1024; const ctx = c.getContext("2d");
  window.__frames = []; let pending = 0; let ended = false;
  const done = () => { if (ended && !pending) resolve(window.__frames.length); };
  const onf = () => {
    ctx.drawImage(v, 0, 0, 1024, 1024); pending++;
    c.toBlob(async (b) => { window.__frames.push(new Uint8Array(await b.arrayBuffer())); pending--; done(); }, "image/jpeg", 0.92);
    if (!v.ended) v.requestVideoFrameCallback(onf);
  };
  v.onended = () => { ended = true; done(); };
  v.playbackRate = 0.5;
  v.requestVideoFrameCallback(onf);
  await v.play();
})`);
const parts = [];
for (let i = 0; i < count; i++) {
  const b64 = await ev(`(() => { const f = window.__frames[${i}]; let s = ""; for (let j = 0; j < f.length; j += 32768) s += String.fromCharCode(...f.subarray(j, j + 32768)); return btoa(s); })()`);
  parts.push(Buffer.from(b64, "base64"));
}
const mjpeg = `${SP}/colour-live.mjpeg`;
writeFileSync(mjpeg, Buffer.concat(parts));
console.log("sahte kamera:", count, "kare");
ws.close(); chrome.kill();

// Alıcı: ayrı tarayıcı, sahte kamera bu kareleri gösterir; canlı okuma.
const rx = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9362", "--no-first-run", "--ignore-certificate-errors",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${mjpeg}`,
  `--user-data-dir=${SP}/chrome-colourlive-rx-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
await sleep(4000);
const t2 = (await (await fetch("http://127.0.0.1:9362/json")).json()).find((t) => t.type === "page");
const w2 = new WebSocket(t2.webSocketDebuggerUrl);
await new Promise((r) => w2.addEventListener("open", r, { once: true }));
let id2 = 0; const p2 = new Map(); const errors2 = [];
w2.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && p2.has(m.id)) { p2.get(m.id)(m); p2.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors2.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
const s2 = (method, params = {}) => new Promise((r) => { const n = ++id2; p2.set(n, r); w2.send(JSON.stringify({ id: n, method, params })); });
const ev2 = async (x) => { const r = (await s2("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
await s2("Runtime.enable"); await s2("Page.enable"); await s2("DOM.enable");
await s2("Page.addScriptToEvaluateOnNewDocument", { source: `sessionStorage.setItem("kionel.transfer-code.v1", JSON.stringify({ code: ${JSON.stringify(code.replace(/-/g, ""))}, at: Date.now() }));` });
await s2("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(4000);
{ const { root } = (await s2("DOM.getDocument")).result; const { nodeId } = (await s2("DOM.querySelector", { nodeId: root.nodeId, selector: "#license-file" })).result; await s2("DOM.setFileInputFiles", { nodeId, files: [LICENSE] }); }
await sleep(1500);
await ev2(`document.getElementById("tab-recv").click()`); await sleep(1500);
await ev2(`document.querySelector('[data-pair="code"]').click(); document.querySelector('[data-read="live"]').click()`);
const started = Date.now();
let res = "";
for (let i = 0; i < 90; i++) {
  await sleep(1000);
  res = await ev2(`document.getElementById("result").textContent`);
  if (/verified|rejected/.test(res)) break;
}
console.log("canlı renkli okuma:", ((Date.now() - started) / 1000).toFixed(0), "s |", /verified/.test(res) ? "TESLİM" : "YOK", "|", await ev2(`document.getElementById("recv-stats").textContent.slice(0, 120)`));
console.log("alıcı sayacı:", await ev2(`document.getElementById("recv-timer").textContent`));
await sleep(3000);
console.log("3 s sonra sayaç (değişmemeli):", await ev2(`document.getElementById("recv-timer").textContent`));
console.log("JS hataları:", errors2.length ? errors2.slice(0, 3) : "yok");
w2.close(); rx.kill(); process.exit(0);
