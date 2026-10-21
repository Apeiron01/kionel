// Çevrimdışı paketin kabul testi, kullanıcının yaptığı gibi:
//  0) paket sayfasından GERÇEK tarayıcı indirmesi, SHA-256 yayımlananla aynı mı
//  A) indirilen dosya gönderen olarak (dosyadan açık): iki dosya → ZIP, kayıt modu
//  B) aynı dosya alıcı olarak: kaydı okur, klasöre yazar; makbuz komut satırı doğrulayıcısıyla
//  C) aynı dosya alıcı olarak, sahte kamerayla canlı okuma
// Kullanım: node tools/e2e/e2e-package.mjs <scratch> <site-url> <license.json> <repo-root>
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const [SP, SITE, LICENSE, ROOT] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
const sha = (b) => createHash("sha256").update(b).digest("hex");

async function browser(port, flags = [], before = "") {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run",
    "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", ...flags, `--user-data-dir=${SP}/chrome-pkg-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); } catch {} ${before}` });
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: Array.isArray(path) ? path : [path] }); };
  const note = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
  return { ev, send, setFile, note, errors, close: () => { ws.close(); chrome.kill(); } };
}

// ---- 0) tarayıcıyla indirme ----------------------------------------------------
const releases = JSON.parse(readFileSync(`${ROOT}/tools/offline-releases.json`, "utf8"));
const latest = releases[0];
const dl = await browser(9390);
const setDl = await dl.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
if (setDl.error) console.log("indirme ayarı:", JSON.stringify(setDl.error));
await dl.send("Page.navigate", { url: `${SITE}/offline-package.html` }); await sleep(3000);
await dl.ev(`[...document.querySelectorAll("a[download]")].find(a => a.textContent.startsWith("Download kionel-offline")).click()`);
const target = `${SP}/${latest.file}`;
for (let i = 0; i < 60 && !existsSync(target); i++) await sleep(500);
if (!existsSync(target)) console.log("indirme klasörü:", readdirSync(SP).filter((f) => /kionel-offline|crdownload/.test(f)).join(", ") || "boş");
await sleep(1000);
dl.close();
const downloaded = existsSync(target) ? readFileSync(target) : Buffer.alloc(0);
check(`tarayıcıyla indirilen ${latest.file} yayımlanan SHA-256 ile aynı`, sha(downloaded) === latest.sha256, `${sha(downloaded).slice(0, 16)} / ${latest.sha256.slice(0, 16)}`);
check("indirilen dosyada dış betik yok", !downloaded.toString("utf8").includes("cloudflareinsights"));
const PKG = `file:///${target.replace(/^\/+/, "")}`;

// ---- A) gönderen: iki dosya, kayıt modu -------------------------------------------
const f1 = Buffer.from("numune,sonuc\nP-1,0.8\nP-2,1.1\n", "utf8"); const f2 = randomBytes(15_000);
writeFileSync(`${SP}/pkg-sonuc.csv`, f1); writeFileSync(`${SP}/pkg-ham.bin`, f2);
const a = await browser(9391);
await a.send("Page.navigate", { url: PKG }); await sleep(3000);
check("A: paket sürümü ve derlemesi sayfanın altında", new RegExp(`^Kionel offline package ${latest.version.replace(/\./g, "\\.")} · build ${latest.commit}$`).test(await a.ev(`document.getElementById("build-id").textContent`)));
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.setFile("#file", [`${SP}/pkg-sonuc.csv`, `${SP}/pkg-ham.bin`]); await sleep(2000);
check("A: iki dosya tek ZIP", /^ok: 2 files packed into kionel-2-files-/.test(await a.note()), (await a.note()).slice(0, 80));
await a.ev(`document.getElementById("preset-record").click()`);
await a.ev(`document.getElementById("context-reference").value = "PKG-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const recordCanvas = (seconds) => a.ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(30); const r = new MediaRecorder(s, { videoBitsPerSecond: 8000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = async () => { window.__rec = new Blob(c, { type: "video/webm" }); const buf = new Uint8Array(await window.__rec.arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); resolve(btoa(bin)); }; r.start(500); setTimeout(() => r.stop(), ${seconds * 1000}); })`);
writeFileSync(`${SP}/pkg.webm`, Buffer.from(await recordCanvas(6), "base64"));
await a.ev(`document.getElementById("send-stop").click()`);

// ---- B) alıcı paket: kaydı okur, klasöre yazar ---------------------------------------
const b = await browser(9392);
await b.send("Page.navigate", { url: PKG }); await sleep(3000);
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(1000);
check("B: pakette zaman damgası kutusu gizli, nedeni yazılı",
  (await b.ev(`document.getElementById("tsa-enabled").closest("label").hidden`)) === true &&
  /website version at kionel\.com/.test(await b.ev(`document.getElementById("tsa-note").textContent`)));
