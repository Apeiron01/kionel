// Yalnız mühürleme: dosya aktarılmaz, mühür kodu telefona geçer.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
writeFileSync(`${SP}/close.bin`, randomBytes(50_000));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9353", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-close-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4500);
const target = (await (await fetch("http://127.0.0.1:9353/json")).json()).find((t) => t.type === "page");
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
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.confirm = () => true; try { localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); } catch {}` });
const hidden = (id) => ev(`document.getElementById(${JSON.stringify(id)}).hidden`);
const text = (id) => ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);

// Bağlantı kodu aç/kapat
await ev(`document.getElementById("pair-qr").click()`); await sleep(300);
check("bağlantı kodu açıldı, düğme 'Hide'", !(await hidden("pair-canvas")) && /Hide the link/.test(await text("pair-qr")));
await ev(`document.getElementById("pair-qr").click()`); await sleep(200);
check("bağlantı kodu kapandı", (await hidden("pair-canvas")) && (await hidden("pair-note")) && /Show link/.test(await text("pair-qr")));

// Lisans yok: kaldır düğmesi görünmez
check("lisans yokken 'Remove licence' gizli", await hidden("licence-forget"));
await setFile("#license-file", LICENSE); await sleep(1500);
check("lisans yüklenince 'Remove licence' görünür", !(await hidden("licence-forget")));

// Lisans kodu aç/kapat
await ev(`document.querySelector(".licence-move").open = true; document.getElementById("licence-show").click()`); await sleep(400);
check("lisans kodu açıldı, düğme 'Hide'", !(await hidden("licence-qr")) && /Hide the licence code/.test(await text("licence-show")));
await ev(`document.getElementById("licence-show").click()`); await sleep(200);
check("lisans kodu kapandı + olumlu mesaj", (await hidden("licence-qr")) && /Licence code hidden/.test(await notice()), await notice());

// Dosya seç / kaldır
check("dosya yokken 'Remove file' gizli", await hidden("file-clear"));
await setFile("#file", `${SP}/close.bin`); await sleep(1500);
check("dosya seçilince 'Remove file' görünür", !(await hidden("file-clear")));
await ev(`document.getElementById("context-reference").value = "CLOSE-1"; document.getElementById("typed-code").value = "7K3Q-M9XD-4PLA"; document.getElementById("code-send").click()`); await sleep(4000);
check("gönderim başladı", !(await hidden("send-stop")), await notice());
await ev(`document.getElementById("file-clear").click()`); await sleep(500);
check("kaldırınca gönderim durdu ve kod kalktı", (await hidden("send-stop")) && (await ev(`document.getElementById("qr").hidden`)), `stop:${await hidden("send-stop")} qr:${await ev(`document.getElementById("qr").hidden`)}`);
check("kaldırınca dosya etiketi sıfırlandı", /^Choose file$/.test((await ev(`document.getElementById("file").parentElement.textContent`)).trim()));
check("kaldırınca olumlu mesaj", /^ok: .*close\.bin removed/.test(await notice()), await notice());
check("'Remove file' yeniden gizli", await hidden("file-clear"));

// Mühür kodu gizle
await setFile("#file", `${SP}/close.bin`); await sleep(1500);
await ev(`document.getElementById("context-reference").value = "SEAL-9"; document.getElementById("seal-only").click()`); await sleep(1500);
check("mühür kodu görünür", !(await hidden("seal-qr")));
await ev(`[...document.querySelectorAll("#dispatch-result button")].find(b => /Hide the seal code/.test(b.textContent)).click()`); await sleep(300);
check("mühür kodu gizlendi + olumlu mesaj", (await hidden("seal-qr")) && /Seal code hidden/.test(await notice()), await notice());

// Lisansı kaldır
await ev(`document.getElementById("licence-forget").click()`); await sleep(1200);
check("lisans kaldırıldı + olumlu mesaj", /^ok: Licence removed/.test(await notice()), await notice());
check("durum kişisel sürüm", /Personal edition \(free\)/.test(await text("license-status")));
check("'Remove licence' gizlendi, dosya düğmesi sıfır", (await hidden("licence-forget")) && /Load licence file/.test(await ev(`document.getElementById("license-file").parentElement.textContent`)));

// SHA aracı: kaldır
await send("Page.navigate", { url: `${BASE}/sha256-file-checksum.html` }); await sleep(2000);
await setFile("#hash-file", `${SP}/close.bin`); await sleep(1000);
await ev(`document.getElementById("hash-clear").click()`); await sleep(200);
check("SHA: kaldırınca sonuç gizli + olumlu mesaj", (await hidden("hash-output")) && /File removed/.test(await text("hash-status")) && !(await ev(`document.getElementById("hash-drop").classList.contains("loaded")`)));

// Doğrulama sayfası: kaldır
await send("Page.navigate", { url: `${BASE}/verify.html` }); await sleep(2000);
await setFile("#content-file", `${SP}/close.bin`); await sleep(800);
const rm = `document.getElementById("content-drop").nextElementSibling`;
check("doğrulama: dosya eklenince 'Remove' görünür", await ev(`!${rm}.hidden && ${rm}.textContent === "Remove"`));
await ev(`${rm}.click()`); await sleep(300);
check("doğrulama: kaldırınca alan sıfırlandı", await ev(`!document.getElementById("content-drop").classList.contains("loaded") && ${rm}.hidden && /Optional: drop the original/.test(document.getElementById("content-drop").textContent)`));
check("JS hatası yok", errors.length === 0, errors.join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
