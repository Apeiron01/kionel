// "Şimdi çek, sonra oku": kayıt bir tarayıcıda çekilir, başka bir tarayıcıda
// (başka cihaz, sayfa yeniden açılmış) kod elle yazılarak okunur.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const p1 = randomBytes(20_000); const p2 = Buffer.from("numune,sonuç\nA-1,0.8\n", "utf8");
writeFileSync(`${SP}/multi-a.bin`, p1); writeFileSync(`${SP}/ölçüm sonuç.csv`, p2);
const want = { "multi-a.bin": createHash("sha256").update(p1).digest("hex"), "ölçüm sonuç.csv": createHash("sha256").update(p2).digest("hex") };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-multi-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
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
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: Array.isArray(path) ? path : [path] }); };
  return { ev, setFile, errors, close: () => { ws.close(); chrome.kill(); } };
}
// 1) Çekim anı
const a = await browser(9374);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.setFile("#file", [`${SP}/multi-a.bin`, `${SP}/ölçüm sonuç.csv`]); await sleep(2000);
check("iki dosya tek ZIP: olumlu mesaj", /^ok: 2 files packed into kionel-2-files-\d{8}-\d{4}\.zip, with MANIFEST-SHA256\.txt/.test(await a.ev(`(n => n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`)));
await a.ev(`document.getElementById("preset-record").click()`);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1500);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.ev(`document.getElementById("context-reference").value = "MULTI-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const b64 = await a.ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(30); const r = new MediaRecorder(s, { videoBitsPerSecond: 8000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = async () => { const buf = new Uint8Array(await new Blob(c).arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); resolve(btoa(bin)); }; r.start(500); setTimeout(() => r.stop(), 6000); })`);
writeFileSync(`${SP}/multi.webm`, Buffer.from(b64, "base64"));
check("çekim kaydedildi", b64.length > 1000, `${Math.round(b64.length * 0.75 / 1024)} KB`);
{ const t = await a.ev(`document.getElementById("send-timer").textContent`); check("gönderen sayacı ilerliyor", /^Sending · 0:0[5-9]$/.test(t), t); }
a.close();

const b = await browser(9375);
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await b.ev(`document.querySelector('[data-read="file"]').click()`);
await b.ev(`document.getElementById("recording-code").value = "${code}"`);
await b.setFile("#record-open", `${SP}/multi.webm`);
let res = "";
for (let i = 0; i < 40; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(res)) break; }
check("ZIP teslim edildi ve doğrulandı", /kionel-2-files-.*\.zip/.test(res) && /verified/.test(res), res.slice(0, 120));
const zipB64 = await b.ev(`(async () => { const a = [...document.querySelectorAll("#result a")].find(x => /\.zip$/.test(x.download)); const buf = new Uint8Array(await (await fetch(a.href)).arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768)); return btoa(s); })()`);
writeFileSync(`${SP}/multi-received.zip`, Buffer.from(zipB64, "base64"));
const { execFileSync } = await import("node:child_process");
const py = execFileSync("python", ["-c", "import sys,zipfile,hashlib,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({'bad':z.testzip(),'sha':{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()},'manifest':z.read('MANIFEST-SHA256.txt').decode()}))", `${SP}/multi-received.zip`], { encoding: "utf8" });
const zip = JSON.parse(py);
check("alınan ZIP geçerli (Python zipfile)", zip.bad === null);
check("içindeki dosyalar birebir aynı", zip.sha["multi-a.bin"] === want["multi-a.bin"] && zip.sha["ölçüm sonuç.csv"] === want["ölçüm sonuç.csv"], JSON.stringify(Object.keys(zip.sha)));
check("manifest sha256sum biçiminde ve doğru", zip.manifest === `${want["multi-a.bin"]}  multi-a.bin\n${want["ölçüm sonuç.csv"]}  ölçüm sonuç.csv\n`, zip.manifest);
check("JS hatası yok", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
b.close(); process.exit(fail ? 1 : 0);
