// Yalnız mühürleme: dosya aktarılmaz, mühür kodu telefona geçer.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
writeFileSync(`${SP}/hash.bin`, randomBytes(200_000));
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9352", "--no-first-run", "--ignore-certificate-errors",
  "--autoplay-policy=no-user-gesture-required", `--user-data-dir=${SP}/chrome-hash-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9352/json")).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}` : r.result.value; };
const setFile = async (selector, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
const notice = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + n.textContent.replace("×", "").trim().slice(0, 130))(document.getElementById("notice"))`);
const { createHash } = await import("node:crypto"); const { readFileSync } = await import("node:fs");
const want = createHash("sha256").update(readFileSync(`${SP}/hash.bin`)).digest("hex");
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
await send("Page.navigate", { url: `${BASE}/sha256-file-checksum.html` }); await sleep(4000);
const st = () => ev(`(b => b.hidden ? "—" : b.className + " | " + b.textContent)(document.getElementById("hash-status"))`);
const typeExp = (v) => ev(`(i => { i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event("input")); })(document.getElementById("hash-expected"))`);
await typeExp("abc"); check("dosyasız geçersiz değer: olumsuz", /is-bad.*not a SHA-256/.test(await st()), await st());
await typeExp(want); check("dosyasız geçerli değer: dosya iste", /is-bad.*add the file/.test(await st()), await st());
await typeExp("");
await setFile("#hash-file", `${SP}/hash.bin`); await sleep(1500);
{ const got = await ev(`document.getElementById("hash-value").textContent`); check("özet doğru hesaplandı", got === want, `${got} / ${want}`); }
check("boyut gösteriliyor", /200,000 bytes/.test(await ev(`document.getElementById("hash-size").textContent`)));
check("hesaplandı: olumlu", /is-ok.*calculated/.test(await st()), await st());
await typeExp(want.toUpperCase().match(/../g).join(" ")); check("büyük harf + boşluk: eşleşir", /is-ok.*Match/.test(await st()), await st());
await typeExp(want.slice(0, -1) + (want.endsWith("0") ? "1" : "0")); check("tek karakter farklı: eşleşmez", /is-bad.*No match/.test(await st()), await st());
await typeExp("xyz"); check("geçersiz değer: olumsuz", /is-bad.*not a SHA-256/.test(await st()));
// Türkçe sayfa: aynı araç, Türkçe mesajlar
await send("Page.navigate", { url: `${BASE}/sha256-dogrulama.html` }); await sleep(3000);
await setFile("#hash-file", `${SP}/hash.bin`); await sleep(1500);
check("Türkçe sayfa: özet ve Türkçe mesaj", (await ev(`document.getElementById("hash-value").textContent`)) === want && /is-ok.*bu sekmede hesaplandı/.test(await st()) && /200\.000 bayt/.test(await ev(`document.getElementById("hash-size").textContent`)), await st());
await typeExp(want); check("Türkçe sayfa: eşleşme mesajı", /is-ok.*Eşleşiyor/.test(await st()), await st());
await send("Page.navigate", { url: `${BASE}/sha256-pruefen.html` }); await sleep(3000);
await setFile("#hash-file", `${SP}/hash.bin`); await sleep(1500);
check("Almanca sayfa: özet ve Almanca mesaj", (await ev(`document.getElementById("hash-value").textContent`)) === want && /is-ok.*in diesem Tab berechnet/.test(await st()) && /200\.000 Byte/.test(await ev(`document.getElementById("hash-size").textContent`)), await st());
await send("Page.navigate", { url: `${BASE}/index.html` }); await sleep(1500);
const ld = await ev(`[...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { const j = JSON.parse(s.textContent); return JSON.stringify(j).includes("Which computers and browsers") ? "ok" : "x"; } catch (e) { return "HATA " + e.message; } }).join(",")`);
check("SSS yapısal verisi geçerli ve yeni soru içinde", /ok/.test(ld) && !/HATA/.test(ld), ld);
check("JS hatası yok", errors.length === 0, errors.join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
