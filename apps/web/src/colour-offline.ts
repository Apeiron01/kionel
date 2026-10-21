/**
 * Renkli kod, çevrimdışı pakette.
 *
 * Paket dosyadan açılır; tarayıcı orada ayrı betik ya da WASM dosyası
 * yüklemez. libcimbar'ın dosyaları (değiştirilmeden) pakete gömülür ve
 * işçiler bellekteki kopyalardan başlatılır.
 *
 * file:// sayfasında bir işçi, sayfanın ürettiği blob: adresini
 * importScripts ile yükleyemez ("local resource"), ama KENDİ ürettiğini
 * yükleyebilir. Bu yüzden libcimbar'ın betikleri işçi kaynağına metin
 * olarak gömülür; işçi açılırken onları kendi blob: adreslerine çevirir ve
 * libcimbar'ın importScripts çağrıları o adreslere yönlendirilir. WASM,
 * Emscripten'in locateFile kancasıyla gömülü data: adresinden okunur.
 * Web sürümü bu dosyayı hiç yüklemez.
 */
import glue from "../public/cimbar/cimbar_js.2026-08-21T2336.js?raw";
import sendLibrary from "../public/cimbar/send.2026-08-21T2336.js?raw";
import sendWorker from "../public/cimbar/send-worker.2026-08-21T2336.js?raw";
import recvWorker from "../public/cimbar/recv-worker.2026-08-21T2336.js?raw";
import sink from "../public/cimbar/kionel-sink.js?raw";
import wasm from "../public/cimbar/cimbar_js.2026-08-21T2336.wasm?url";
import { workerUrls } from "./colour.ts";

// İşçi Module'ünü kendisi tanımlar (onRuntimeInitialized); üzerine yazılmaz, yalnız WASM'ın yeri eklenir.
const glueSource = `var Module = typeof Module != "undefined" ? Module : {};\n` +
  `Module.locateFile = function () { return ${JSON.stringify(wasm)}; };\n${glue}`;

function wire(code: string): string {
  const prelude =
    `const __kionelGlue = URL.createObjectURL(new Blob([${JSON.stringify(glueSource)}], { type: "text/javascript" }));\n` +
    `const __kionelSend = URL.createObjectURL(new Blob([${JSON.stringify(sendLibrary)}], { type: "text/javascript" }));\n`;
  const body = code
    .replaceAll("'cimbar_js.2026-08-21T2336.js'", "__kionelGlue")
    .replaceAll("'send.2026-08-21T2336.js'", "__kionelSend");
  // "use strict" yönergesi ilk deyim kalmalı; yoksa işçi gevşek kipte çalışır.
  const strict = /^\s*(['"])use strict\1;?/.exec(body);
  const source = strict ? `${strict[0]}\n${prelude}${body.slice(strict[0].length)}` : prelude + body;
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}

workerUrls.send = wire(sendWorker);
workerUrls.recv = wire(recvWorker);
workerUrls.sink = wire(sink);