// file:// sayfasında tarayıcının özel dosya sistemi (OPFS) yoktur; gerçek seçici açılır,
// başsız tarayıcı onu hemen iptal eder. İptal sessiz kalmalı, hata mesajı çıkmamalı.
await b.send("Runtime.evaluate", { userGesture: true, expression: `document.getElementById("folder-choose").click()` }); await sleep(1500);
check("B: klasör seçici dosyadan açılan pakette açılıyor, iptal sessiz", !/folder could not be used/.test(await b.note()) && !(await b.ev(`document.getElementById("folder-choose").hidden`)), await b.note());
await b.ev(`document.querySelector('[data-read="file"]').click()`);
await b.ev(`document.getElementById("recording-code").value = "${code}"`);
await b.setFile("#record-open", `${SP}/pkg.webm`);
let res = "";
for (let i = 0; i < 40; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(res)) break; }
await sleep(1500);
check("B: ZIP teslim edildi ve doğrulandı", /kionel-2-files-.*\.zip/.test(res) && /verified/.test(res), res.slice(0, 90));
const link = (re) => b.ev(`(async () => { const a = [...document.querySelectorAll("#result a")].find(x => ${re}.test(x.download)); const buf = new Uint8Array(await (await fetch(a.href)).arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 32768) s += String.fromCharCode(...buf.subarray(i, i + 32768)); return btoa(s); })()`);
writeFileSync(`${SP}/pkg-received.zip`, Buffer.from(await link("/\.zip$/"), "base64"));
writeFileSync(`${SP}/pkg-receipt.json`, Buffer.from(await link("/makbuz\.json$/"), "base64"));
const zip = JSON.parse(execFileSync("python", ["-c", "import sys,zipfile,hashlib,json\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({'bad':z.testzip(),'sha':{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}}))", `${SP}/pkg-received.zip`], { encoding: "utf8" }));
check("B: ZIP içindeki dosyalar kaynakla birebir", zip.bad === null && zip.sha["pkg-sonuc.csv"] === sha(f1) && zip.sha["pkg-ham.bin"] === sha(f2), JSON.stringify(Object.keys(zip.sha)));
const cli = (() => { try { return execFileSync("node", ["--experimental-strip-types", "--no-warnings", `${ROOT}/apps/verify/verify.ts`, `${SP}/pkg-receipt.json`, `${SP}/pkg-received.zip`], { encoding: "utf8", cwd: ROOT }); } catch (e) { return String(e.stdout ?? e); } })();
check("B: makbuz komut satırı doğrulayıcısından geçti (iki imza + içerik)", /^GEÇERLİ — alıcı \+ gönderen imzası doğrulandı, içerik eşleşti/.test(cli), cli.split("\n")[0]);
check("B: makbuzda iş emri", readFileSync(`${SP}/pkg-receipt.json`, "utf8").includes("PKG-1"));

// ---- C) alıcı paket, canlı kamera ------------------------------------------------
await a.ev(`document.getElementById("preset-live").click()`);
await a.setFile("#file", `${SP}/pkg-sonuc.csv`); await sleep(1500);
await a.ev(`document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
await recordCanvas(5);
const count = await a.ev(`new Promise(async (resolve) => { const v = document.createElement("video"); v.muted = true; v.src = URL.createObjectURL(window.__rec); const c = document.createElement("canvas"); const ctx = c.getContext("2d"); window.__frames = []; let pending = 0, ended = false; const done = () => { if (ended && !pending) resolve(window.__frames.length); }; const onf = () => { c.width = v.videoWidth; c.height = v.videoHeight; ctx.drawImage(v, 0, 0); pending++; c.toBlob(async (b) => { window.__frames.push(new Uint8Array(await b.arrayBuffer())); pending--; done(); }, "image/jpeg", 0.95); if (!v.ended) v.requestVideoFrameCallback(onf); }; v.onended = () => { ended = true; done(); }; v.playbackRate = 0.5; v.requestVideoFrameCallback(onf); await v.play(); })`);
const parts = [];
for (let i = 0; i < count; i++) parts.push(Buffer.from(await a.ev(`(() => { const f = window.__frames[${i}]; let s = ""; for (let j = 0; j < f.length; j += 32768) s += String.fromCharCode(...f.subarray(j, j + 32768)); return btoa(s); })()`), "base64"));
writeFileSync(`${SP}/pkg-live.mjpeg`, Buffer.concat(parts));
a.close();
const c = await browser(9393, ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--use-file-for-fake-video-capture=${SP}/pkg-live.mjpeg`],
  `sessionStorage.setItem("kionel.transfer-code.v1", JSON.stringify({ code: ${JSON.stringify(code.replace(/-/g, ""))}, at: Date.now() }));`);
await c.send("Page.navigate", { url: PKG }); await sleep(3000);
await c.ev(`document.getElementById("tab-recv").click()`); await sleep(1200);
await c.ev(`document.querySelector('[data-pair="code"]').click(); document.querySelector('[data-read="live"]').click()`);
let live = "";
for (let i = 0; i < 60; i++) { await sleep(1000); live = await c.ev(`document.getElementById("result").textContent`); if (/verified|checked|rejected/.test(live)) break; }
check(`C: dosyadan açılan paket canlı kamerayla aldı (${count} kare)`, /pkg-sonuc\.csv/.test(live) && /(verified|intact)/.test(live), live.slice(0, 90));
check("hiçbir tarayıcıda JS hatası yok", [...a.errors, ...b.errors, ...c.errors].length === 0, [...a.errors, ...b.errors, ...c.errors].slice(0, 2).join(" | "));
b.close(); c.close();
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
