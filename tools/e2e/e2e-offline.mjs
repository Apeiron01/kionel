// Yalnız mühürleme: dosya aktarılmaz, mühür kodu telefona geçer.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
writeFileSync(`${SP}/off.bin`, randomBytes(30_000));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9354", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-off-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4500);
const target = (await (await fetch("http://127.0.0.1:9354/json")).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}` : r.result.value; };
const setFile = async (selector, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
const notice = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + n.textContent.replace("×", "").trim().slice(0, 130))(document.getElementById("notice"))`);
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
const requests = [];
const ids = new Map(); const blocked = new Set(); const answered = new Set();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Network.requestWillBeSent") { requests.push(m.params.request.url.slice(0, 80)); ids.set(m.params.requestId, m.params.request.url.slice(0, 80)); }
  // CSP ile engellenen istek de "gönderilecek" diye kaydedilir; sonra blockedReason "csp" ile düşer.
  if (m.method === "Network.loadingFailed" && m.params.blockedReason) blocked.add(ids.get(m.params.requestId));
  if (m.method === "Network.responseReceived") answered.add(ids.get(m.params.requestId));
});
await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable"); await send("Network.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); } catch {}` });
// BASE burada paket dosyasının file:// adresi.
await send("Page.navigate", { url: BASE }); await sleep(4000);
check("paket sürümünü söylüyor", /Offline package \d+\.\d+\.\d+/.test(await ev(`document.getElementById("offline-state").textContent`)));
check("kişisel sürüm durumu", /Personal edition/.test(await ev(`document.getElementById("license-status").textContent`)));
await setFile("#license-file", LICENSE); await sleep(1500);
check("lisans dosyadan yüklendi", /licensed|valid|until/i.test(await ev(`document.getElementById("license-status").textContent`)) && !(await ev(`document.getElementById("licence-forget").hidden`)), await ev(`document.getElementById("license-status").textContent.slice(0,90)`));
await ev(`document.getElementById("preset-colour").click()`); await sleep(300);
check("renkli kod pakette seçilebiliyor", /^ok: Set for the colour code/.test(await notice()), await notice());
await ev(`document.getElementById("preset-live").click()`);
await setFile("#file", `${SP}/off.bin`); await sleep(1500);
await ev(`document.getElementById("context-reference").value = "OFF-1"; document.getElementById("typed-code").value = "7K3Q-M9XD-4PLA"; document.getElementById("code-send").click()`); await sleep(5000);
check("kodla gönderim başladı, QR ekranda", !(await ev(`document.getElementById("qr").hidden`)) && /Sending/.test(await notice()), await notice());
await ev(`document.getElementById("pair-qr").click()`); await sleep(500);
const net = requests.filter((u) => !/^(data:|blob:|file:)/.test(u));
const escaped = net.filter((u) => !blocked.has(u) || answered.has(u));
check("ağa hiç istek gitmedi (varsa hepsi paketin CSP'si ile engellendi)", escaped.length === 0,
  escaped.length ? escaped.join(" , ") : net.length ? `${net.length} dış istek engellendi` : "");
check("JS hatası yok", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
