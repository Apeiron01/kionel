// Yalnız mühürleme: dosya aktarılmaz, mühür kodu telefona geçer.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
writeFileSync(`${SP}/seal.bin`, randomBytes(200_000));
writeFileSync(`${SP}/seal-other.bin`, randomBytes(200_000));
writeFileSync(`${SP}/seal-not-a-record.json`, JSON.stringify({ hello: "world" }));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9342", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-seal-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9342/json")).json()).find((t) => t.type === "page");
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
await send("Page.navigate", { url: `${BASE}/transfer.html` });
await sleep(4000);
await ev(`document.getElementById("seal-only").click()`);
check("lisanssız → mühürleme işletme uyarısı", /Sealing a file needs a business licence/.test(await notice()));
await setFile("#license-file", LICENSE); await sleep(1500);
await setFile("#file", `${SP}/seal.bin`); await sleep(2000);
await ev(`document.getElementById("context-reference").value = "SEAL-7"; document.getElementById("seal-only").click()`);
await sleep(1500);
const n = await notice();
check("mühürlendi bildirimi", n.startsWith("ok:") && /sealed/.test(n), n);
check("mühür kodu görünür", await ev(`!document.getElementById("seal-qr").hidden`) === true);
check("mühür kaydı indirilebilir", /seal\.json/.test(await ev(`[...document.querySelectorAll("#dispatch-result a.dl")].map(a => a.download).join(",")`)));
await ev(`window.print = () => { window.__printed = true; }`);
await ev(`[...document.querySelectorAll("#dispatch-result .report-button")].find(b => /on paper/.test(b.textContent)).click()`);
await new Promise((r) => setTimeout(r, 800));
check("kâğıt mühür: yazdırma açıldı", await ev(`window.__printed === true`) === true);
check("kâğıt mühür: raporda okunabilir kod", await ev(`(() => { const i = document.querySelector("#print-report .report-code img"); return !!i && i.src.startsWith("data:image/png") && i.naturalWidth > 100; })()`) === true);
check("kâğıt mühür: başlık ve iş emri", await ev(`(() => { const t = document.getElementById("print-report").textContent; return /Sealed record/.test(t) && /SEAL-7/.test(t); })()`) === true);
await ev(`new Promise((resolve) => { const s = document.getElementById("seal-qr").captureStream(30); const r = new MediaRecorder(s); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = () => { window.__rec = new File(c, "seal.webm", { type: "video/webm" }); resolve(); }; r.start(250); const g = document.getElementById("seal-qr").getContext("2d"); const t = setInterval(() => { g.fillStyle = "rgba(255,255,255,0.01)"; g.fillRect(0,0,1,1); }, 30); setTimeout(() => { clearInterval(t); r.stop(); }, 2000); })`);
await ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await ev(`document.querySelector('[data-read="file"]').click()`);
await ev(`(() => { const i = document.getElementById("record-open"); const d = new DataTransfer(); d.items.add(window.__rec); i.files = d.files; i.dispatchEvent(new Event("change")); })()`);
// Kaydın okunması canlı sitede daha uzun sürebilir: sabit bekleme yerine sonucu bekle.
let res = "";
for (let i = 0; i < 60; i++) { await sleep(500); res = await ev(`document.getElementById("result").textContent`); if (/Sealed record received/.test(res)) break; }
check("telefonda mühür alındı ve imzası doğrulandı", /Sealed record received and its signature verified/.test(res), res.slice(0, 120));
check("iş emri mühürde", /SEAL-7/.test(res));
check("telefonda mühür raporu düğmesi", await ev(`!!document.querySelector("#result .report-button")`) === true);
// ---- dosya başka yoldan geldi (USB bellek): mühür + dosya → teslim makbuzu -------------------
const stats = () => ev(`document.getElementById("recv-stats").textContent`);
const carriedNote = () => ev(`document.getElementById("carried-note").textContent + " | step2 hidden: " + document.getElementById("carried-file-row").hidden`);
check("kamerayla okunan mühür: dosyayı ekleme adımı açıldı", /Sealed record loaded: 200,000 bytes, SEAL-7, signed by sender [0-9a-f ]{19}.*step2 hidden: false/.test(await carriedNote()), await carriedNote());
await setFile("#carried-file", `${SP}/seal-other.bin`); await sleep(1500);
check("yanlış dosya: reddedilir, makbuz imzalanmaz", /^bad: seal-other\.bin is not the file that was sealed/.test(await notice()) && !(await ev(`Boolean(document.querySelector("#result a[download$='.makbuz.json']"))`)), await notice());
await setFile("#carried-file", `${SP}/seal.bin`); await sleep(2500);
const delivered = await ev(`document.getElementById("result").textContent`);
check("doğru dosya: teslim edildi, iki imza doğrulandı", /The file matches the sealed record and both signatures are verified\. It travelled outside Kionel/.test(delivered) && /SEAL-7/.test(delivered), delivered.slice(0, 160));
check("teslim makbuzu indirilebilir, durum satırı yazıyor", (await ev(`Boolean(document.querySelector("#result a[download='seal.bin.makbuz.json']"))`)) && /File checked against the sealed record\. Delivery receipt signed/.test(await stats()), await stats());
check("teslimden sonra ikinci adım kapanır", /Delivered\. To receive another carried file.*step2 hidden: true/.test(await carriedNote()), await carriedNote());

// Mühür kaydı dosyadan da yüklenir: alıcıda kamera gerekmez.
await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
await ev(`document.getElementById("tab-send").click()`); await sleep(500);
await ev(`[...document.querySelectorAll("#dispatch-result a.dl")].find((a) => /seal\.json$/.test(a.download)).click()`);
for (let i = 0; i < 20 && !existsSync(`${SP}/seal.bin.seal.json`); i++) await sleep(300);
await ev(`document.getElementById("tab-recv").click()`); await sleep(500);
await setFile("#carried-seal", `${SP}/seal-not-a-record.json`); await sleep(1000);
check("mühür olmayan dosya: nedenini söylüyor", /^bad: seal-not-a-record\.json is not a sealed record this device can verify/.test(await notice()), await notice());
await setFile("#carried-seal", `${SP}/seal.bin.seal.json`); await sleep(1200);
check("mühür kaydı dosyadan yüklendi: olumlu mesaj, ikinci adım açık", /^ok: Sealed record loaded and its signature verified/.test(await notice()) && /step2 hidden: false/.test(await carriedNote()), await notice());
await setFile("#carried-file", `${SP}/seal.bin`); await sleep(2000);
check("aynı sevk ikinci kez imzalanmaz, nedeni yazılı", /^warn: seal\.bin was already received on .+ with the same sealed record\. It was not signed again/.test(await notice()), await notice());
check("JS hatası yok", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
