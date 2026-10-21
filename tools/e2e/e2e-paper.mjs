// Kâğıda basılan aktarım: gönderen sayfaları "basar" (yazdırma diyaloğu taklit), test her
// sayfanın fotoğrafını çizer, bir kodu siler, sayfaları karışık sırayla alıcıya açtırır.
// Kullanım: node tools/e2e/e2e-paper.mjs <scratch> <site> <license.json>
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const payload = randomBytes(14_000);
mkdirSync(`${SP}/src`, { recursive: true });
writeFileSync(`${SP}/src/paper.bin`, payload); // indirilen kopyayla karışmasın
writeFileSync(`${SP}/huge.bin`, randomBytes(2_000_000));
writeFileSync(`${SP}/mid.bin`, randomBytes(30_000));
const want = createHash("sha256").update(payload).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };

async function browser(port, url = `${BASE}/transfer.html`) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", `--user-data-dir=${SP}/chrome-paper-${port}-${Date.now()}`, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.print = () => { window.__printed = (window.__printed || 0) + 1; window.__loadedAtPrint = [...document.querySelectorAll("#print-report img")].every((i) => i.complete && i.naturalWidth > 0); };` });
  await send("Page.navigate", { url }); await sleep(4000);
  const setFile = async (sel, paths) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [].concat(paths) }); };
  const note = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
  return { ev, send, setFile, errors, note, close: () => { ws.close(); chrome.kill(); } };
}

const a = await browser(9419, process.env.SENDER_URL); // yazıcılı PC, lisanssız (SENDER_URL ile çevrimdışı paket)
await a.ev(`document.getElementById("paper-print").click()`); await sleep(400);
check("dosyasız basma reddedilir", /^bad: Choose a file first/.test(await a.note()), await a.note());
await a.setFile("#file", `${SP}/huge.bin`); await sleep(1500);
await a.ev(`document.getElementById("paper-print").click()`); await sleep(2500);
check("ücretsiz sürüm, büyük dosya: 5 sayfa sınırı ve lisans önerisi", /^warn: huge\.bin needs \d+ pages; the free personal edition prints up to 5\. Load a business licence for up to 60 pages/.test(await a.note()), (await a.note()).slice(0, 140));
await a.setFile("#file", `${SP}/mid.bin`); await sleep(1500);
await a.ev(`document.getElementById("paper-print").click()`); await sleep(2500);
check("ücretsiz sürüm, 5 sayfayı aşan dosya: Yoğun ile sığacağı söylenir", /^warn: mid\.bin needs \d+ pages; the free personal edition prints up to 5\. Choose Dense and it fits on 3, or load a business licence/.test(await a.note()), (await a.note()).slice(0, 160));
await a.setFile("#file", `${SP}/src/paper.bin`); await sleep(1500);
await a.ev(`document.getElementById("paper-print").click()`); await sleep(2500);
const printNote = await a.note();
const code = (await a.ev(`document.getElementById("paper-code").hidden ? "" : document.getElementById("paper-code").textContent`)).match(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)?.[0];
check("yazdırma anında bütün kod resimleri yüklüydü (boş sayfa basılmaz)", (await a.ev(`window.__loadedAtPrint`)) === true);
check("adım akışı: basıldıktan sonra sıra kodu yazmakta", /Write down the code/.test(await a.ev(`document.querySelector("#send-steps .is-now")?.textContent ?? ""`)));
check("basıldı: sayfa ve yedek kod sayısı, üretilen kod söylendi", /^ok: 4 pages of codes for paper\.bin sent to the printer \(24 codes, \d of them spare\)\. The code is /.test(printNote) && Boolean(code) && (await a.ev(`window.__printed`)) === 1, printNote.slice(0, 130));
check("baskı: 4 sayfa, sayfa başına 6 kod, kod sayfada yok", (await a.ev(`[...document.querySelectorAll("#print-report .paper-page")].map(p => p.querySelectorAll("img").length).join(",")`)) === "6,6,6,6" && !(await a.ev(`document.getElementById("print-report").textContent.includes("${code}")`)));

