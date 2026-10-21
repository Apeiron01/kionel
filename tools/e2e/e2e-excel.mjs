// Excel hasarı denetimi: tek dosya, özgünle karşılaştırma, aynı dosya, kaldırma, indirme, Türkçe sayfa.
// Kullanım: node tools/e2e/e2e-excel.mjs <scratch> <site>
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const [SP, BASE] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };

writeFileSync(`${SP}/raw.csv`, "sample,gene,barcode,result,note\r\n00123,SEPT2,1234567890123456789,0.80,Müller\r\n00124,TP53,4006381333931,1.5,ok\r\n00125,EGFR,4006381333932,2.0,ok\r\n");
// Excel'den geçmiş hali: İngilizce Excel'in "CSV UTF-8" kaydı gibi.
writeFileSync(`${SP}/excel.csv`, "sample,gene,barcode,result,note\r\n123,2-Sep,1.23457E+18,0.8,MÃ¼ller\r\n00124,TP53,4006381333931,1.5,ok\r\n00125,EGFR,4006381333932,2,ok\r\n");
writeFileSync(`${SP}/clean.csv`, "sample,result\n00001,0.5\n00002,0.6\n");

const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--remote-debugging-port=9416", "--no-first-run", "--ignore-certificate-errors", `--user-data-dir=${SP}/chrome-excel-${Date.now()}`, "about:blank"], { stdio: "ignore" });
await sleep(4000);
const t = (await (await fetch("http://127.0.0.1:9416/json")).json()).find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = []; const requests = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); if (m.method === "Network.requestWillBeSent") requests.push(m.params.request); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
const status = () => ev(`(s => s.hidden ? "—" : s.className.replace("evidence-status ", "") + ": " + s.textContent)(document.getElementById("xl-status"))`);
const rows = () => ev(`[...document.querySelectorAll("#xl-table tr")].slice(1).map(r => [...r.children].map(c => c.textContent).join(" | "))`);
await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable"); await send("Network.enable");

await send("Page.navigate", { url: `${BASE}/excel-damage-check.html` }); await sleep(3000);
requests.length = 0;
await setFile("#xl-after-file", `${SP}/excel.csv`); await sleep(1000);
check("tek dosya: olası izler, olumsuz mesaj", /^is-bad: 4 possible traces of Excel in 20 cells\. Without the original/.test(await status()), await status());
const one = await rows();
check("tek dosya: gen adı ve özgün öneri", one.some((r) => /^2 \| gene \| 2-Sep \| SEPT2 \(now SEPTIN2\) \| Gene name turned into a date$/.test(r)), one.join(" / "));
check("tek dosya: bilimsel gösterim ve bozuk karakter", one.some((r) => /1\.23457E\+18 .*scientific notation/.test(r)) && one.some((r) => /MÃ¼ller .*garbled/.test(r)));
check("tek dosya: baştaki sıfır sütundan anlaşıldı", one.some((r) => /^2 \| sample \| 123 \| 00123 \| Leading zeros removed$/.test(r)), one.find((r) => /sample/.test(r)));

await setFile("#xl-original-file", `${SP}/raw.csv`); await sleep(1000);
check("karşılaştırma: fark sayısı, olumsuz mesaj", /^is-bad: 6 differences from the original/.test(await status()), await status());
const two = await rows();
check("karşılaştırma: kaybolan basamaklar ve biçim farkı adlandırıldı", two.some((r) => /barcode \| 1\.23457E\+18 \| 1234567890123456789 \| Digits after the 15th lost/.test(r)) && two.some((r) => /result \| 0\.8 \| 0\.80 \| Same number/.test(r)) && two.some((r) => /result \| 2 \| 2\.0 \| Same number/.test(r)), two.join(" / "));

await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
await ev(`document.getElementById("xl-download").click()`);
let csv = "";
for (let i = 0; i < 20 && !csv; i++) { await sleep(400); const f = readdirSync(SP).find((n) => n === "excel-check_excel.csv"); if (f && existsSync(`${SP}/${f}`)) csv = readFileSync(`${SP}/${f}`, "utf8"); }
check("bulgular CSV indirildi: BOM, başlık, 6 satır", csv.startsWith("\uFEFFrow,column,value,original,finding\r\n") && csv.trim().split("\r\n").length === 7, csv.split("\r\n")[1]);
check("indirme: olumlu mesaj", /^is-ok: 6 findings downloaded/.test(await status()), await status());

await setFile("#xl-after-file", `${SP}/raw.csv`); await sleep(1000);
check("aynı dosya: bayt bayt aynı, olumlu", /^is-ok: The two files are identical, byte for byte/.test(await status()) && (await ev(`document.getElementById("xl-result").hidden`)), await status());
await ev(`document.getElementById("xl-original-clear").click()`); await sleep(500);
check("özgün kaldırıldı: mesaj, düğme gizli, tek dosya kipine döndü", /removed/.test(await status()) && (await ev(`document.getElementById("xl-original-clear").hidden`)), await status());
await setFile("#xl-after-file", `${SP}/clean.csv`); await sleep(1000);
check("temiz dosya: iz yok, olumlu ve sınırını söylüyor", /^is-ok: No sign of Excel damage in 6 cells\. .*only a comparison with the original/.test(await status()), await status());
await ev(`document.getElementById("xl-after-clear").click()`); await sleep(500);
check("dosya kaldırıldı: sonuç gizli, düğme gizli", (await ev(`document.getElementById("xl-result").hidden && document.getElementById("xl-after-clear").hidden`)) && /clean\.csv removed/.test(await status()));
check("hiçbir istek dışarı gitmedi (dosya yüklenmedi)", !requests.some((r) => r.method !== "GET" || !r.url.startsWith(BASE)), requests.filter((r) => r.method !== "GET" || !r.url.startsWith(BASE)).map((r) => r.method + " " + r.url).slice(0, 3).join(" | "));

await send("Page.navigate", { url: `${BASE}/excel-bozulma-kontrolu.html` }); await sleep(3000);
writeFileSync(`${SP}/tr.csv`, "numune;sonuc\n001;01.Ara\n002;0,8\n003;12.May\n");
await setFile("#xl-after-file", `${SP}/tr.csv`); await sleep(1000);
const trRows = await rows();
check("Türkçe sayfa: Türkçe mesaj ve ondalık tahmini", /^is-bad: 8 hücrede 2 olası Excel izi/.test(await status()) && trRows.some((r) => /^2 \| sonuc \| 01\.Ara \| 1\.12 \(ondalık sayı\) \| Tarihe dönmüş metin$/.test(r)), (await status()).slice(0, 60) + " / " + trRows.join(" / "));
// Almanca sayfa: Almanca mesaj, "01. Dez" ondalık tahmini
await send("Page.navigate", { url: `${BASE}/excel-csv-fehler-pruefen.html` }); await sleep(3000);
writeFileSync(`${SP}/de.csv`, "probe;wert\nA;01. Dez\nB;0,8\n");
await setFile("#xl-after-file", `${SP}/de.csv`); await sleep(1000);
const deRows = await rows();
check("Almanca sayfa: Almanca mesaj ve ondalık tahmini", /^is-bad: 1 mögliche Excel-Spuren in 6 Zellen/.test(await status()) && deRows.some((r) => /^2 \| wert \| 01\. Dez \| 1\.12 \(eine Dezimalzahl\) \| Text als Datum$/.test(r)), (await status()).slice(0, 70) + " / " + deRows.join(" / "));
check("JS hatası yok", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
