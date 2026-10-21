/**
 * Müşteri paketi: Kionel Proof ve metot sevki CLI'ları tek dosya hâlinde.
 *
 * Kaynak dağıtılmaz. Lisans otoritesinin açık anahtarı derlemeye gömülür ve
 * testler için kaynakta bırakılan ortam değişkeni kapısı derlemeden çıkar;
 * `dist-cli/` içinde KIONEL_TEST_LICENSE_AUTHORITY geçmemelidir (aşağıda kontrol
 * ediliyor). Çalıştırmak için yalnız Node 22+ gerekir.
 */
import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { publicKey } = JSON.parse(readFileSync(`${root}config/license-public.json`, "utf8"));
if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey ?? "")) throw new Error("config/license-public.json missing; run pnpm license:configure");

const entries = { "kionel-proof": "apps/attest/attest.ts", "kionel-method": "apps/attest/method.ts" };
for (const [name, entry] of Object.entries(entries)) {
  const out = `${root}dist-cli/${name}.mjs`;
  await build({
    entryPoints: [`${root}${entry}`], outfile: out, bundle: true, platform: "node", format: "esm",
    target: "node22", minify: true, legalComments: "none", sourcemap: false,
    define: { __KIONEL_LICENSE_AUTHORITY__: JSON.stringify(publicKey) },
    // Pakete giren CommonJS bağımlılıkları (qrcode) `require` bekliyor; ESM'de yok.
    banner: { js: "// Kionel — proprietary. (c) 2026 Taha Bayar. See LICENSE.\n" +
      "import { createRequire as __kionelRequire } from \"node:module\"; const require = __kionelRequire(import.meta.url);" },
  });
  const code = readFileSync(out, "utf8");
  // Paketin tek güvenlik şartı: test kapısı içeride kalmamış olmalı.
  if (code.includes("KIONEL_TEST_LICENSE_AUTHORITY")) throw new Error(`${name}: test override leaked into the bundle`);
  if (!code.includes(publicKey)) throw new Error(`${name}: authority key not embedded`);
  console.log(`${out} (${(code.length / 1024).toFixed(0)} KB)`);
}
