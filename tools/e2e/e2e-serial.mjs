// Seri kablo: iki tarayıcı sahte bir seri portla bağlanır; test baytları gönderenden
// alıcıya taşır, bir kısmını bozar. Dosya birebir gelmeli; hata ve durdurma mesajları görünmeli.
// Kullanım: node tools/e2e/e2e-serial.mjs <scratch> <site> <license.json>
// SENDER_URL=file:///…/kionel-offline-<sürüm>.html ile gönderen çevrimdışı paketten çalışır.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const payload = randomBytes(60_000);
mkdirSync(`${SP}/src`, { recursive: true });
writeFileSync(`${SP}/src/serial.bin`, payload); // indirilen kopyayla karışmasın
const want = createHash("sha256").update(payload).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };

// Sahte Web Serial: yazılan baytlar __serialOut'ta birikir; __serialIn(b64) okunacak baytları besler.
const FAKE = `(() => {
  const out = []; let feed; let opened = false;
  const port = {
    async open(o) { if (opened) { const e = new Error("open"); e.name = "InvalidStateError"; throw e; } opened = true; window.__baud = o.baudRate;
      this.readable = new ReadableStream({ start(c) { feed = c; } });
      this.writable = new WritableStream({ write(chunk) { out.push(chunk.slice()); } }); },
    async close() { opened = false; this.readable = null; this.writable = null; },
    readable: null, writable: null,
  };
  window.__cancelPick = false;
  Object.defineProperty(navigator, "serial", { value: { requestPort: async () => { if (window.__cancelPick) { const e = new Error("none"); e.name = "NotFoundError"; throw e; } return port; } } });
  window.__serialOut = () => { const n = out.reduce((s, c) => s + c.length, 0); const all = new Uint8Array(n); let at = 0; for (const c of out.splice(0)) { all.set(c, at); at += c.length; } let bin = ""; for (let i = 0; i < all.length; i += 32768) bin += String.fromCharCode(...all.subarray(i, i + 32768)); return btoa(bin); };
  window.__serialIn = (b64) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); feed?.enqueue(u); };
  localStorage.setItem("kionel.flash-warning.v1", String(Date.now()));
})()`;

async function browser(port, url = `${BASE}/transfer.html`) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", `--user-data-dir=${SP}/chrome-serial-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
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
  await send("Page.navigate", { url }); await sleep(4000);
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  const note = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
  return { ev, send, setFile, errors, note, close: () => { ws.close(); chrome.kill(); } };
}

const a = await browser(9417, process.env.SENDER_URL); // gönderen PC
const b = await browser(9418); // alıcı PC

// Lisanssız: işletme uyarısı
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(800);
await b.ev(`document.querySelector('[data-read="serial"]').click()`); await sleep(400);
check("lisanssız alıcı: seri kablo işletme uyarısı", /Receiving over a serial cable needs a business licence/.test(await b.note()), (await b.note()).slice(0, 90));

await a.setFile("#license-file", LICENSE); await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(600);
await b.ev(`document.querySelector('[data-read="serial"]').click()`); await sleep(300);
await b.ev(`document.getElementById("serial-listen").click()`); await sleep(500);
check("kamera modunda dinleme reddedilir, nedeni yazılı", /^bad: A serial cable carries data one way/.test(await b.note()), (await b.note()).slice(0, 80));
await b.ev(`document.querySelector('[data-pair="code"]').click()`); await sleep(300);
const code = await b.ev(`document.getElementById("code-display").textContent`);
await b.ev(`window.__cancelPick = true; document.getElementById("serial-listen").click()`); await sleep(500);
check("port seçilmezse uyarı, dinleme başlamaz", /^warn: No serial port chosen/.test(await b.note()) && !(await b.ev(`document.getElementById("serial-listen").hidden`)), await b.note());
check("deneysel hızlar iki seçicide de var ve öyle etiketli", await b.ev(`["serial-baud", "recv-serial-baud"].every((id) => ["1500000", "3000000"].every((v) => /experimental/.test(document.querySelector("#" + id + " option[value='" + v + "']")?.textContent ?? "")))`));
await b.ev(`window.__cancelPick = false; document.getElementById("recv-serial-baud").value = "921600"; document.getElementById("serial-listen").click()`); await sleep(500);
check("dinleme başladı: hız ve olumlu mesaj", /^ok: Listening on the serial port at 921,600 baud/.test(await b.note()) && (await b.ev(`window.__baud`)) === 921600 && !(await b.ev(`document.getElementById("serial-unlisten").hidden`)), await b.note());

