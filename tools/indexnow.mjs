// IndexNow: yayından sonra sitemap'teki adresleri Bing, Yandex, Seznam ve Naver'e bildirir.
// Yalnız herkese açık sayfa adresleri gider. ChatGPT arama, Copilot ve DuckDuckGo Bing dizinini kullanır.
// Kullanım: node tools/indexnow.mjs   (deploy'dan sonra)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const publicDir = join(import.meta.dirname, "../apps/web/public");
const keyFile = readdirSync(publicDir).find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
if (!keyFile) throw new Error("IndexNow anahtar dosyası yok (apps/web/public/<32 hex>.txt)");
const key = keyFile.slice(0, -4);
const urlList = [...readFileSync(join(publicDir, "sitemap.xml"), "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!urlList.length) throw new Error("sitemap.xml boş: önce pnpm launch:prepare");
const host = new URL(urlList[0]).host;
const response = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key, keyLocation: `https://${host}/${keyFile}`, urlList }),
});
// 200 ve 202 kabul; 403 anahtar dosyası sitede değil, 422 adres anahtarla uyuşmuyor.
console.log(`IndexNow: ${urlList.length} adres, yanıt ${response.status} ${response.statusText}`);
if (!response.ok) process.exit(1);
