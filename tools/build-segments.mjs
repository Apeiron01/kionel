/**
 * Generates one static page per buyer segment, plus sitemap.xml.
 *
 *   node tools/build-segments.mjs        (pnpm web:segments)
 *
 * These pages are the search surface: someone with an air-gap problem does not
 * search for "optical data transfer", they search for their own problem in
 * their own vocabulary. A single products page cannot rank for five different
 * vocabularies, so each buyer gets a page that speaks theirs.
 *
 * The generator refuses a segment whose `open` list is empty. A segment page
 * that lists only strengths is marketing; the honest gap list is the thing that
 * makes a regulated buyer take the next call, and it is not optional.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps", "web");

/**
 * Mutlak origin, `config/launch.local.json` içindeki `siteUrl`den okunur.
 * (`KIONEL_SITE_URL` ortam değişkeni tek seferlik geçersiz kılma için durur.)
 *
 * Önceden yalnız ortam değişkenine bakılıyordu ve kimse onu kurmuyordu; sonuç,
 * yapılandırmada gerçek bir alan adı dururken JSON-LD'nin `url` alanının boş
 * kalmasıydı. Yer tutucu/`.example` bir siteUrl kasıtlı olarak yok sayılır:
 * uydurulmuş bir alan adı, hiç olmayandan kötüdür.
 *
 * Canonical bağlantısını ve sitemap'i bu üretici YAZMAZ; ikisinin de tek sahibi
 * `tools/prepare-launch.mjs`'tir. İki kaynak olduğunda biri sessizce ölür —
 * nitekim öyle olmuştu: prepare-launch canonical'ları silip yeniden yazdığı için
 * buradan çıkan canonical hiçbir zaman yayına ulaşmıyordu.
 */
const ORIGIN = (() => {
  const override = process.env.KIONEL_SITE_URL?.replace(/\/+$/, "");
  if (override) return override;
  try {
    const { siteUrl } = JSON.parse(readFileSync(join(ROOT, "config", "launch.local.json"), "utf8"));
    const url = new URL(siteUrl);
    return url.protocol === "https:" && !url.hostname.endsWith(".example") ? url.origin : "";
  } catch { return "" }
})();

const { SEGMENTS } = await import(new URL("../apps/web/src/segments.ts", import.meta.url).href);

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Shared header and footer, lifted from products.html so the chrome never forks. */
const productsPath = join(WEB, "products.html");
const products = readFileSync(productsPath, "utf8");

/**
 * The sales page's nav is full of same-page anchors (#products, #pilot-scope).
 * Copied onto a segment page those anchors point at sections that do not exist
 * there, so they are rewritten to absolute links and the scroll-spy hook is
 * dropped — nothing on a segment page should claim to track them.
 */
const rehome = (markup) =>
  markup
    .replace(/ data-section-link/g, "")
    .replace(/href="#(?!\s)([a-z0-9-]+)"/gi, 'href="/products.html#$1"');

const header = rehome(products.match(/<header class="site-header"[\s\S]*?<\/header>/)[0]);
const footer = rehome(products.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)[0]);

