#!/usr/bin/env node
/**
 * Çevrimdışı paket: aktarım uygulaması tek bir HTML dosyası olarak.
 *
 * İnternete hiç çıkmayan PC'ye onaylı yoldan bir kez kopyalanır ve çift
 * tıklanarak açılır. Kurulum, betik izni, sunucu yok. Doğrulanmış sistem
 * sabit sürüm ister: yayımlanan sürüm bir daha üzerine yazılmaz, yeni sürüm
 * yeni dosya adıdır ve eski sürümler indirilebilir kalır.
 *
 *   node tools/build-offline.mjs            → dist-offline/ içinde taslak
 *   node tools/build-offline.mjs --publish  → public/download/ + sürüm kaydı
 *
 * Yayın temiz çalışma ağacından yapılır: pakete yazılan commit, dosyanın
 * gerçekten hangi koddan üretildiğini söylemeli.
 */
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Yeni sürüm yayımlamak için bu satırı artırın.
const VERSION = "1.0.15";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web");
const publish = process.argv.includes("--publish");
const git = (args) => execSync(`git ${args}`, { cwd: root, encoding: "utf8" }).trim();

if (publish && git("status --porcelain")) {
  console.error("Commit your changes first: a published package must name the exact commit it was built from.");
  process.exit(1);
}
const commit = git("rev-parse --short HEAD");

execSync("pnpm exec vite build --config vite.offline.config.ts", {
  cwd: web, stdio: "inherit", env: { ...process.env, KIONEL_OFFLINE_VERSION: VERSION },
});

const dist = join(web, "dist-offline");
let html = readFileSync(join(dist, "transfer.html"), "utf8");
const asset = (path) => readFileSync(join(dist, path.replace(/^\//, "")), "utf8");

// Betik ve stil satır içine; "</script" dizesi betiği erken kapatmasın.
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g,
  (_, src) => `<script type="module">${asset(src).replace(/<\/script/gi, "<\\/script")}</script>`);
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => `<style>${asset(href)}</style>`);
// Yazı tipleri de gömülür: dosyadan açılınca /fonts/ yoktur ve paketin CSP'si dışarıdan yüklemeyi engeller.
html = html.replace(/url\(\/fonts\/([a-z0-9-]+\.woff2)\)/g, (_, name) =>
  `url(data:font/woff2;base64,${readFileSync(join(web, "public/fonts", name)).toString("base64")})`);
// Dosyadan açılınca site kökü yoktur: önyükleme ve simge bağlantıları gider,
// sayfadaki site bağlantıları kionel.com'a gider (ağ varsa açılır).
html = html.replace(/<link rel="(preload|icon)"[^>]*>\s*/g, "");
html = html.replace(/<meta property="og:[^>]*>\s*|<meta name="twitter:[^>]*>\s*/g, "");
html = html.replace(/(href|src)="\/(?!\/)/g, '$1="https://kionel.com/');
html = html.replace("<head>", `<head>\n<!-- Kionel offline package ${VERSION} · built from commit ${commit} · https://kionel.com/offline-package.html -->`);
// Paketin kendi güvenlik politikası: dosyadan açıldığında sunucu başlığı yoktur.
// Dışarıdan hiçbir betik, stil ya da bağlantı yüklenemez; biri dosyaya bir şey
// eklese bile paket ağa çıkamaz. data: yalnız gömülü QR okuyucu WASM'ı içindir.
// blob: yalnız pakete gömülü renkli kod işçileri içindir (bellekte üretilir, dışarıdan gelmez).
const CSP = "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'unsafe-inline'; " +
  "img-src data: blob:; media-src blob:; connect-src data: blob:; worker-src blob:; font-src data:; base-uri 'none'; form-action 'none'";
html = html.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">`);

// Yalnız HTML işaretlemesine bakılır: gömülü betiklerin metni (ör. libcimbar) href="${…}" içerebilir.
const markup = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
const leftover = markup.match(/(src|href)="(?!https:|data:|#|mailto:)[^"]*"/g);
if (leftover) {
  console.error("Local references left in the package:", leftover.slice(0, 5));
  process.exit(1);
}

const name = `kionel-offline-${VERSION}.html`;
const bytes = Buffer.from(html, "utf8");
const sha256 = createHash("sha256").update(bytes).digest("hex");
writeFileSync(join(dist, name), bytes);
console.log(`${name} · ${bytes.length.toLocaleString("en")} bytes · SHA-256 ${sha256}`);
if (!publish) process.exit(0);

const out = join(web, "public/download");
mkdirSync(out, { recursive: true });
if (existsSync(join(out, name))) {
  console.error(`${name} is already published. Raise VERSION in tools/build-offline.mjs for a new release.`);
  process.exit(1);
}
writeFileSync(join(out, name), bytes);
// sha256sum -c ile doğrudan denetlenebilen biçim.
writeFileSync(join(out, `${name}.sha256`), `${sha256}  ${name}\n`);

const releasesPath = join(root, "tools/offline-releases.json");
const releases = existsSync(releasesPath) ? JSON.parse(readFileSync(releasesPath, "utf8")) : [];
releases.unshift({ version: VERSION, file: name, bytes: bytes.length, sha256, commit, date: new Date().toISOString().slice(0, 10) });
writeFileSync(releasesPath, `${JSON.stringify(releases, null, 2)}\n`);
console.log(`Published ${name}. Rebuild the site (pnpm launch:prepare) so the download page lists it.`);
