// Yalnız mühürleme: dosya aktarılmaz, mühür kodu telefona geçer.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9351", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-old-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9351/json")).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}` : r.result.value; };
const setFile = async (selector, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
const notice = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + n.textContent.replace("×", "").trim().slice(0, 130))(document.getElementById("notice"))`);
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
// 1) Güncel tarayıcı: uyarı yok.
await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);
check("güncel tarayıcıda eski-tarayıcı uyarısı yok", !/too old for Kionel/.test(await notice()), await notice());
// 2) Eski tarayıcı taklidi: Ed25519/X25519 yok; kayıtlı kimlik de yok.
await send("Storage.clearDataForOrigin", { origin: BASE, storageTypes: "all" });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); } catch {} const g = SubtleCrypto.prototype.generateKey; SubtleCrypto.prototype.generateKey = function (a, ...r) { const n = typeof a === "string" ? a : a && a.name; if (n === "Ed25519" || n === "X25519") return Promise.reject(new DOMException("Unrecognized name.", "NotSupportedError")); return g.call(this, a, ...r); }; })();` });
await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);
const n = await notice();
check("eski tarayıcıda açılışta olumsuz uyarı", n.startsWith("bad:") && /too old for Kionel/.test(n), n);
check("uyarı ne yapılacağını söylüyor", /Chrome or Edge 137/.test(await ev(`document.getElementById("notice-text").textContent`)));
await ev(`document.getElementById("demo-file").click()`); await sleep(1500);
await ev(`document.getElementById("typed-code").value = "7K3Q-M9XD-4PLA"; document.getElementById("typed-code").dispatchEvent(new Event("input")); document.getElementById("code-send").click()`); await sleep(3000);
const after = await ev(`document.getElementById("notice-text").textContent`);
check("gönderim denenince de anlaşılır hata", /too old for Kionel/.test(after), after.slice(0, 140));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