// Yanlış hız: çöp gelir, çerçeve yok
await b.ev(`__serialIn(${JSON.stringify(randomBytes(6000).toString("base64"))})`); await sleep(500);
check("çöp bayt: aynı hız uyarısı", /^warn: Data is arriving on the cable, but no Kionel frames/.test(await b.note()), await b.note());

// Gönderen
await a.ev(`document.getElementById("serial-send").click()`); await sleep(400);
check("dosyasız gönderim reddedilir", /^bad: Choose a file first/.test(await a.note()), await a.note());
await a.setFile("#file", `${SP}/src/serial.bin`); await sleep(1500);
await a.ev(`document.getElementById("context-reference").value = "SER-1"; document.getElementById("context-operator").value = "QC-017"; document.getElementById("typed-code").value = "${code}"; document.getElementById("serial-baud").value = "921600"; document.getElementById("serial-send").click()`);
let sentNote = "";
for (let i = 0; i < 30; i++) { await sleep(300); sentNote = await a.note(); if (/frames sent over the serial cable/.test(sentNote)) break; }
check("gönderim bitti: kare sayısı ve 'Send more' görünür", /^ok: serial\.bin: \d+ frames sent over the serial cable/.test(sentNote) && !(await a.ev(`document.getElementById("serial-more").hidden`)), sentNote.slice(0, 100));

// Taşı: her 7. parçada bir baytı boz
const wire = Buffer.from(await a.ev(`__serialOut()`), "base64");
const chunks = [];
for (let i = 0, k = 0; i < wire.length; k++) { const size = 200 + ((k * 97) % 1800); const c = Buffer.from(wire.subarray(i, i + size)); if (k % 7 === 3) c[c.length >> 1] ^= 0x5a; chunks.push(c); i += size; }
for (const c of chunks) { await b.ev(`__serialIn("${c.toString("base64")}")`); }
let result = "";
for (let i = 0; i < 30; i++) { await sleep(500); result = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(result)) break; }
if (!/verified/.test(result)) {
  // Bozulan çerçeveler için gönderen "Send more" ile devam eder.
  await a.ev(`document.getElementById("serial-more").click()`);
  for (let i = 0; i < 30; i++) { await sleep(300); if (/frames sent/.test(await a.note())) break; }
  await b.ev(`__serialIn("${await a.ev(`__serialOut()`)}")`);
  for (let i = 0; i < 20; i++) { await sleep(500); result = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(result)) break; }
}
check("bozuk baytlara rağmen teslim ve doğrulama", /verified/.test(result), result.slice(0, 100));
// Dosya gerçekten indirilir ve diskte özetlenir: canlı sitenin CSP'si blob'u fetch ile okumaya izin vermez.
await b.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
await b.ev(`[...document.querySelectorAll("#result a[download]")].find(x => x.download === "serial.bin")?.click()`);
let got = "yok";
for (let i = 0; i < 20 && got === "yok"; i++) { await sleep(400); try { const f = readFileSync(`${SP}/serial.bin`); if (f.length === payload.length) got = createHash("sha256").update(f).digest("hex"); } catch { /* henüz yok */ } }
check("gelen dosya birebir aynı (SHA-256)", got === want, `${String(got).slice(0, 12)} / ${want.slice(0, 12)}`);
check("teslimde port kapandı, 'Listen' geri geldi", (await b.ev(`document.getElementById("serial-unlisten").hidden && !document.getElementById("serial-listen").hidden`)) === true);
check("alıcıda imzalı bağlam: iş emri ve operatör", /SER-1/.test(result) && /operator: QC-017/.test(result), result.slice(0, 120));

// ---- kabul edilen gönderenler ve tekrar gönderilen dosya ------------------------------
const senders = () => b.ev(`document.getElementById("senders-status").textContent + " | clear hidden: " + document.getElementById("senders-clear").hidden`);
check("teslimden önce her gönderen kabul ediliyor, sabitleme düğmesi teslimde", /accepts files from any sender.*clear hidden: true/.test(await senders()) && /^Accept only this sender from now on \([0-9a-f ]{19}\)$/.test(await b.ev(`document.getElementById("sender-pin")?.textContent ?? "yok"`)), await senders());
await b.ev(`document.getElementById("sender-pin").click()`); await sleep(600);
check("gönderen sabitlendi: olumlu mesaj, liste ve temizleme düğmesi", /^ok: From now on this device accepts files only from this sender\. Pinned: [0-9a-f ]{19}\./.test(await b.note()) && /only from one pinned sender.*clear hidden: false/.test(await senders()) && (await b.ev(`document.getElementById("sender-pin") === null`)), `${await b.note()} || ${await senders()}`);

