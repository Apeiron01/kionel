import { defineConfig } from "vite";
import basicSsl from "@vitejs/plugin-basic-ssl";
import { execSync } from "node:child_process";
import { existsSync, globSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// Every .html at the app root is a page. Segment pages are generated
// (pnpm web:segments), so discovering them beats maintaining a list that
// silently drops a page when someone adds a segment and forgets this file.
const input = Object.fromEntries(
  globSync("*.html", { cwd: here }).map((file) => [basename(file, ".html"), resolve(here, file)]),
);

// Lisans otoritesinin AÇIK anahtarı derlemeye gömülür; Worker'la aynı kaynak.
// Yoksa uygulama yalnız demo modunda çalışır — hiçbir lisans doğrulanamaz.
// Hangi koddan derlendiği ekranda yazar: doğrulanmış kurulumda kayda geçer.
// Çalışma ağacı temiz değilse "+local" eklenir; yayımlanan derleme bunu taşımamalı.
const build = (() => {
  try {
    const commit = execSync("git rev-parse --short HEAD", { cwd: here, encoding: "utf8" }).trim();
    const dirty = execSync("git status --porcelain", { cwd: here, encoding: "utf8" }).trim() ? "+local" : "";
    return commit + dirty;
  } catch {
    return "unknown";
  }
})();

const commerceConfig = resolve(here, "../../config/commerce.local.json");
const licenseAuthority: string = existsSync(commerceConfig)
  ? JSON.parse(readFileSync(commerceConfig, "utf8")).licensePublicKey ?? ""
  : "";

// getUserMedia yalnızca güvenli bağlamda çalışır; telefonla LAN üzerinden
// test etmek için dev sunucusu https olmak ZORUNDA (sertifika uyarısını kabul et).
export default defineConfig({
  plugins: [basicSsl()],
  define: { __KIONEL_LICENSE_AUTHORITY__: JSON.stringify(licenseAuthority), __KIONEL_OFFLINE__: JSON.stringify(""), __KIONEL_BUILD__: JSON.stringify(build) },
  server: { host: true },
  build: { minify: "esbuild", sourcemap: false, rollupOptions: { input } },
  // workspace paketleri TS kaynak olarak gelir, ön-paketlemeye sokma
  optimizeDeps: { exclude: ["@kionel/core", "@kionel/transport-qr"] },
});