// Her baskı sayfası tek kâğıda sığmalı: gerçek bir denemede alt yazı ikinci kâğıda taşıyordu.
for (const [paper, w, h] of [["A4", 8.27, 11.69], ["Letter", 8.5, 11]]) {
  await a.ev(`document.body.classList.add("printing-report")`);
  const pdf = Buffer.from((await a.send("Page.printToPDF", { paperWidth: w, paperHeight: h, displayHeaderFooter: true })).result.data, "base64");
  const sheets = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  check(`${paper}: 4 sayfa kod 4 kâğıda basılır (başlık ve alt bilgiyle)`, sheets === 4, `${sheets} kâğıt`);
}
// Her sayfanın "fotoğrafı": kodlar 2×3 ızgarada beyaz kâğıda; 2. sayfada bir kod okunamaz (silinir).
const photos = await a.ev(`(async () => {
  const out = [];
  const pages = [...document.querySelectorAll("#print-report .paper-page")];
  for (const [p, page] of pages.entries()) {
    const imgs = [...page.querySelectorAll("img")];
    const c = document.createElement("canvas"); c.width = 1400; c.height = 2000;
    const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
    for (const [i, img] of imgs.entries()) {
      if (p === 1 && i === 2) continue;
      await img.decode();
      x.drawImage(img, 60 + (i % 2) * 660, 60 + Math.floor(i / 2) * 640, 600, 600);
    }
    out.push(c.toDataURL("image/png").split(",")[1]);
  }
  return out;
})()`);
const order = [2, 0, 3, 1];
const files = order.map((i) => { const path = `${SP}/page-${i + 1}.png`; writeFileSync(path, Buffer.from(photos[i], "base64")); return path; });

const b = await browser(9420); // alıcı
await b.setFile("#license-file", LICENSE); await sleep(1500);
await b.ev(`document.getElementById("tab-recv").click()`); await sleep(600);
await b.ev(`document.querySelector('[data-pair="paper"]').click()`); await sleep(300);
check("basılı sayfalar: kod alanı, ekran kaydı ve seri seçeneği gizli, adım 1 kod", !(await b.ev(`document.getElementById("pair-paper-panel").hidden`)) && (await b.ev(`document.querySelector('[data-read="record"]').hidden && document.querySelector('[data-read="serial"]').hidden`)) && /Enter the code that came with the pages/.test(await b.ev(`document.querySelector("#recv-steps .is-now")?.textContent ?? ""`)));
await b.ev(`document.getElementById("code-enter").value = "12"; document.getElementById("code-use").click()`); await sleep(300);
check("hatalı kod: olumsuz mesaj", /^bad: The code has 12 characters/.test(await b.note()), await b.note());
// Gerçek denemede olan: başka bir kodla (önceki aktarımınki) okumak. Okunan silinmemeli.
const wrong = code.startsWith("AAAA") ? "BBBB-CCCC-DDDD" : "AAAA-BBBB-CCCC";
await b.ev(`document.getElementById("code-enter").value = "${wrong}"; document.getElementById("code-use").click()`); await sleep(300);
check("kod kullanıldı: olumlu mesaj, kod ekranda", new RegExp(`^ok: Code ${wrong} in use`).test(await b.note()) && (await b.ev(`document.getElementById("code-display").textContent`)) === wrong, await b.note());
await b.setFile("#pages-open", files.slice(0, 2)); await sleep(4000);
check("iki sayfa: eksik, ilerleme ve devam mesajı", /^warn: 12 codes read from 2 images; \d+% of the file so far\. Add photos or scans of the remaining pages/.test(await b.note()), await b.note());
await b.setFile("#pages-open", files.slice(2)); await sleep(5000);
check("yanlış kod: dosya tamam ama açılmadı; okunan saklandı, doğru kod istendi", new RegExp(`^warn: The code ${wrong} does not open this file\. Enter the right code: what was read is kept`).test(await b.note()), await b.note());
await b.ev(`document.getElementById("code-enter").value = "${code}"; document.getElementById("code-use").click()`); await sleep(3000);
const result = await b.ev(`document.getElementById("result").textContent`);
check("doğru kod: yeniden taramadan teslim ve doğrulama", /received and verified/.test(await b.note()) || /download/.test(result), (await b.note()).slice(0, 100));
// Dosya gerçekten indirilir ve diskte özetlenir: canlı sitenin CSP'si blob'u fetch ile okumaya izin vermez.
await b.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
await b.ev(`[...document.querySelectorAll("#result a[download]")].find(x => x.download === "paper.bin")?.click()`);
let got = "yok";
for (let i = 0; i < 20 && got === "yok"; i++) { await sleep(400); try { const f = readFileSync(`${SP}/paper.bin`); if (f.length === payload.length) got = createHash("sha256").update(f).digest("hex"); } catch { /* henüz yok */ } }
check("gelen dosya birebir aynı (SHA-256)", got === want, `${String(got).slice(0, 12)} / ${want.slice(0, 12)}`);

