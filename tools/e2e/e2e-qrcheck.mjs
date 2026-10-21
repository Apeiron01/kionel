// QR inceleme aracı: resimdeki kodun içinde ne olduğunu ve neyi ele verdiğini söyler.
// Kullanım: node tools/e2e/e2e-qrcheck.mjs <scratch> <site>
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const QRCode = createRequire(new URL("../../apps/web/package.json", import.meta.url))("qrcode");
const [SP, BASE] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };

const codes = {
  wifi: "WIFI:T:WPA;S:Lab Guest;P:correct-horse-9;;",
  link: "https://kionel.com/how-it-works.html",
  token: "https://cam.example/live?id=42&token=9f8e7d6c5b4a3f2e",
  otp: "otpauth://totp/ACME:ada?secret=JBSWY3DPEHPK3PXP&issuer=ACME",
  opaque: "l1qhP2ciaiZk93mXw0Qa7LrT5uVbN8yEo4Hs6Jd1Gf",
};
for (const [name, text] of Object.entries(codes)) await QRCode.toFile(`${SP}/qr-${name}.png`, text, { width: 600, margin: 4 });
writeFileSync(`${SP}/qr-none.png`, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
writeFileSync(`${SP}/qr-not-image.txt`, "numune,sonuc\n");

const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--remote-debugging-port=9356", "--no-first-run", "--ignore-certificate-errors", "--mute-audio",
  `--user-data-dir=${SP}/chrome-qrcheck-${Date.now()}`, "about:blank",
], { stdio: "ignore" });
await sleep(4000);
const target = (await (await fetch("http://127.0.0.1:9356/json")).json()).find((t) => t.type === "page");
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map(); const errors = []; const requests = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === "Network.requestWillBeSent") requests.push(m.params.request.method);
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true })).result.result?.value;
const setFile = async (name) => { const { root } = (await send("DOM.getDocument")).result; const { nodeId } = (await send("DOM.querySelector", { nodeId: root.nodeId, selector: "#qr-file" })).result; await send("DOM.setFileInputFiles", { nodeId, files: [`${SP}/${name}`] }); await sleep(1800); };
const status = () => ev(`(b => b.hidden ? "—" : b.className + " | " + b.textContent)(document.getElementById("qr-status"))`);
const verdict = () => ev(`(r => r.children.length + " | " + (r.querySelector(".evidence-status")?.className ?? "") + " | " + (r.querySelector(".evidence-status")?.textContent ?? "") + " | " + (r.querySelector("dd")?.textContent ?? ""))(document.getElementById("qr-results"))`);

await send("Runtime.enable"); await send("Page.enable"); await send("DOM.enable"); await send("Network.enable");
await send("Page.navigate", { url: `${BASE}/what-is-in-a-qr-code.html` }); await sleep(4000);

await setFile("qr-not-image.txt");
check("resim olmayan dosya: olumsuz mesaj", /is-bad.*could not be opened as a picture/.test(await status()), await status());
await setFile("qr-none.png");
check("kodsuz resim: olumsuz mesaj, sonuç yok", /is-bad.*No QR code could be read/.test(await status()) && /^0 \|/.test(await verdict()), await status());

requests.length = 0;
await setFile("qr-wifi.png");
check("Wi-Fi kodu: parola açıkta, ağ adı yazıyor", /^1 \| evidence-status is-bad \| This code shows the Wi-Fi password in plain text.*"Lab Guest"/.test(await verdict()), await verdict());
check("Wi-Fi kodu: içerik gösteriliyor", (await verdict()).endsWith(codes.wifi), await verdict());
check("Wi-Fi kodu: özet dikkat istiyor, yüklenmediğini söylüyor", /is-bad.*1 code\(s\) read in this tab; 1 need your attention\. Nothing was uploaded/.test(await status()), await status());
check("resim okunurken ağa veri gönderilmedi", !requests.includes("POST") && !requests.includes("PUT"), requests.join(","));

await setFile("qr-link.png");
check("sıradan bağlantı: olumlu", /is-ok \| A link, with nothing that looks like a password or token/.test(await verdict()) && /is-ok.*no password, key or token was recognised/.test(await status()), await verdict());
await setFile("qr-token.png");
check("belirteçli bağlantı: parametre adıyla uyarı", /is-bad \| This link carries what looks like a password or access token \("token"\)/.test(await verdict()), await verdict());
await setFile("qr-otp.png");
check("giriş kodu sırrı: uyarı", /is-bad \| This code contains the secret behind your one-time login codes/.test(await verdict()), await verdict());
await setFile("qr-opaque.png");
check("okunamayan dizi: şifreli demiyor, bilinemez diyor", /is-bad \| This code holds 42 bytes that mean nothing to a reader\. That does not show it is encrypted/.test(await verdict()), await verdict());

await ev(`document.getElementById("qr-clear").click()`); await sleep(300);
check("resmi kaldırma: olumlu mesaj, sonuç ve düğme gitti", /is-ok.*Picture removed\. Nothing was kept/.test(await status()) && /^0 \|/.test(await verdict()) && (await ev(`document.getElementById("qr-clear").hidden`)), await status());

await send("Page.navigate", { url: `${BASE}/qr-kodun-icinde-ne-var.html` }); await sleep(3500);
await setFile("qr-wifi.png");
check("Türkçe sayfa: Türkçe uyarı ve özet", /Bu kod Wi-Fi parolasını düz metin olarak gösteriyor.*"Lab Guest"/.test(await verdict()) && /is-bad.*1 tanesi dikkat istiyor\. Hiçbir şey yüklenmedi/.test(await status()), await verdict());
await setFile("qr-none.png");
check("Türkçe sayfa: kodsuz resim, olumsuz mesaj", /is-bad.*okunabilen bir QR kod yok/.test(await status()), await status());
check("JS hatası yok", errors.length === 0, errors.slice(0, 2).join(" | "));
console.log(`\n${pass} geçti, ${fail} kaldı`);
ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
