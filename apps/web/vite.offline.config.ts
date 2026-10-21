// Çevrimdışı paket: yalnız aktarım sayfası, tek JS parçası, her varlık satır içi.
// Dosya çift tıklanarak (file://) açılır; orada tarayıcı ayrı JS/WASM dosyası
// yüklemez. Paketleme ve yayın: tools/build-offline.mjs.
import { resolve } from "node:path";
import base from "./vite.config.ts";

const version = process.env.KIONEL_OFFLINE_VERSION;
if (!version) throw new Error("KIONEL_OFFLINE_VERSION is not set; run tools/build-offline.mjs");

export default {
  ...base,
  plugins: [],
  publicDir: false,
  define: { ...base.define, __KIONEL_OFFLINE__: JSON.stringify(version) },
  build: {
    outDir: "dist-offline",
    emptyOutDir: true,
    minify: "esbuild",
    sourcemap: false,
    cssCodeSplit: false,
    modulePreload: false,
    assetsInlineLimit: 100 * 1024 * 1024,
    rollupOptions: {
      input: { transfer: resolve(import.meta.dirname, "transfer.html") },
      output: { inlineDynamicImports: true },
    },
  },
};
