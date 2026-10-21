// "Şimdi çek, sonra oku": kayıt bir tarayıcıda çekilir, başka bir tarayıcıda
// (başka cihaz, sayfa yeniden açılmış) kod elle yazılarak okunur.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const payload = randomBytes(30_000);
writeFileSync(`${SP}/tsa.bin`, payload);
const want = createHash("sha256").update(payload).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-tsa-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = []; const hooks = {};
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method && hooks[m.method]) hooks[m.method](m.params); if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(4000);
  await ev(`localStorage.setItem("kionel.flash-warning.v1", String(Date.now()))`);
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  return { ev, setFile, errors, send, hooks, close: () => { ws.close(); chrome.kill(); } };
}
// 1) Çekim anı
const a = await browser(9368);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.setFile("#file", `${SP}/tsa.bin`); await sleep(2000);
await a.ev(`document.getElementById("preset-record").click()`);
await a.ev(`document.getElementById("tab-recv").click()`); await sleep(1500);
await a.ev(`document.querySelector('[data-pair="code"]').click()`);
const code = await a.ev(`document.getElementById("code-display").textContent`);
await a.ev(`document.getElementById("tab-send").click()`);
await a.ev(`document.getElementById("context-reference").value = "LATER-1"; document.getElementById("typed-code").value = "${code}"; document.getElementById("code-send").click()`);
await sleep(1500);
const b64 = await a.ev(`new Promise((resolve) => { const s = document.getElementById("qr").captureStream(30); const r = new MediaRecorder(s, { videoBitsPerSecond: 8000000 }); const c = []; r.ondataavailable = (e) => c.push(e.data); r.onstop = async () => { const buf = new Uint8Array(await new Blob(c).arrayBuffer()); let bin = ""; for (let i = 0; i < buf.length; i += 32768) bin += String.fromCharCode(...buf.subarray(i, i + 32768)); resolve(btoa(bin)); }; r.start(500); setTimeout(() => r.stop(), 6000); })`);
writeFileSync(`${SP}/tsa.webm`, Buffer.from(b64, "base64"));
check("çekim kaydedildi", b64.length > 1000, `${Math.round(b64.length * 0.75 / 1024)} KB`);
{ const t = await a.ev(`document.getElementById("send-timer").textContent`); check("gönderen sayacı ilerliyor", /^Sending · 0:0[5-9]$/.test(t), t); }
a.close();


const b = await browser(9369);
const note = () => b.ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
// /api/timestamp → gerçek DigiCert (önizleme sunucusunda Worker yok)
let tsaMode = "forward"; let tsaCalls = 0;
b.hooks["Fetch.requestPaused"] = async (p) => {
  tsaCalls++;
  // LIVE=1: istek gerçek sunucudaki aktarıcıya gider (kionel.com → DigiCert).
  if (tsaMode !== "down" && process.env.LIVE) return b.send("Fetch.continueRequest", { requestId: p.requestId });
  if (tsaMode === "down") return b.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 503, responseHeaders: [{ name: "Content-Type", value: "application/json" }], body: Buffer.from("{}").toString("base64") });
  const query = Buffer.from(p.request.postDataEntries.map((e) => e.bytes).join(""), "base64");
  const reply = await fetch("http://timestamp.digicert.com", { method: "POST", headers: { "Content-Type": "application/timestamp-query" }, body: query });
  const body = Buffer.from(await reply.arrayBuffer()).toString("base64");
  await b.send("Fetch.fulfillRequest", { requestId: p.requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/timestamp-reply" }], body });
};
await b.send("Fetch.enable", { patterns: [{ urlPattern: "*/api/timestamp*", requestStage: "Request" }] });
// Canlı sitenin CSP'si (connect-src 'self') testin blob: indirmesini okumasına izin vermez;
// kullanıcının indirmesi gezintidir, etkilenmez. Yalnız bu test oturumunda atlanır.
if (process.env.LIVE) { await b.send("Page.setBypassCSP", { enabled: true }); await b.send("Page.reload"); await sleep(3500); }
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(800);
await b.ev(`document.getElementById("tsa-enabled").click()`); await sleep(300);
check("lisanssız: zaman damgası işletme uyarısı, kutu işaretsiz", /needs a business licence/.test(await note()) && !(await b.ev(`document.getElementById("tsa-enabled").checked`)), await note());
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tsa-enabled").click()`); await sleep(300);
check("damga açıldı: olumlu mesaj", /^ok: Each receipt will get a trusted timestamp/.test(await note()), await note());
const readOnce = async () => {
  await b.ev(`document.querySelector('[data-read="file"]').click()`);
  await b.ev(`document.getElementById("recording-code").value = "${code}"`);
  await b.setFile("#record-open", `${SP}/tsa.webm`);
  let res = "";
  for (let i = 0; i < 40; i++) { await sleep(1000); res = await b.ev(`document.getElementById("result").textContent`); if (/Download the dual-signed/.test(res) || /rejected/.test(res)) break; }
  await sleep(1000);
  return res;
};
await readOnce();
const n1 = await note();
check("teslim: DigiCert zamanı mesajda", /^ok: .*Trusted time from DigiCert: 20\d\d-\d\d-\d\d \d\d:\d\d:\d\d UTC/.test(n1), n1.slice(-120));
const receiptText = await b.ev(`(async () => { const a = [...document.querySelectorAll("#result a")].find(x => /makbuz\.json$/.test(x.download)); return a ? await (await fetch(a.href)).text() : ""; })()`);
const receipt = JSON.parse(receiptText || "{}");
check("makbuzda tst (jeton + zaman)", typeof receipt.tst?.token === "string" && receipt.tst.token.length > 1000 && /^20\d\d-/.test(receipt.tst.at), JSON.stringify(receipt.tst ?? {}).slice(0, 80));
check("aktarıcı bir kez çağrıldı", tsaCalls === 1, String(tsaCalls));
writeFileSync(`${SP}/tsa-receipt.json`, receiptText);
receipt.tst.at = "2020-01-01T00:00:00.000Z";
writeFileSync(`${SP}/tsa-edited.json`, JSON.stringify(receipt, null, 2));
// Servis cevap vermezse: damgasız ama geçerli teslim, uyarıyla
tsaMode = "down";
await readOnce();
const n2 = await note();
check("servis yok: uyarı, teslim yine geçerli", /^warn: .*No trusted timestamp: the timestamp service did not answer/.test(n2), n2.slice(-140));
// Doğrulama sayfası: damga tarayıcıda doğrulanır
await b.send("Page.navigate", { url: `${BASE}/verify.html` }); await sleep(4000);
await b.setFile("#record-file", `${SP}/tsa-receipt.json`); await sleep(4000);
const v1 = await b.ev(`document.getElementById("verify-result").textContent`);
check("doğrulama sayfası: damga ✓ ve başlıkta bağımsız otorite", /Trusted time \(independent timestamp\)✓ Pass/.test(v1) && /independent authority confirms/.test(v1), v1.slice(0, 200));
await b.send("Page.navigate", { url: `${BASE}/verify.html` }); await sleep(4000);
await b.setFile("#record-file", `${SP}/tsa-edited.json`); await sleep(4000);
const v2 = await b.ev(`document.getElementById("verify-result").textContent`);
check("elle değiştirilmiş zaman: geçersiz", /^Not valid: the readable time next to the timestamp was edited/.test(v2), v2.slice(0, 160));
check("JS hatası yok", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
b.close(); process.exit(fail ? 1 : 0);