// Kodu sayfaya basma seçeneği
await a.ev(`document.getElementById("paper-code-on-pages").checked = true; document.getElementById("typed-code").value = "${code}"; document.getElementById("paper-print").click()`); await sleep(2500);
check("seçenek: kod sayfa başlığında; alıcının kodu kullanıldı", (await a.ev(`document.querySelector("#print-report .paper-head").textContent.includes("code ${code}")`)) === true && /^Printed with the receiver's code/.test(await a.ev(`document.getElementById("paper-note").textContent`)));
await a.ev(`document.getElementById("paper-code-hide").click()`); await sleep(300);
check("kodu gizle: kod ve düğme gizli, olumlu mesaj", (await a.ev(`document.getElementById("paper-code").hidden && document.getElementById("paper-code-hide").hidden`)) === true && /^ok: Code hidden/.test(await a.note()), await a.note());
// Yoğun sayfa: 12 kod tek fotoğrafta (okuyucu sınırı 9; sayfa iki parçada okunur). Sayfa
// yeniden açılır ve alıcı sekmesine geçilmeden okunur: kimlik o an yüklenmemiş olsa da teslim olmalı.
await a.ev(`document.getElementById("paper-code-on-pages").checked = false; document.getElementById("paper-density").value = "dense"; document.getElementById("paper-print").click()`); await sleep(2500);
const dense = await a.ev(`(async () => {
  const page = document.querySelector("#print-report .paper-page"); const imgs = [...page.querySelectorAll("img")];
  const c = document.createElement("canvas"); c.width = 1500; c.height = 2000; const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height);
  for (const [i, img] of imgs.entries()) { await img.decode(); x.drawImage(img, 40 + (i % 3) * 490, 40 + Math.floor(i / 3) * 490, 440, 440); }
  return [imgs.length, c.toDataURL("image/png").split(",")[1]];
})()`);
writeFileSync(`${SP}/dense.png`, Buffer.from(dense[1], "base64"));
await b.ev(`location.reload()`); await sleep(4000);
// Kod girilmeden önce taranır (basılı sayfa seçilince eski kod kullanılmaz); kod sonra girilir.
await b.ev(`document.querySelector('[data-pair="paper"]').click()`); await sleep(300);
await b.setFile("#pages-open", `${SP}/dense.png`); await sleep(5000);
check("yoğun sayfa, kod yokken: 12 kodun hepsi okundu, kod isteniyor", dense[0] === 12 && /^warn: Every code needed has been read\. Enter the code for these pages/.test(await b.note()), await b.note());
await b.ev(`document.getElementById("code-enter").value = "${code}"; document.getElementById("code-use").click()`); await sleep(3000);
check("kod sonra girildi: yeniden taramadan teslim", /received and verified/.test(await b.note()), await b.note());
check("JS hatası yok", a.errors.length === 0 && b.errors.length === 0, [...a.errors, ...b.errors].slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
a.close(); b.close();
process.exit(fail ? 1 : 0);
