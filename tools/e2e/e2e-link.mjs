// Tek yönlü bağlantı mutabakatı: gönderenin ve alıcının imzalı kayıtları doğrulama sayfasında
// yan yana konur; her sevk için makbuz var mı, doğrulanıyor mu, sayfa bunu söyler.
// Kullanım: node tools/e2e/e2e-link.mjs <scratch> <site>
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [SP, BASE] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };

// Gerçek imzalı kayıtlar: uygulamanın kullandığı paketlerle üretilir (TypeScript kaynak, tür silmeyle).
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixtures = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", `
  const { createIdentity } = await import("./packages/crypto/src/index.ts");
  const { issueDispatch, issueReceipt } = await import("./packages/issue/src/index.ts");
  const sender = await createIdentity(), receiver = await createIdentity();
  const sent = [], received = [];
  for (const [index, file] of ["alarm-01.csv", "alarm-02.csv", "batch-17.pdf"].entries()) {
    const content = new TextEncoder().encode("content of " + file);
    const dispatch = await issueDispatch(sender, { session: 500 + index, content, context: { profile: "lab", reference: "LINK-" + index } });
    sent.push({ kind: "sent", at: dispatch.at, file, record: dispatch });
    const receipt = await issueReceipt(receiver, { session: dispatch.session, content, sender: sender.pub, dispatch });
    received.push({ kind: "received", at: receipt.at, file, record: receipt });
  }
  console.log(JSON.stringify({ sent, received }));
`], { cwd: root, encoding: "utf8" }));
const { sent, received } = fixtures;
const write = (name, value) => writeFileSync(`${SP}/${name}`, typeof value === "string" ? value : JSON.stringify(value));
write("link-sent.json", sent);
write("link-received.json", received);
write("link-received-short.json", received.filter((entry) => entry.file !== "alarm-02.csv"));
write("link-received-forged.json", received.map((entry) => entry.file === "batch-17.pdf" ? { ...entry, record: { ...entry.record, at: "2020-01-01T00:00:00.000Z" } } : entry));
write("link-not-json.json", "numune,sonuc\n");

const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9357", "--no-first-run", "--ignore-certificate-errors", "--mute-audio",
  `--user-data-dir=${SP}/chrome-link-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9357/json")).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const setFile = async (selector, name) => { const { root: doc } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: doc.nodeId, selector })).result; await send("DOM.setFileInputFiles", { nodeId, files: [`${SP}/${name}`] }); await sleep(1200); };
const status = () => ev(`(b => b.hidden ? "—" : b.className + " | " + b.textContent)(document.getElementById("link-status"))`);
const rows = () => ev(`[...document.querySelectorAll("#link-result tbody tr")].map((r) => r.cells[0].textContent + "=" + r.cells[2].textContent).join(" ; ")`);

await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
await send("Page.navigate", { url: `${BASE}/verify.html` }); await sleep(4000);

await setFile("#link-sent-file", "link-sent.json");
check("yalnız gönderen kayıtları: alıcınınkini ister", /is-bad \| Now add the receiver's records/.test(await status()), await status());
await setFile("#link-received-file", "link-received.json");
check("hepsi ulaştı: olumlu mesaj", /is-ok \| All 3 files in the sender's records have a verified receipt/.test(await status()), await status());
check("hepsi ulaştı: her satır teslim edildi", (await rows()).split(" ; ").length === 3 && !/No receipt|Not verified/.test(await rows()), await rows());

await setFile("#link-received-file", "link-received-short.json");
check("eksik dosya: olumsuz mesaj ve sayı", /is-bad \| 2 of 3 files in the sender's records have a verified receipt\. 1 have no receipt\. Send those again/.test(await status()), await status());
check("eksik dosya: adıyla ve en üstte", /^alarm-02\.csv=No receipt ;/.test(await rows()), await rows());

await setFile("#link-received-file", "link-received-forged.json");
check("değiştirilmiş makbuz: teslim sayılmıyor", /is-bad \| 2 of 3 .* 0 have no receipt, 1 could not be verified/.test(await status()) && /batch-17\.pdf=Not verified: the receiver's receipt does not verify/.test(await rows()), `${await status()} || ${await rows()}`);

await setFile("#link-received-file", "link-sent.json");
check("ters dosya: nedenini söylüyor", /is-bad \| The receiver's file has no received records/.test(await status()), await status());
await setFile("#link-received-file", "link-not-json.json");
check("kayıt dosyası olmayan dosya: nedenini söylüyor", /is-bad \| The receiver's file is not a Kionel records file/.test(await status()), await status());

await ev(`document.querySelectorAll(".drop-clear").forEach((b) => { if (!b.hidden && /link-/.test(b.previousElementSibling.id)) b.click(); })`); await sleep(500);
check("iki dosya da kaldırıldı: mesaj, tablo boş", /Both files removed\. Nothing was kept/.test(await status()) && (await rows()) === "", await status());
check("JS hatası yok", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
