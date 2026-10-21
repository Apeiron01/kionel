import { writeFileSync } from "node:fs";
const target = await (await fetch("http://127.0.0.1:9223/json/new?about:blank", { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.addEventListener("open", resolve, { once: true }); ws.addEventListener("error", reject, { once: true }); });
let id = 0; const pending = new Map(); const errors = [], requests = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails);
  if (m.method === "Network.requestWillBeSent") requests.push({ url: m.params.request.url, method: m.params.request.method });
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(m.error) : p.resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async expression => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const waitFor = async expression => { for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw new Error("UI readiness timeout"); };
const checks = [];
try {
  await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
  await send("Page.navigate", { url: "http://localhost:8787/transfer.html" });
  await waitFor("!!document.querySelector('#file') && document.readyState === 'complete'");
  const wasm = await evaluate("WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])).then(()=>true)");
  if (!wasm) throw new Error("QR WebAssembly blocked by production CSP");
  checks.push({ transferAppAccessible: true, wasmAllowedByCsp: true });
  for (const width of [390, 1365]) {
    await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
    await send("Page.navigate", { url: "http://localhost:8787/numune-karsilastirma.html" });
    await waitFor("!!document.querySelector('#example') && document.readyState === 'complete'");
    await evaluate("document.querySelector('#example').click(); document.querySelector('#compare').click()");
    await waitFor("!document.querySelector('#download').disabled");
    const result = await evaluate("({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,result:document.querySelector('#comparison-result').textContent})");
    if (result.scrollWidth > width || !result.result.includes("LAB-002") || !result.result.includes("LAB-004")) throw new Error("Comparison/layout failed");
    const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    writeFileSync(`artifacts/funnel-${width}.png`, Buffer.from(screenshot.data, "base64"));
    const before = requests.length;
    await evaluate("document.querySelector('#received').value='LAB-001'; document.querySelector('#received').dispatchEvent(new Event('input')); document.querySelector('#compare').click()");
    await waitFor("!document.querySelector('#download').disabled");
    if (requests.length !== before) throw new Error("List comparison made a network request");
    checks.push(result);
  }
  await send("Page.navigate", { url: "http://localhost:8787/pilot.html" });
  await waitFor("document.querySelector('h1')?.textContent.includes('open source')");
  checks.push(await evaluate("({githubLink:!!document.querySelector('a[href=\"https://github.com/Apeiron01/kionel\"]'),checkoutGone:!document.querySelector('#checkout-button'),width:innerWidth,scrollWidth:document.documentElement.scrollWidth})"));
  if (errors.length) throw new Error("Browser runtime errors");
  writeFileSync("artifacts/funnel-smoke.json", JSON.stringify({ checks, errors, listComparisonRequests: 0 }, null, 2));
  console.log(JSON.stringify({ checks, errors, listComparisonRequests: 0 }, null, 2));
} finally { await send("Page.close"); ws.close(); }