function page(segment) {
  if (!segment.open?.length) {
    throw new Error(`${segment.slug}: "open" listesi boş — açık kapıları gizleyen segment sayfası yayımlanmaz`);
  }

  const pains = segment.pains
    .map((pain, index) => `<article data-reveal><span class="segment-index">${String(index + 1).padStart(2, "0")}</span><h3>${escape(pain.title)}</h3><p>${escape(pain.body)}</p></article>`)
    .join("");

  const delivers = segment.delivers
    .map((item) => `<article data-reveal><h3>${escape(item.title)}</h3><p>${escape(item.body)}</p></article>`)
    .join("");

  const controls = segment.controls
    .map((row) => `<tr><td><strong>${escape(row.framework)}</strong></td><td>${escape(row.control)}</td><td>${escape(row.contribution)}</td></tr>`)
    .join("");

  const list = (items) => items.map((item) => `<li>${escape(item)}</li>`).join("");

  const faq = segment.faq
    .map((entry) => `<details><summary>${escape(entry.question)}<span aria-hidden="true">+</span></summary><p>${escape(entry.answer)}</p></details>`)
    .join("");

  // FAQPage structured data: this is what a generative engine quotes back.
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: segment.faq.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  });

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="${escape(segment.metaDescription)}" />
    <meta name="theme-color" content="#FBFAF7" />
    <meta name="robots" content="noindex,nofollow" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Kionel" />
    <meta property="og:title" content="${escape(segment.title)} — Kionel" />
    <meta property="og:description" content="${escape(segment.metaDescription)}" />
    <meta property="og:image" content="/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <title>${escape(segment.title)} — Kionel</title>
    <link rel="preload" as="font" type="font/woff2" crossorigin
          href="/fonts/ibm-plex-sans-400-latin.woff2" />
    <link rel="preload" as="font" type="font/woff2" crossorigin
          href="/fonts/source-serif-4-400-latin.woff2" />
    <link rel="stylesheet" href="/src/style.css" />
    <link rel="stylesheet" href="/src/products.css" />
    <link rel="stylesheet" href="/src/segment.css" />
    <script type="application/ld+json">${jsonLd}</script>
  </head>
  <body class="sales-page k-field">
    <a class="skip-link" href="#main-content">İçeriğe geç</a>
    <div class="scroll-progress" data-scroll-progress aria-hidden="true"></div>
${header}
    <main id="main-content">
      <section class="segment-hero">
        <div data-reveal><span class="section-index">${escape(segment.eyebrow)}</span></div>
        <h1 id="segment-title" data-mask>${escape(segment.headline)}<br /><em>${escape(segment.headlineAccent)}</em></h1>
        <p class="segment-lede" data-reveal>${escape(segment.lede)}</p>
        <div class="hero-actions" data-reveal>
          <a class="site-button primary" data-magnetic="5" href="/products.html#pilot-scope">Pilotu kapsamlandır</a>
          <a class="site-button ghost" href="${escape(segment.product.href)}">${escape(segment.product.name)} →</a>
        </div>
      </section>

      <section class="section-space" aria-labelledby="pain-title">
        <span class="section-index">01 / BUGÜNKÜ DURUM</span>
        <h2 id="pain-title" data-mask>Sorun aktarımda değil, aktarımın kanıtsızlığında.</h2>
        <div class="segment-grid" data-stagger>${pains}</div>
        <aside class="segment-alternative" data-reveal>
          <h3>${escape(segment.alternative.title)}</h3>
          <p>${escape(segment.alternative.body)}</p>
        </aside>
      </section>

      <section class="section-space" aria-labelledby="deliver-title">
        <span class="section-index">02 / KIONEL NE VERİYOR</span>
        <h2 id="deliver-title" data-mask>Taşınan şey dosya değil, doğrulanmış bir oturum.</h2>
        <div class="segment-grid deliver-grid" data-stagger>${delivers}</div>
      </section>

      <section class="section-space" aria-labelledby="control-title">
        <span class="section-index">03 / KONTROL EŞLEMESİ</span>
        <h2 id="control-title" data-mask>Eşleme sunuyoruz, uyum değil.</h2>
        <p class="segment-note">Aşağıdaki tablo Kionel'in hangi kontrole ne katkı yaptığını gösterir. Uyum, kurumun kendi sisteminin ve denetiminin sonucudur; hiçbir satır otomatik uyum anlamına gelmez.</p>
        <div class="table-scroll" data-reveal>
          <table>
            <thead><tr><th>Çerçeve</th><th>Kontrol</th><th>Kionel'in katkısı</th></tr></thead>
            <tbody>${controls}</tbody>
          </table>
        </div>
      </section>

      <section class="section-space" aria-labelledby="status-title">
        <span class="section-index">04 / DÜRÜST DURUM</span>
        <h2 id="status-title" data-mask>Bugün ne kanıtlı, ne değil.</h2>
        <div class="status-split">
          <div class="status-card proven" data-reveal>
            <h3>Kanıtlı</h3>
            <ul>${list(segment.proven)}</ul>
          </div>
          <div class="status-card open" data-reveal>
            <h3>Hâlâ açık</h3>
            <ul>${list(segment.open)}</ul>
          </div>
        </div>
        <p class="segment-note">Bu listeyi kısaltmak için bir sebebimiz yok. Açık kapıları saklayan bir tedarikçi, denetimde sizin sorununuz olur.</p>
      </section>

      <section class="section-space" aria-labelledby="faq-title">
        <span class="section-index">05 / SIK SORULANLAR</span>
        <h2 id="faq-title" data-mask>Önce sorulanlar.</h2>
        <div class="faq-list" data-stagger>${faq}</div>
      </section>

      <section class="closing-section" data-reveal>
        <span>PİLOT</span>
        <h2>${escape(segment.title)} için kapsamı birlikte çıkaralım.</h2>
        <p>Kapsamlandırıcı adınızı, e-postanızı veya dosyanızı istemez. Çıktıyı tarayıcınızda üretir ve yalnızca siz indirirsiniz.</p>
        <div>
          <a class="site-button primary" data-magnetic="5" href="/products.html#pilot-scope">Kapsamı oluştur</a>
          <a class="site-button" href="/policies.html">Politika merkezi</a>
        </div>
      </section>
    </main>
