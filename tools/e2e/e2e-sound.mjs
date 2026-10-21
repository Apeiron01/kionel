// Sesle eşleşme, gerçek uygulama üzerinden: alıcı teklifini hoparlörden çalar, gönderen
// mikrofonla duyar, cevap QR'ını gösterir, iki ekrandaki kod aynı çıkar ve dosya aktarılır.
// Alıcının çaldığı ses sayfadan alınıp WAV olarak gönderenin sahte mikrofonuna verilir;
// gönderenin ekranı da alıcının sahte kamerasına.
// İşletme lisansı verilirse alıcı teslim makbuzunu da sesle çalar, gönderen duyup doğrular.
// Kullanım: node tools/e2e/e2e-sound.mjs <scratch> <site> [license.json]
// SENDER_URL=file:///…/kionel-offline-<sürüm>.html ile gönderen (dinleyen PC) çevrimdışı paketten çalışır.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const [SP, BASE, LICENSE] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };

async function browser(port, flags = [], hook = "", url = `${BASE}/transfer.html`) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors",
    "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", ...flags, `--user-data-dir=${SP}/chrome-sound-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push("console.error: " + m.params.args.map((x) => x.description ?? x.value).join(" ").slice(0, 300)); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `try { localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); } catch {}\n${hook}` });
  if (process.env.NET_LATENCY) { await send("Network.enable"); await send("Network.emulateNetworkConditions", { offline: false, latency: Number(process.env.NET_LATENCY), downloadThroughput: 400000, uploadThroughput: 400000 }); }
  await send("Page.navigate", { url }); await sleep(3500);
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  const note = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
  const text = (sel) => ev(`(e => !e || e.hidden ? "—" : e.textContent.trim())(document.getElementById(${JSON.stringify(sel)}))`);
  return { ev, send, setFile, note, text, errors, close: () => { ws.close(); chrome.kill(); } };
}

/** Sayfadaki tuvalden n kare alıp MJPEG dosyası yazar (sahte kamera girdisi). */
async function filmCanvas(page, n, path) {
  const count = await page.ev(`new Promise((resolve) => { const src = document.getElementById("qr"); const c = document.createElement("canvas"); c.width = src.width; c.height = src.height; const g = c.getContext("2d"); window.__frames = []; let n = 0; const tick = () => { g.drawImage(src, 0, 0); c.toBlob(async (b) => { window.__frames.push(new Uint8Array(await b.arrayBuffer())); if (++n >= ${n}) resolve(window.__frames.length); }, "image/jpeg", 0.95); if (n < ${n}) setTimeout(tick, 33); }; tick(); })`);
  const parts = [];
  for (let i = 0; i < count; i++) parts.push(Buffer.from(await page.ev(`(() => { const f = window.__frames[${i}]; let s = ""; for (let j = 0; j < f.length; j += 32768) s += String.fromCharCode(...f.subarray(j, j + 32768)); return btoa(s); })()`), "base64"));
  writeFileSync(path, Buffer.concat(parts));
}

/** Alıcının kamerasını kapatıp açar: sahte kamera dosyayı yeniden okur. */
async function showToCamera(receiver, sender, frames, path) {
  await receiver.ev(`document.getElementById("recv-pause").click()`); await sleep(800);
  await filmCanvas(sender, frames, path);
  await receiver.ev(`document.getElementById("recv-pause").click()`); await sleep(500);
}

/** Alıcının en son çaldığı sesi WAV olarak yazar (gönderenin sahte mikrofonu). */
async function playedToWav(page, path) {
  const played = JSON.parse(await page.ev(`(() => { const b = window.__played?.at(-1)?.buffer; if (!b) return "null"; const d = b.getChannelData(0); const pcm = new Int16Array(d.length); for (let i = 0; i < d.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767))); const u = new Uint8Array(pcm.buffer); let s = ""; for (let j = 0; j < u.length; j += 32768) s += String.fromCharCode(...u.subarray(j, j + 32768)); return JSON.stringify({ rate: b.sampleRate, seconds: b.duration, pcm: btoa(s) }); })()`));
  if (!played) return undefined;
  const pcm = Buffer.from(played.pcm, "base64");
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(played.rate, 24); header.writeUInt32LE(played.rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
  return played;
}

const VIDEO = `${SP}/sound-camera.mjpeg`;
const WAV = `${SP}/sound-offer.wav`;
const payload = Buffer.from("numune,sonuc\nSOUND-1,0.8\nSOUND-2,1.2\n");
writeFileSync(`${SP}/sound.csv`, payload);
// Gönderen önce açılır: boş tuvali, alıcının kamerasının ilk göreceği görüntü olur.
// WAV dosyası henüz yok; Chrome onu mikrofon açılınca okur.
const sender = await browser(9432, [`--use-file-for-fake-audio-capture=${WAV}`], "", process.env.SENDER_URL);
await filmCanvas(sender, 5, VIDEO);

// ---- alıcı: teklifi sesle çalar -------------------------------------------------
const receiver = await browser(9431, [`--use-file-for-fake-video-capture=${VIDEO}`],
  // Çalınan arabellek yakalanır: telefonun hoparlöründen çıkacak sesin kendisi.
  `(() => { const W = Worker; window.__w = { made: 0, posted: 0, answered: 0, errors: 0, last: "" }; window.Worker = class extends W { constructor(...a) { super(...a); window.__w.made++; const me = { u: String(a[0]).split("/").pop().slice(0, 14), t: Math.round(performance.now()), p: 0, r: 0 }; (window.__w.list ||= []).push(me); this.__me = me; this.addEventListener("message", () => { window.__w.answered++; me.r++; }); this.addEventListener("error", (e) => { window.__w.errors++; window.__w.last = String(e.message); }); } postMessage(...a) { window.__w.posted++; this.__me.p++; return super.postMessage(...a); } terminate() { this.__me.x = Math.round(performance.now()); return super.terminate(); } }; })();
  (() => { const w = window.__w; w.copyStart = 0; w.copyEnd = 0; w.bmpStart = 0; w.bmpEnd = 0; const copy = VideoFrame.prototype.copyTo; VideoFrame.prototype.copyTo = function (...a) { w.copyStart++; return copy.apply(this, a).finally(() => { w.copyEnd++; }); }; const bmp = window.createImageBitmap; window.createImageBitmap = function (...a) { w.bmpStart++; return bmp.apply(this, a).finally(() => { w.bmpEnd++; }); }; })();
  (() => { const make = AudioContext.prototype.createBufferSource; AudioContext.prototype.createBufferSource = function () { const node = make.call(this); (window.__played ||= []).push(node); return node; }; })();`);
if (LICENSE) { await receiver.setFile("#license-file", LICENSE); await sleep(1500); }
await receiver.ev(`document.getElementById("tab-recv").click()`); await sleep(1500);
await receiver.ev(`document.querySelector('[data-pair="code"]').click()`); await sleep(500);
await receiver.ev(`document.getElementById("sound-play").click()`); await sleep(1500);
check("alıcı: ses çalıyor, olumlu mesaj", /^ok: Playing the pairing sound/.test(await receiver.note()), await receiver.note());
check("alıcı: durdur düğmesi görünür, süre yazıyor", (await receiver.ev(`!document.getElementById("sound-stop").hidden && document.getElementById("sound-play").hidden`)) && /about 6 seconds per round/.test(await receiver.text("sound-note")), await receiver.text("sound-note"));

const played = await playedToWav(receiver, WAV);
check("alıcı: çalınan ses 6 saniyeden kısa", Boolean(played) && played.seconds < 6, played ? `${played.seconds.toFixed(2)} s @ ${played.rate} Hz` : "ses yakalanamadı");

// ---- gönderen: mikrofonla duyar ---------------------------------------------------
await sender.ev(`document.getElementById("sound-listen").click()`); await sleep(500);
check("gönderen: dosya seçilmeden dinlemez, olumsuz mesaj", /^bad: Choose a file first/.test(await sender.note()), await sender.note());
await sender.setFile("#file", `${SP}/sound.csv`); await sleep(1500);
await sender.ev(`document.getElementById("context-reference").value = "SOUND-1"`);
await sender.ev(`document.getElementById("sound-listen").click()`);
let heard = "";
for (let i = 0; i < 40; i++) { await sleep(500); heard = await sender.note(); if (/^ok: Paired by sound/.test(heard)) break; }
check("gönderen: teklifi duydu, olumlu mesaj", /^ok: Paired by sound/.test(heard), heard);
check("gönderen: mikrofon kapandı, dinle düğmesi geri geldi", (await sender.text("sound-status")) === "Heard the receiver. The microphone is off again." || (await sender.ev(`document.getElementById("send-hint").hidden`)), await sender.text("sound-status"));
check("gönderen: tek yönlü kanal, karşılaştırma kodu ve onay düğmesi", /^Paired by sound\. .*simplex fountain/s.test(await sender.text("send-stats")) && (await sender.ev(`!document.getElementById("send-sas").hidden && !document.getElementById("send-confirm").hidden`)), await sender.text("send-stats"));

// ---- alıcı: cevap QR'ını kamerayla okur ---------------------------------------------
await showToCamera(receiver, sender, 20, VIDEO);
let paired = "";
for (let i = 0; i < 30; i++) { await sleep(500); paired = await receiver.note(); if (/^ok: Paired by sound/.test(paired)) break; }
check("alıcı: cevabı okudu, ses kendiliğinden durdu", /^ok: Paired by sound/.test(paired) && (await receiver.ev(`document.getElementById("sound-stop").hidden && !document.getElementById("sound-play").hidden`)), `${paired} | ${await receiver.text("recv-stats")} | ${await receiver.ev(`(() => { const v = document.querySelector("video:not([hidden])") ?? document.querySelector("video"); return document.getElementById("recv-pause").textContent + " · video " + (v ? [v.id, v.hidden, v.readyState, v.videoWidth, v.currentTime.toFixed(1), Boolean(v.srcObject)].join("/") : "yok"); })()`)} | workers ${await receiver.ev(`JSON.stringify(window.__w)`)} | ${receiver.errors.join(" ; ").slice(0, 300)}`);
if (!/^ok: Paired by sound/.test(paired)) writeFileSync(`${SP}/fail-frame.png`, Buffer.from((await receiver.ev(`(() => { const v = document.getElementById("recv-video"); const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0); return c.toDataURL("image/png").split(",")[1]; })()`)) ?? "", "base64"));
const sasSender = await sender.ev(`document.getElementById("send-sas").textContent.replace(/\\s+/g, " ").trim()`);
const sasReceiver = await receiver.ev(`document.getElementById("recv-sas").textContent.replace(/\\s+/g, " ").trim()`);
check("iki ekranda karşılaştırma kodu aynı", Boolean(sasSender) && sasSender === sasReceiver, `${String(sasSender).slice(0, 60)} | ${String(sasReceiver).slice(0, 60)}`);

// ---- aktarım -------------------------------------------------------------------
await receiver.ev(`document.getElementById("recv-confirm").click()`);
await sender.ev(`document.getElementById("send-confirm").click()`); await sleep(2500);
check("gönderen: gönderiyor, makbuzu dinleme düğmesi var, tarama düğmesi yok", /^ok: Sending\. .*Listen for the delivery receipt/.test(await sender.note()) && (await sender.ev(`document.getElementById("receipt-scan").hidden && !document.getElementById("receipt-listen").hidden`)), await sender.note());
await showToCamera(receiver, sender, 90, VIDEO);
let done = "";
// Lisanssız sürümde metin "received and checked"; işletmede "received and verified".
for (let i = 0; i < 60; i++) { await sleep(500); done = await receiver.note(); if (/received and (checked|verified)/.test(done)) break; }
check("alıcı: dosya alındı, olumlu mesaj", /^ok: sound\.csv received and (checked|verified)/.test(done), done.slice(0, 120));
const want = createHash("sha256").update(payload).digest("hex");
// Canlı sitenin CSP'si sayfadan blob: okumayı engeller; dosya indirilir ve diskten özetlenir.
mkdirSync(`${SP}/got`, { recursive: true });
await receiver.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: `${SP}/got`.replace(/\//g, "\\") });
await receiver.ev(`[...document.querySelectorAll("a.dl")].find((x) => x.download === "sound.csv")?.click()`);
for (let i = 0; i < 20 && !existsSync(`${SP}/got/sound.csv`); i++) await sleep(300);
const got = existsSync(`${SP}/got/sound.csv`) ? createHash("sha256").update(readFileSync(`${SP}/got/sound.csv`)).digest("hex") : "dosya indirilemedi";
check("alınan dosyanın SHA-256'sı gönderilenle aynı", got === want, String(got).slice(0, 40));

// ---- teslim makbuzu sesle geri döner (işletme) ----------------------------------------
if (LICENSE) {
  check("alıcı: makbuzu sesle çalıyor, durdur düğmesi görünür", /^Playing the delivery receipt, about 4 seconds per round/.test(await receiver.text("receipt-note")) && (await receiver.ev(`!document.getElementById("receipt-stop").hidden && document.getElementById("receipt-play").hidden`)), await receiver.text("receipt-note"));
  // Mikrofonda hâlâ eşleşme teklifinin sesi var: makbuz sayılmamalı.
  await sender.ev(`document.getElementById("receipt-listen").click()`);
  for (let i = 0; i < 40 && !/not a delivery receipt/.test(await sender.text("receipt-listen-status")); i++) await sleep(500);
  check("gönderen: makbuz olmayan sesi makbuz saymıyor, dinlemeye devam ediyor", /^A Kionel sound was heard, but it is not a delivery receipt/.test(await sender.text("receipt-listen-status")) && (await sender.ev(`!document.getElementById("receipt-unlisten").hidden && !document.querySelector("#dispatch-result a[download$='.makbuz.json']")`)), await sender.text("receipt-listen-status"));
  await sender.ev(`document.getElementById("receipt-unlisten").click()`); await sleep(300);
  check("gönderen: makbuz dinlemeyi durdurma, olumlu mesaj ve düğmeler", /^ok: Stopped listening\. The microphone is off/.test(await sender.note()) && (await sender.ev(`document.getElementById("receipt-unlisten").hidden && !document.getElementById("receipt-listen").hidden`)), await sender.note());
  const receiptSound = await playedToWav(receiver, WAV);
  check("alıcı: makbuz sesi 4 saniyeden kısa", Boolean(receiptSound) && receiptSound.seconds < 4, receiptSound ? `${receiptSound.seconds.toFixed(2)} s` : "ses yakalanamadı");
  await sender.ev(`document.getElementById("receipt-listen").click()`);
  let verified = "";
  for (let i = 0; i < 40; i++) { await sleep(500); verified = await sender.note(); if (/^ok: Delivery verified/.test(verified)) break; }
  check("gönderen: makbuzu duydu ve doğruladı, olumlu mesaj", /^ok: Delivery verified: the receiver signed that it received exactly this file/.test(verified), verified);
  check("gönderen: mikrofon kapandı, doğrulanmış makbuz indirilebilir", (await sender.text("receipt-listen-status")) === "Receipt heard and verified. The microphone is off again." && (await sender.ev(`document.getElementById("receipt-listen").hidden && document.getElementById("receipt-unlisten").hidden && Boolean(document.querySelector("#dispatch-result a[download='sound.csv.makbuz.json']"))`)), await sender.text("receipt-listen-status"));
  await receiver.ev(`document.getElementById("receipt-stop").click()`); await sleep(300);
  check("alıcı: makbuz sesini durdurma, olumlu mesaj ve düğmeler", /^ok: The receipt sound stopped/.test(await receiver.note()) && (await receiver.ev(`document.getElementById("receipt-stop").hidden && !document.getElementById("receipt-play").hidden`)), await receiver.note());
} else {
  check("lisanssız alıcı: makbuz sesi düğmesi yok", await receiver.ev(`document.getElementById("receipt-play").hidden && document.getElementById("receipt-stop").hidden`));
}

// ---- durdurma düğmeleri ve mikrofon reddi --------------------------------------------
await sender.setFile("#file", `${SP}/sound.csv`); await sleep(1500);
await sender.ev(`document.getElementById("sound-listen").click()`); await sleep(1500);
await sender.ev(`document.getElementById("sound-unlisten").click()`); await sleep(300);
check("gönderen: dinlemeyi durdurma, olumlu mesaj ve düğmeler", /^ok: Stopped listening\. The microphone is off/.test(await sender.note()) && (await sender.ev(`document.getElementById("sound-unlisten").hidden && !document.getElementById("sound-listen").hidden`)), await sender.note());
check("JS hatası yok", sender.errors.length + receiver.errors.length === 0, [...sender.errors, ...receiver.errors].slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
sender.close(); receiver.close(); process.exit(fail ? 1 : 0);
