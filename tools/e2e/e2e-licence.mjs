// Lisansı başka cihaza taşıma: kod (sahte kamera ile) ve yapıştırma.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const [SP, BASE, LICENSE] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0; const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
async function browser(port, extra = []) {
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", `--remote-debugging-port=${port}`, "--no-first-run", "--ignore-certificate-errors",
    `--user-data-dir=${SP}/chrome-lic-${port}-${Date.now()}`, ...extra, "about:blank"], { stdio: "ignore" });
  await sleep(4000);
  const t = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page");
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0; const pending = new Map(); const errors = [];
  const dialogs = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Page.javascriptDialogOpening") { dialogs.push(m.params.message); ws.send(JSON.stringify({ id: 99999 + dialogs.length, method: "Page.handleJavaScriptDialog", params: { accept: true } })); } if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description); });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async (x) => { const r = (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result; return r.exceptionDetails ? `EXC ${r.exceptionDetails.exception?.description}` : r.result.value; };
  await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable");
  await send("Browser.grantPermissions", { permissions: ["videoCapture"], origin: BASE }).catch(() => {});
  await send("Page.navigate", { url: `${BASE}/transfer.html` });
  await sleep(4000);
  const setFile = async (sel, path) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: sel })).result; await send("DOM.setFileInputFiles", { nodeId, files: [path] }); };
  return { ev, setFile, errors, dialogs, close: () => { ws.close(); chrome.kill(); } };
}
const notice = (b) => b.ev(`(n => n.hidden ? "—" : n.dataset.kind + ": " + n.textContent.replace("×", "").trim().slice(0, 400))(document.getElementById("notice"))`);

// 1) Lisanslı cihaz: kodu göster, görüntüsünü al.
const a = await browser(9343);
await a.setFile("#license-file", LICENSE); await sleep(1500);
await a.ev(`document.querySelector(".licence-move").open = true; document.getElementById("licence-show").click()`);
await sleep(500);
check("lisanslı cihaz lisansı kod olarak gösterdi", await a.ev(`!document.getElementById("licence-qr").hidden`) === true);
check("fotoğraf riski uyarısı", /anyone who photographs it gets your licence/.test(await notice(a)));
const jpeg = await a.ev(`(() => { const c = document.getElementById("licence-qr"); const o = document.createElement("canvas"); o.width = 1280; o.height = 720; const g = o.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 1280, 720); g.drawImage(c, 290, 10, 700, 700); return o.toDataURL("image/jpeg", 0.95).split(",")[1]; })()`);
const raw = await a.ev(`localStorage.getItem("kionel.license.v1")`);
a.close();
const frame = Buffer.from(jpeg, "base64");
writeFileSync(`${SP}/licence.mjpeg`, Buffer.concat(Array(60).fill(frame)));

// 2) Lisanssız cihaz, kamerası bu kodu görüyor.
const b = await browser(9344, ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${SP}/licence.mjpeg`]);
check("ikinci cihaz başta kişisel sürümde", await b.ev(`document.getElementById("license-status").dataset.state`) === "free");
await b.ev(`document.getElementById("tab-recv").click()`);
await sleep(7000);
const state = await b.ev(`document.getElementById("license-status").dataset.state + " | " + document.getElementById("license-status").textContent.slice(0, 60)`);
check("okunan lisans için onay soruldu (kurum adıyla)", b.dialogs.some((d) => /Load the Kionel licence of Taha Bayar/.test(d)), b.dialogs[0] ?? "soru yok");
check("kamera kodu okudu, onayla lisans yüklendi", state.startsWith("ok"), state);
check("renkli kod / kayıt artık açık", !/business licence/.test(await (async () => { await b.ev(`document.querySelector('[data-read="record"]').click()`); return notice(b); })()));
check("JS hatası yok (kamera cihazı)", b.errors.length === 0, b.errors.slice(0, 2).join(" | "));
b.close();

// 3) Yapıştırma: geçerli metin yükler, geçersiz metin mevcut lisansı bozmaz.
const c = await browser(9345);
await c.ev(`document.querySelector(".licence-move").open = true; document.getElementById("licence-paste").value = ${JSON.stringify(raw)}; document.getElementById("licence-paste-load").click()`);
await sleep(1500);
check("yapıştırılan lisans yüklendi", await c.ev(`document.getElementById("license-status").dataset.state`) === "ok");
await c.ev(`document.getElementById("licence-paste").value = '{"schema":"kionel-license/v1","licensee":"Fake"}'; document.getElementById("licence-paste-load").click()`);
await sleep(1500);
const n = await notice(c);
check("geçersiz metin reddedildi", /not a valid Kionel licence/.test(n), n);
check("mevcut lisans korundu", await c.ev(`document.getElementById("license-status").dataset.state`) === "ok");
c.close();
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
