// Site politikası: yükleme, reddetme, kabul, günlükte politika adı, kaldırma.
// Kullanım: node tools/e2e/e2e-policy.mjs <scratch> <site> <license.json>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };

const policy = { kind: "kionel-policy", version: 1, name: "QC laboratory", revision: "2026-10", allowedExtensions: ["csv"], maxBytes: 200_000, referencePattern: "WO-\\d{6}", referenceHint: "WO- followed by six digits", classifications: ["restricted", "confidential", "internal"], requireOperator: true };
writeFileSync(`${SP}/policy.json`, JSON.stringify(policy));
writeFileSync(`${SP}/policy-bad.json`, JSON.stringify({ ...policy, alowedExtensions: ["csv"] }));
writeFileSync(`${SP}/ok.csv`, "numune,sonuc\nP-1,0.8\n");
writeFileSync(`${SP}/rapor.pdf`, randomBytes(1000));
writeFileSync(`${SP}/big.csv`, randomBytes(300_000));

const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--remote-debugging-port=9415", "--no-first-run", "--ignore-certificate-errors", `--user-data-dir=${SP}/chrome-policy-${Date.now()}`, "about:blank"], { stdio: "ignore" });
await sleep(4000);
const t = (await (await fetch("http://127.0.0.1:9415/json")).json()).find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
const note = () => ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + document.getElementById("notice-text").textContent)(document.getElementById("notice"))`);
await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.confirm = () => true; try { localStorage.setItem("kionel.flash-warning.v1", String(Date.now())); } catch {}` });
await send("Page.navigate", { url: `${BASE}/transfer.html` }); await sleep(3500);

await setFile("#policy-file", `${SP}/policy.json`); await sleep(800);
check("lisanssız: site politikası işletme uyarısı", /A site policy needs a business licence/.test(await note()), (await note()).slice(0, 80));
await setFile("#license-file", LICENSE); await sleep(1500);
await setFile("#policy-file", `${SP}/policy-bad.json`); await sleep(800);
check("yazım hatalı politika: alan adıyla reddedilir", /^bad: That site policy was not loaded: unknown field "alowedExtensions"/.test(await note()), (await note()).slice(0, 110));
await setFile("#policy-file", `${SP}/policy.json`); await sleep(800);
check("politika yüklendi: olumlu mesaj ve özet", /^ok: Site policy "QC laboratory" \(2026-10\): files \.csv; up to 196 KB/.test(await note()), (await note()).slice(0, 120));
check("durum satırı ve 'Remove' görünür", /Site policy "QC laboratory"/.test(await ev(`document.getElementById("policy-status").textContent`)) && !(await ev(`document.getElementById("policy-forget").hidden`)));

await setFile("#file", `${SP}/rapor.pdf`); await sleep(800);
check("izin verilmeyen tür reddedilir", /^bad: Not selected: rapor\.pdf: the site policy "QC laboratory" allows only \.csv files/.test(await note()), (await note()).slice(0, 110));
await setFile("#file", `${SP}/big.csv`); await sleep(800);
check("sınırı aşan boyut reddedilir", /^bad: Not selected: big\.csv: .* allows files up to 196 KB/.test(await note()), (await note()).slice(0, 110));
await setFile("#file", `${SP}/ok.csv`); await sleep(1500);
await ev(`document.getElementById("context-reference").value = "LAB-1"; document.getElementById("typed-code").value = "7K3Q-M9XD-4PLA"; document.getElementById("code-send").click()`); await sleep(800);
check("yanlış biçimli iş emri reddedilir, ipucuyla", /^bad: Not sent: the work order does not match the site policy "QC laboratory": WO- followed by six digits/.test(await note()), (await note()).slice(0, 130));
await ev(`document.getElementById("context-reference").value = "WO-004213"; document.getElementById("code-send").click()`); await sleep(800);
check("operatör boşsa reddedilir, alan işaretlenir", /^bad: Not sent: the site policy "QC laboratory" requires the operator's name or ID/.test(await note()) && (await ev(`document.activeElement.id + document.getElementById("context-operator").getAttribute("aria-invalid")`)) === "context-operatortrue", (await note()).slice(0, 110));
await ev(`document.getElementById("context-operator").value = "T. Bayar"; document.getElementById("code-send").click()`); await sleep(3000);
check("doğru iş emriyle gönderim başlar", /^ok: Sending/.test(await note()), (await note()).slice(0, 60));
await ev(`document.getElementById("send-stop").click()`); await sleep(500);

await send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: SP.replace(/\//g, "\\") });
await ev(`document.getElementById("transfer-log").open = true`); await sleep(500);
await ev(`document.getElementById("log-csv").click()`);
let csvName = "";
for (let i = 0; i < 20 && !csvName; i++) { await sleep(500); csvName = readdirSync(SP).find((f) => /^kionel-transfer-log_.*\.csv$/.test(f)) ?? ""; }
const csv = csvName && existsSync(`${SP}/${csvName}`) ? readFileSync(`${SP}/${csvName}`, "utf8") : "";
check("günlük CSV'si politikayı ve operatörü kaydeder", /,site_policy,operator\r\n/.test(csv) && /WO-004213,.*,QC laboratory \(2026-10\),T\. Bayar\r\n/.test(csv), csv.split("\r\n")[1]?.slice(-60));

await ev(`document.getElementById("policy-forget").click()`); await sleep(500);
check("politika kaldırıldı: olumlu mesaj, durum sıfır", /^ok: Site policy "QC laboratory \(2026-10\)" removed/.test(await note()) && /No site policy/.test(await ev(`document.getElementById("policy-status").textContent`)) && (await ev(`document.getElementById("policy-forget").hidden`)));
await setFile("#file", `${SP}/rapor.pdf`); await sleep(1200);
check("kaldırıldıktan sonra kısıt yok", !/^bad: Not selected/.test(await note()), (await note()).slice(0, 60));
check("JS hatası yok", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