${footer}
    <script type="module" src="/src/segment-page.ts"></script>
  </body>
</html>
`;
}

const written = [];
for (const segment of SEGMENTS) {
  const file = join(WEB, `${segment.slug}.html`);
  writeFileSync(file, page(segment), "utf8");
  written.push(segment.slug);
}

/**
 * The sales page's segment index, generated from the same data. Hand-writing it
 * meant it drifted the first time a segment was renamed.
 */
const cards = SEGMENTS.map((segment) =>
  `<a class="segment-card" href="/${segment.slug}.html" data-reveal>` +
  `<span>${escape(segment.eyebrow.replace(/^SEGMENT \/ /, ""))}</span>` +
  `<strong>${escape(segment.title)}</strong>` +
  `<p>${escape(segment.lede.split(". ")[0])}.</p>` +
  `<em>Segmenti aç &rarr;</em></a>`,
).join("");

const section =
  `<section id="segments" class="section-space" aria-labelledby="segments-title">` +
  `<span class="section-index">SEKTÖRLER</span>` +
  `<h2 id="segments-title" data-mask>Sorun her sektörde aynı değil.</h2>` +
  `<p class="segment-note">Her sayfa o sektörün kendi diliyle yazıldı ve neyin kanıtlı, neyin hâlâ açık olduğunu ayrı ayrı listeler.</p>` +
  `<div class="segment-cards" data-stagger>${cards}</div>` +
  `</section>`;

const marker = /<section id="segments"[\s\S]*?<\/section>/;
let salesPage = readFileSync(productsPath, "utf8");
salesPage = marker.test(salesPage)
  ? salesPage.replace(marker, section)
  : salesPage.replace(/(<section id="technology")/, `${section}
      $1`);
if (!salesPage.includes('href="#segments"')) {
  salesPage = salesPage.replace(
    '<a data-section-link href="#deployment">Dağıtım</a>',
    '<a data-section-link href="#segments">Sektörler</a><a data-section-link href="#deployment">Dağıtım</a>',
  );
}
// The index cards live in segment.css; the sales page needs it too.
if (!salesPage.includes('href="/src/segment.css"')) {
  salesPage = salesPage.replace(
    '<link rel="stylesheet" href="/src/products.css" />',
    '<link rel="stylesheet" href="/src/products.css" />\n    <link rel="stylesheet" href="/src/segment.css" />',
  );
}
writeFileSync(productsPath, salesPage, "utf8");

console.log(`${written.length} segment sayfası üretildi`);
for (const slug of written) console.log(`  ${slug}.html`);
