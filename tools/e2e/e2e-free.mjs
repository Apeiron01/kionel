// Kişisel (lisanssız) sürümün sınırları ve mesajları.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const [SP, BASE] = process.argv.slice(2);
writeFileSync(`${SP}/big.bin`, randomBytes(6 * 1024 * 1024));
writeFileSync(`${SP}/small.bin`, randomBytes(300_000));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9337", "--no-first-run", "--ignore-certificate-errors",
  `--user-data-dir=${SP}/chrome-free-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9337/json")).json()).find((t) => t.type === "page");
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
const notice = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + n.textContent.replace("×", "").trim().slice(0, 110))(document.getElementById("notice"))`);
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
await send("Page.navigate", { url: `${BASE}/transfer.html` });
await sleep(4000);

const status = await ev(`document.getElementById("license-status").dataset.state + "|" + document.getElementById("license-status").textContent`);
check("lisans yok → kişisel sürüm, sakin renk", status.startsWith("free|Personal edition (free)"), status.slice(0, 80));

await setFile("#file", `${SP}/big.bin`);
await sleep(1500);
let n = await notice();
check("6 MB dosya → 5 MB sınırı uyarısı", n.startsWith("warn:") && /up to 5 MB/.test(n), n);

await setFile("#file", `${SP}/small.bin`);
await sleep(4000);
check("300 KB dosya kabul edildi", /✓ small\.bin/.test(await ev(`document.querySelector("#file").parentElement.textContent`)));

await ev(`document.getElementById("preset-record").click()`);
n = await notice();
check("hızlı mod → işletme uyarısı", n.startsWith("warn:") && /business licence/.test(n), n);
check("hızlı mod seçilmedi", await ev(`document.getElementById("preset-live").getAttribute("aria-pressed")`) === "true");
check("kayıt süresi satırı kişiselde gizli", await ev(`document.getElementById("record-plan").hidden`) === true);

await ev(`document.getElementById("tab-recv").click()`);
await sleep(1500);
await ev(`document.querySelector('[data-read="record"]').click()`);
check("kayıt okuma → işletme uyarısı", /business licence/.test(await notice()));
check("okuma canlıda kaldı", await ev(`document.querySelector('[data-read="live"]').getAttribute("aria-pressed")`) === "true");
await ev(`document.querySelector('[data-read="file"]').click()`);
check("hazır kayıt → işletme uyarısı", /business licence/.test(await notice()));
await ev(`document.querySelector('[data-pair="card"]').click()`);
check("alıcı kartı → işletme uyarısı", /receiver card needs a business licence/i.test(await notice()));

await ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await ev(`document.getElementById("code-display").textContent`);
check("kod modu → kod görünür, panel açık", /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/.test(code) && await ev(`!document.getElementById("pair-code-panel").hidden`), code);
const summary = await ev(`document.getElementById("mode-summary").textContent`);
check("özet göndericiye ne yapacağını söylüyor", /type this device's code/.test(summary) && /Standard/.test(summary), summary.slice(0, 300));

await ev(`document.getElementById("tab-send").click()`);
await ev(`document.getElementById("context-reference").value = ""; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(800);
check("ışığa duyarlılık uyarısı açıldı", await ev(`document.getElementById("flash-warning").open`) === true);
await ev(`document.querySelector('#flash-warning button[value="cancel"]').click()`);
await sleep(500);
check("Vazgeç → gönderim başlamadı", await ev(`document.getElementById("send-stop").hidden`) === true && /not started/.test(await notice()));
await ev(`document.getElementById("code-send").click()`);
await sleep(800);
await ev(`document.querySelector('#flash-warning button[value="accept"]').click()`);
await sleep(3000);
n = await notice();
check("kişiselde iş emri istemeden gönderim başladı", n.startsWith("ok:") && /Sending/.test(n), n);
check("kişiselde sevk kaydı sunulmuyor, işletme notu var",
  await ev(`document.querySelectorAll("#dispatch-result a.dl").length === 0 && /business licence/.test(document.getElementById("dispatch-result").textContent)`) === true);
check("durdur düğmesi görünür", await ev(`!document.getElementById("send-stop").hidden`) === true);
check("tam ekran düğmesi görünür", await ev(`!document.getElementById("send-fullscreen").hidden`) === true);
await ev(`document.getElementById("code-send").click()`);
await sleep(800);
check("onay 30 gün hatırlanıyor (ikinci gönderimde uyarı yok)", await ev(`document.getElementById("flash-warning").open`) === false);
check("sürüm karşılaştırma bağlantısı var", await ev(`!!document.querySelector('a[href="/pilot.html#editions"]')`) === true);
check("JS hatası yok", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
