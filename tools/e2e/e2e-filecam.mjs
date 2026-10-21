// Çevrimdışı paket dosyadan açılınca alıcı olarak kamera açabiliyor mu?
import { spawn } from "node:child_process";
const [SP, PKG] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--remote-debugging-port=9371", "--no-first-run",
  "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--user-data-dir=${SP}/chrome-filecam-${Date.now()}`, "about:blank"], { stdio: "ignore" });
await sleep(4000);
const t = (await (await fetch("http://127.0.0.1:9371/json")).json()).find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
await send("Runtime.enable"); await send("Page.enable");
await send("Page.navigate", { url: PKG }); await sleep(3000);
console.log("güvenli bağlam:", await ev("window.isSecureContext"), "| mediaDevices:", await ev("!!navigator.mediaDevices"), "| klasör seçici:", await ev("'showDirectoryPicker' in window"));
await ev(`document.getElementById("tab-recv").click()`); await sleep(4000);
console.log("kamera akışı:", await ev(`(v => v.srcObject ? v.srcObject.getVideoTracks().length + " iz, " + v.videoWidth + "x" + v.videoHeight : "yok")(document.getElementById("recv-video"))`));
console.log("alıcı durumu:", (await ev(`document.getElementById("recv-stats").textContent`)).slice(0, 120));
console.log("JS hataları:", errors.length ? errors.slice(0, 2) : "yok");
ws.close(); chrome.kill(); process.exit(0);