// Aynı baytlar yeniden gelir: imzalı sevk aynı, yeni teslim üretilmez.
await b.ev(`document.getElementById("serial-listen").click()`); await sleep(500);
await b.ev(`__serialIn("${wire.toString("base64")}")`);
let repeat = "";
for (let i = 0; i < 30; i++) { await sleep(400); repeat = await b.note(); if (/already received|verified|rejected/.test(repeat)) break; }
check("aynı aktarımın tekrarı: yeniden teslim edilmez, nedeni yazılı", /^warn: serial\.bin was already received on .+ with the same signed dispatch\. It was not delivered again/.test(repeat) && !(await b.ev(`Boolean(document.querySelector("#result a[download]"))`)), repeat.slice(0, 140));

// Başka bir cihaz aynı kodla gönderir: imza başka anahtarın, reddedilir.
writeFileSync(`${SP}/src/other.bin`, randomBytes(8_000));
const c = await browser(9419, process.env.SENDER_URL);
await c.setFile("#license-file", LICENSE); await sleep(1500);
await c.setFile("#file", `${SP}/src/other.bin`); await sleep(1500);
const code2 = await b.ev(`document.getElementById("code-display").textContent`);
await c.ev(`document.getElementById("context-reference").value = "SER-2"; document.getElementById("typed-code").value = "${code2}"; document.getElementById("serial-baud").value = "921600"; document.getElementById("serial-send").click()`);
for (let i = 0; i < 30; i++) { await sleep(300); if (/frames sent over the serial cable/.test(await c.note())) break; }
await b.ev(`document.getElementById("serial-listen").click()`); await sleep(500);
await b.ev(`__serialIn("${await c.ev(`__serialOut()`)}")`);
let refusal = "";
for (let i = 0; i < 30; i++) { await sleep(400); refusal = await b.note(); if (/rejected|verified/.test(refusal)) break; }
check("sabitlenmemiş gönderen reddedilir: anahtarı ve ne yapılacağı yazılı, dosya kaydedilmez", /^bad: Transfer rejected: it was signed by sender [0-9a-f ]{19}, which is not the sender this device accepts\. Nothing was saved\./.test(refusal) && !/start the transfer again/.test(refusal) && !(await b.ev(`Boolean(document.querySelector("#result a[download]"))`)), refusal.slice(0, 200));
check("ret ekranında bu göndereni de kabul etme düğmesi", /^Accept this sender too \([0-9a-f ]{19}\)$/.test(await b.ev(`document.getElementById("sender-pin")?.textContent ?? "yok"`)));
await b.ev(`document.getElementById("sender-pin").click()`); await sleep(600);
check("ikinci gönderen eklendi: olumlu mesaj ve yeniden gönder uyarısı", /^ok: From now on this device accepts files only from 2 pinned senders\..*Send the refused file again\./.test(await b.note()) && /only from 2 pinned senders/.test(await senders()), await b.note());
await c.ev(`document.getElementById("serial-more").click()`);
for (let i = 0; i < 30; i++) { await sleep(300); if (/frames sent/.test(await c.note())) break; }
await b.ev(`__serialIn("${await c.ev(`__serialOut()`)}")`);
let accepted = "";
for (let i = 0; i < 30; i++) { await sleep(400); accepted = await b.ev(`document.getElementById("result").textContent`); if (/verified|rejected/.test(accepted)) break; }
check("kabul edilen gönderenin devamı teslim edilir", /verified/.test(accepted) && /SER-2/.test(accepted), accepted.slice(0, 120));
await b.ev(`document.getElementById("senders-clear").click()`); await sleep(500);
check("listeyi temizleme: olumlu mesaj, yeniden her gönderen", /^ok: This device accepts files from any sender again\. 2 pinned senders were removed/.test(await b.note()) && /accepts files from any sender.*clear hidden: true/.test(await senders()), await b.note());

// Durdurma: alıcı dinlerken durdurur
await b.ev(`document.getElementById("serial-listen").click()`); await sleep(400);
await b.ev(`document.getElementById("serial-unlisten").click()`); await sleep(600);
check("dinlemeyi durdur: olumlu mesaj, port kapalı", /^ok: Stopped listening/.test(await b.note()) && !(await b.ev(`document.getElementById("serial-listen").hidden`)), await b.note());
check("JS hatası yok", a.errors.length === 0 && b.errors.length === 0 && c.errors.length === 0, [...a.errors, ...b.errors, ...c.errors].slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
a.close(); b.close(); c.close();
process.exit(fail ? 1 : 0);
