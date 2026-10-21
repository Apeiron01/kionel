// "Şimdi çek, sonra oku": kayıt bir tarayıcıda çekilir, başka bir tarayıcıda
// (başka cihaz, sayfa yeniden açılmış) kod elle yazılarak okunur.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const payload = randomBytes(30_000);
writeFileSync(`${SP}/folder.bin`, payload);
const want = createHash("sha256").update(payload).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-folder-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(4000);
  await ev(`localStorage.setItem("kionel.flash-warning.v1", String(Date.now()))`);
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  return { ev, setFile, errors, send, close: () => { ws.close(); chrome.kill(); } };
}
// 1) Çekim anı
const a = await browser(9366);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.setFile("#file", `${SP}/folder.bin`); await sleep(2000);
await a.ev(`document.getElementById("preset-record").click()`);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1500);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.ev(`document.getElementById("context-reference").value = "LATER-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const b64 = await a.ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(30); const r = new MediaRecorder(s, { videoBitsPerSecond: 8000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = async () => { const buf = new Uint8Array(await new Blob(c).arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); resolve(btoa(bin)); }; r.start(500); setTimeout(() => r.stop(), 6000); })`);
writeFileSync(`${SP}/folder.webm`, Buffer.from(b64, "base64"));
check("çekim kaydedildi", b64.length > 1000, `${Math.round(b64.length * 0.75 / 1024)} KB`);
{ const t = await a.ev(`document.getElementById("send-timer").textContent`); check("gönderen sayacı ilerliyor", /^Sending · 0:0[5-9]$/.test(t), t); }
a.close();

const b = await browser(9367);
const note = () => b.ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
const txt = (id) => b.ev(`document.getElementById(${JSON.stringify(id)}).textContent`);
const hid = (id) => b.ev(`document.getElementById(${JSON.stringify(id)}).hidden`);
// Lisanssız: işletme uyarısı
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(800);
await b.ev(`document.getElementById("folder-choose").click()`); await sleep(300);
check("lisanssız: klasöre kayıt işletme uyarısı", /needs a business licence/.test(await note()), await note());
await b.setFile("#license-file", LICENSE); await sleep(1500);
// Klasör seçici yerine tarayıcının özel dosya sistemi (aynı arayüz)
await b.ev(`window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("lims", { create: true })`);
await b.ev(`document.getElementById("folder-choose").click()`); await sleep(800);
check("klasör seçildi: olumlu mesaj", /^ok: Received files will be saved to "lims"/.test(await note()), await note());
check("klasör seçildi: 'Stop saving' görünür, durum yazıyor", !(await hid("folder-clear")) && /Saving to the folder "lims"/.test(await txt("folder-status")));
const listing = () => b.ev(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("lims"); const out = []; for await (const [n, h] of d.entries()) out.push(n + ":" + (await h.getFile()).size); return out.sort().join(" | "); })()`);
const readOnce = async () => {
  await b.ev(`document.querySelector('[data-read="file"]').click()`);
  await b.ev(`document.getElementById("recording-code").value = "${code}"`);
  await b.setFile("#record-open", `${SP}/folder.webm`);
  let res = "";
  for (let i = 0; i < 40; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(res)) break; }
  await sleep(1500);
  return res;
};
const r1 = await readOnce();
check("teslim edildi", /verified/.test(r1), r1.slice(0, 80));
check("klasöre kaydedildi: olumlu mesaj", /^ok: folder\.bin and folder\.bin\.makbuz\.json saved to "lims"/.test(await note()), await note());
const l1 = await listing();
check("klasörde dosya (30000 bayt) ve makbuz", /folder\.bin:30000/.test(l1) && /folder\.bin\.makbuz\.json:\d+/.test(l1), l1);
const savedHash = await b.ev(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("lims"); const f = await (await d.getFileHandle("folder.bin")).getFile(); const h = new Uint8Array(await crypto.subtle.digest("SHA-256", await f.arrayBuffer())); return Array.from(h, x => x.toString(16).padStart(2, "0")).join(""); })()`);
check("klasördeki dosya birebir aynı (SHA-256)", savedHash === want);
const r2 = await readOnce();
const l2 = await listing();
check("ikinci teslim üzerine yazmaz: '(2)' adı", /verified/.test(r2) && /folder \(2\)\.bin:30000/.test(l2) && /folder \(2\)\.bin\.makbuz\.json/.test(l2), l2);
// Dosya adı şablonu
const setTemplate = async (v) => { await b.ev(`(i => { i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("change")); })(document.getElementById("folder-template"))`); await sleep(400); };
await setTemplate("{wo}_{name}");
check("bilinmeyen şablon alanı reddedilir", /^bad: File-name pattern not changed: \{wo\} is not a field/.test(await note()), await note());
await setTemplate("{workorder}_{name}");
check("şablon kaydedildi: örnek adla olumlu mesaj", /^ok: Files saved to the folder will be named like WO-004213_results\.csv/.test(await note()), await note());
const r3 = await readOnce();
const l3 = await listing();
check("şablonla kayıt: iş emri adda, makbuz dosyayı izliyor", /verified/.test(r3) && /LATER-1_folder\.bin:30000/.test(l3) && /LATER-1_folder\.bin\.makbuz\.json/.test(l3), l3);
// Yeniden açınca klasör hatırlanır
await b.send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);
check("sayfa yeniden açılınca klasör hatırlanıyor", /Saving to the folder "lims"/.test(await txt("folder-status")), await txt("folder-status"));
check("şablon da hatırlanıyor", (await b.ev(`document.getElementById("folder-template").value`)) === "{workorder}_{name}");
await setTemplate("");
check("şablon boşaltıldı: özgün ad mesajı", /^ok: Files saved to the folder keep the sender's file name/.test(await note()), await note());
await b.ev(`document.getElementById("folder-clear").click()`); await sleep(500);
check("klasörü kaldır: olumlu mesaj, düğme gizli", /^ok: Stopped saving to "lims"/.test(await note()) && (await hid("folder-clear")), await note());
// Desteklemeyen tarayıcı
await b.send("Page.addScriptToEvaluateOnNewDocument", { source: `delete Window.prototype.showDirectoryPicker; delete window.showDirectoryPicker;` });
await b.send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);
check("desteklemeyen tarayıcı: seçenek gizli, açıklama var", (await hid("folder-choose")) && (await hid("folder-naming")) && /works in Chrome or Edge on a computer/.test(await txt("folder-status")), await txt("folder-status"));
check("JS hatası yok", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
b.close(); process.exit(fail ? 1 : 0);
