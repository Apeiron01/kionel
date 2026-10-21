// Sürekli tek yönlü akış: gönderen bir klasörü izler, yeni ve değişen dosyaları alıcı kartına
// şifreleyip sahte seri hattan yollar; alıcı dinlemeye devam eder ve her dosyayı makbuzuyla
// klasörüne yazar. Önceden var olan dosya gitmez. Kullanım: node tools/e2e/e2e-stream.mjs <scratch> <site> <license.json>
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };

const FAKE = `(() => {
  const out = []; let feed; let opened = false;
  const port = {
    async open(o) { if (opened) { const e = new Error("open"); e.name = "InvalidStateError"; throw e; } opened = true;
      this.readable = new ReadableStream({ start(c) { feed = c; } });
      this.writable = new WritableStream({ write(chunk) { out.push(chunk.slice()); } }); },
    async close() { opened = false; this.readable = null; this.writable = null; },
    readable: null, writable: null,
  };
  Object.defineProperty(navigator, "serial", { value: { requestPort: async () => port } });
  window.__serialOut = () => { const n = out.reduce((s, c) => s + c.length, 0); if (!n) return ""; const all = new Uint8Array(n); let at = 0; for (const c of out.splice(0)) { all.set(c, at); at += c.length; } let bin = ""; for (let i = 0; i < all.length; i += 32768) bin += String.fromCharCode(...all.subarray(i, i + 32768)); return btoa(bin); };
  window.__serialIn = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); feed?.enqueue(u); };
  window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(window.__pickDir || "picked", { create: true });
  localStorage.setItem("kionel.flash-warning.v1", String(Date.now()));
})()`;

async function browser(port) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--user-data-dir=${SP}/chrome-stream-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE });
  await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(4000);
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  const note = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
  return { ev, send, setFile, errors, note, close: () => { ws.close(); chrome.kill(); } };
}
const writeFile = (b, dir, name, text) => b.ev(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("${dir}", { create: true }); const w = await (await d.getFileHandle("${name}", { create: true })).createWritable(); await w.write(${JSON.stringify(text)}); await w.close(); return true; })()`);
const listing = (b, dir) => b.ev(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("${dir}", { create: true }); const out = []; for await (const [n] of d.entries()) out.push(n); return out.sort().join(" | "); })()`);
const readText = (b, dir, name) => b.ev(`(async () => { const d = await (await navigator.storage.getDirectory()).getDirectoryHandle("${dir}"); return await (await (await d.getFileHandle("${name}")).getFile()).text(); })()`);
const sha = (s) => createHash("sha256").update(s).digest("hex");

// Alıcı: kart, klasör, sürekli dinleme
const b = await browser(9423);
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await b.ev(`document.querySelector('[data-pair="card"]').click()`); await sleep(300);
await b.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
await b.ev(`document.getElementById("card-label").value = "Historian PC"; document.getElementById("card-create").click()`); await sleep(1500);
await b.ev(`document.querySelector("#card-note a[download]")?.click()`);
let cardName = "";
for (let i = 0; i < 20 && !cardName; i++) { await sleep(300); cardName = readdirSync(SP).find((f) => /^kionel-receiver-card-.*\.json$/.test(f)) ?? ""; }
check("alıcı kartı oluşturuldu ve indirildi", Boolean(cardName), cardName);
await b.ev(`window.__pickDir = "hist"; document.getElementById("folder-choose").click()`); await sleep(800);
await b.ev(`document.querySelector('[data-read="serial"]').click(); document.getElementById("serial-keep").checked = true; document.getElementById("recv-serial-baud").value = "921600"; document.getElementById("serial-listen").click()`); await sleep(600);
check("alıcı dinliyor", /^ok: Listening on the serial port/.test(await b.note()), await b.note());

// Gönderen: kart, izlenen klasör (önceden bir dosya var), akışı başlat
const a = await browser(9424);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.setFile("#card-file", `${SP}/${cardName}`); await sleep(1000);
await a.ev(`document.getElementById("watch-start").click()`); await sleep(300);
await writeFile(a, "watch", "old.log", "önceden vardı\n");
await a.ev(`document.getElementById("context-reference").value = "LINE-3"; document.getElementById("serial-baud").value = "921600"; window.__pickDir = "watch"; document.getElementById("watch-folder").click()`); await sleep(800);
check("klasör seçildi: başlat düğmesi göründü", !(await a.ev(`document.getElementById("watch-start").hidden`)) && /Folder "watch" chosen/.test(await a.note()), await a.note());
await a.ev(`document.getElementById("watch-start").click()`); await sleep(1200);
check("izleme başladı: olumlu mesaj, durdur düğmesi", /^ok: Watching "watch"\. Each new or changed file is sent over the cable to Historian PC/.test(await a.note()) && !(await a.ev(`document.getElementById("watch-stop").hidden`)), await a.note());

const relay = async (ms) => { const until = Date.now() + ms; while (Date.now() < until) { const out = await a.ev(`__serialOut()`); if (out) await b.ev(`__serialIn("${out}")`); await sleep(400); } };
const one = "t,val\n" + Array.from({ length: 800 }, (_, i) => `${i},${(i * 0.37).toFixed(3)}`).join("\n");
await writeFile(a, "watch", "run-1.csv", one);
await relay(9000);
const two = "alarm: pressure high at 12:04\n".repeat(200);
await writeFile(a, "watch", "alarms.log", two);
await relay(9000);
await writeFile(a, "watch", "run-1.csv", one + "\n800,296.000");
await relay(9000);
const files = await listing(b, "hist");
check("alıcı klasörü: yeni iki dosya ve değişen dosyanın ikinci kopyası, her biri makbuzuyla", /alarms\.log \| alarms\.log\.makbuz\.json/.test(files) && /run-1 \(2\)\.csv \| run-1 \(2\)\.csv\.makbuz\.json \| run-1\.csv \| run-1\.csv\.makbuz\.json/.test(files), files);
check("önceden var olan dosya gönderilmedi", !/old\.log/.test(files));
check("içerikler birebir (SHA-256)", sha(await readText(b, "hist", "run-1.csv")) === sha(one) && sha(await readText(b, "hist", "alarms.log")) === sha(two) && sha(await readText(b, "hist", "run-1 (2).csv")) === sha(one + "\n800,296.000"));
check("gönderen durum satırı: 3 dosya", /3 files sent · last: run-1\.csv/.test(await a.ev(`document.getElementById("watch-status").textContent`)), await a.ev(`document.getElementById("watch-status").textContent`));
const receipt = JSON.parse(await readText(b, "hist", "alarms.log.makbuz.json"));
check("makbuzda iş emri ve kartla açılmış gönderen imzası", receipt.dispatch?.context?.reference === "LINE-3" && typeof receipt.dispatch?.sig === "string");

await a.ev(`document.getElementById("watch-stop").click()`); await sleep(1500);
check("izlemeyi durdur: özetli olumlu mesaj, port kapandı", /^ok: Stopped watching "watch"\. 3 files were sent\. The serial port is closed/.test(await a.note()) && !(await a.ev(`document.getElementById("watch-start").hidden`)), await a.note());
await b.ev(`document.getElementById("serial-unlisten").click()`); await sleep(800);
check("dinlemeyi durdur: alınan dosya sayısıyla mesaj", /^ok: Stopped listening\. 3 files were received/.test(await b.note()), await b.note());
check("JS hatası yok", a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
a.close(); b.close();
process.exit(fail ? 1 : 0);
