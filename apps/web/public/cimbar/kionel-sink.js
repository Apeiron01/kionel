// Kionel — renkli kod parçalarını tek dosyada birleştirir.
//
// Çözücü işçiler (recv-worker) her kareden bir fountain parçası çıkarır; bu
// işçi hepsini tek bir libcimbar durumunda toplar, dosya tamamlanınca zstd ile
// açıp baytları geri verir. Tek örnek olmak zorundadır: fountain durumu bölünmez.
// libcimbar MPL-2.0'dır; bu dosya Kionel'e aittir ve kütüphaneyi değiştirmeden çağırır.
'use strict';

let ready = false;
let mode = 68;
let fountain = 0;
let reportBuf = 0;
const queue = [];

var Module = {
  onRuntimeInitialized() {
    ready = true;
    self.postMessage({ type: 'ready' });
    drain();
  },
};

importScripts('cimbar_js.2026-08-21T2336.js');

function report() {
  if (!reportBuf) reportBuf = Module._malloc(1024);
  const n = Module._cimbard_get_report(reportBuf, 1024);
  if (n <= 0) return undefined;
  const text = new TextDecoder().decode(new Uint8Array(Module.HEAPU8.buffer, reportBuf, n));
  try { return JSON.parse(text); } catch { return undefined; }
}

function readFile(id) {
  const size = Module._cimbard_get_decompress_bufsize();
  const buf = Module._malloc(size);
  const parts = [];
  let total = 0;
  for (;;) {
    const n = Module._cimbard_decompress_read(id, buf, size);
    if (n <= 0) break;
    parts.push(new Uint8Array(Module.HEAPU8.buffer, buf, n).slice());
    total += n;
  }
  Module._free(buf);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

function drain() {
  if (!ready) return;
  if (!fountain) {
    Module._cimbard_configure_decode(mode);
    fountain = Module._malloc(Module._cimbard_get_bufsize());
  }
  while (queue.length) {
    const chunk = queue.shift();
    new Uint8Array(Module.HEAPU8.buffer, fountain, chunk.length).set(chunk);
    const res = Module._cimbard_fountain_decode(fountain, chunk.length);
    if (res > 0) {
      const id = Number(BigInt(res) & 0xFFFFFFFFn);
      const bytes = readFile(id);
      self.postMessage({ type: 'file', bytes }, [bytes.buffer]);
    } else {
      const r = report();
      if (Array.isArray(r)) self.postMessage({ type: 'progress', progress: Math.max(0, ...r) });
    }
  }
}

self.onmessage = (event) => {
  const { chunk, mode: m } = event.data;
  if (m) mode = m;
  if (chunk) queue.push(chunk);
  drain();
};
