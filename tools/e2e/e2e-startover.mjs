// Yalnız mühürleme: dosya aktarılmaz, mühür kodu telefona geçer.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
writeFileSync(`${SP}/over.bin`, randomBytes(50_000));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9355", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-over-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4500);
const target = (await (await fetch("http://127.0.0.1:9355/json")).json()).find((t) => t.type === "page");
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
await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); } catch {}` });
const hidden = (id) => ev(`document.getElementById(${JSON.stringify(id)}).hidden`);
await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);
await setFile("#license-file", LICENSE); await sleep(1500);
await setFile("#file", `${SP}/over.bin`); await sleep(1500);
// Canlı modda düğme yok
await ev(`document.getElementById("context-reference").value = "OVER-1"; document.getElementById("typed-code").value = "7K3Q-M9XD-4PLA"; document.getElementById("code-send").click()`); await sleep(4000);
check("canlı gönderimde 'Start over' gizli", await hidden("send-restart"));
await ev(`document.getElementById("send-stop").click()`); await sleep(300);
// Kayıt modunda görünür
await ev(`document.getElementById("preset-record").click()`); await sleep(300);
await ev(`document.getElementById("code-send").click()`); await sleep(1000);
check("kayıt modunda 'Start over' görünür", !(await hidden("send-restart")));
await sleep(5000);
const before = await ev(`document.getElementById("send-timer").textContent`);
await ev(`document.getElementById("send-restart").click()`); await sleep(400);
check("baştan başlat: olumlu mesaj", /^ok: Started again/.test(await notice()), await notice());
check("baştan başlat: geri sayım yeniden görünür", !(await hidden("film-countdown")), await ev(`document.getElementById("film-countdown").textContent`));
check("baştan başlat: sayaç sıfırdan", /^Sending · 0:0[0-1]$/.test(await ev(`document.getElementById("send-timer").textContent`)), `${before} → ${await ev(`document.getElementById("send-timer").textContent`)}`);
await ev(`document.getElementById("send-stop").click()`); await sleep(300);
check("durdurunca 'Start over' gizli, sayaç 'Codes shown for'", (await hidden("send-restart")) && /^Codes shown for · /.test(await ev(`document.getElementById("send-timer").textContent`)));
check("JS hatası yok", errors.length === 0, errors.join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
