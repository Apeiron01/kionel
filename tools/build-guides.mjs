/**
 * Rehber sayfalarını üretir.
 *
 *   node tools/build-guides.mjs        (pnpm web:guides)
 *
 * Bu sayfalar iki okuyucu için birden yazılıyor ve ikisinin de ihtiyacı aynı
 * yönde: cevabı yukarı koy, iddiayı sınırıyla birlikte söyle, kaynağını göster.
 * Bir insanın güvendiği metinle bir dil modelinin alıntıladığı metin aynı metin.
 *
 * Üreteç iki şeyi zorunlu tutar ve karşılanmazsa sayfayı yazmaz:
 *  - `answer` boş olamaz. Soruyu ilk paragrafta cevaplamayan bir rehber, arama
 *    sonucunda da özetlemede de kaybeder.
 *  - `sources` boş olamaz. Kaynaksız bir mevzuat cümlesi, iddia değil temennidir.
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

const { GUIDES, GUIDE_DISCLAIMER } = await import(new URL("../apps/web/src/guides.ts", import.meta.url).href);

const escape = (value) =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `**kalın**` — rehber metninde vurgulanan tek biçim. */
const inline = (value) => escape(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

const productsPath = join(WEB, "products.html");
const products = readFileSync(productsPath, "utf8");
const rehome = (markup) =>
  markup.replace(/ data-section-link/g, "").replace(/href="#(?!\s)([a-z0-9-]+)"/gi, 'href="/products.html#$1"');
const header = rehome(products.match(/<header class="site-header"[\s\S]*?<\/header>/)[0]);
const footer = rehome(products.match(/<footer class="site-footer"[\s\S]*?<\/footer>/)[0]);

const byslug = new Map(GUIDES.map((guide) => [guide.slug, guide]));

function renderSection(section, index) {
  const parts = [
    `<h2 id="b${index + 1}" data-mask>${inline(section.heading)}</h2>`,
  ];
  for (const paragraph of section.body ?? []) parts.push(`<p data-reveal>${inline(paragraph)}</p>`);

  if (section.list) {
    parts.push(`<ul class="guide-list" data-stagger>${
      section.list.map((item) => `<li>${inline(item)}</li>`).join("")
    }</ul>`);
  }

  if (section.table) {
    const { caption, head, rows } = section.table;
    parts.push(
      `<div class="table-scroll" data-reveal><table>` +
      (caption ? `<caption>${inline(caption)}</caption>` : "") +
      `<thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>` +
      `<tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>` +
      `</table></div>`,
    );
  }

  if (section.note) parts.push(`<p class="guide-note" data-reveal>${inline(section.note)}</p>`);
  return parts.join("");
}

function page(guide) {
  if (!guide.answer?.trim()) {
    throw new Error(`${guide.slug}: "answer" boş — soruyu ilk paragrafta cevaplamayan rehber yayımlanmaz`);
  }
  if (!guide.sources?.length) {
    throw new Error(`${guide.slug}: "sources" boş — kaynaksız mevzuat cümlesi yayımlanmaz`);
  }

  const sections = guide.sections.map(renderSection).join("");

  const toc = guide.sections
    .map((section, index) => `<a href="#b${index + 1}">${escape(section.heading)}</a>`)
    .join("");

  const faq = guide.faq
    .map((entry) => `<details><summary>${escape(entry.question)}<span aria-hidden="true">+</span></summary><p>${inline(entry.answer)}</p></details>`)
    .join("");

  const sources = guide.sources
    .map((source) => `<li><a href="${escape(source.href)}" rel="noopener noreferrer" target="_blank">${escape(source.label)} <span>↗</span></a></li>`)
    .join("");

  const related = guide.related
    .map((slug) => byslug.get(slug))
    .filter(Boolean)
    .map((other) => `<a class="guide-card" href="/${other.slug}.html"><strong>${escape(other.title)}</strong><span>Rehberi aç →</span></a>`)
    .join("");

  /**
   * Yapısal veri. Arama motoru ve özetleyici asistan için makine okunur karşılığı;
   * sayfada yazmayan hiçbir şey buraya konmaz.
   */
  const jsonLd = JSON.stringify([
    {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: guide.title,
      description: guide.metaDescription,
      inLanguage: guide.lang,
      dateModified: guide.updated,
      articleSection: guide.sections.map((section) => section.heading),
      ...(ORIGIN ? { url: `${ORIGIN}/${guide.slug}.html` } : {}),
      citation: guide.sources.map((source) => source.href),
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: guide.faq.map((entry) => ({
        "@type": "Question",
        name: entry.question,
        acceptedAnswer: { "@type": "Answer", text: entry.answer },
      })),
    },
  ]);

  return `<!doctype html>
<html lang="${guide.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="${escape(guide.metaDescription)}" />
    <meta name="theme-color" content="#FBFAF7" />
    <meta name="robots" content="noindex,nofollow" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Kionel" />
    <meta property="og:title" content="${escape(guide.metaTitle)}" />
    <meta property="og:description" content="${escape(guide.metaDescription)}" />
    <meta property="og:image" content="/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <title>${escape(guide.metaTitle)}</title>
    <link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/ibm-plex-sans-400-latin.woff2" />
    <link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/source-serif-4-400-latin.woff2" />
    <link rel="stylesheet" href="/src/style.css" />
    <link rel="stylesheet" href="/src/products.css" />
    <link rel="stylesheet" href="/src/guide.css" />
    <script type="application/ld+json">${jsonLd}</script>
  </head>
  <body class="sales-page k-field">
    <a class="skip-link" href="#main-content">İçeriğe geç</a>
    <div class="scroll-progress" data-scroll-progress aria-hidden="true"></div>
${header}
    <main id="main-content" class="guide">
      <article>
        <header class="guide-hero">
          <span class="section-index">REHBER · ${escape(guide.updated)}</span>
          <h1 data-mask>${escape(guide.title)}</h1>
          <p class="guide-answer" data-reveal>${inline(guide.answer)}</p>
        </header>

        <nav class="guide-toc" aria-label="Bu sayfada">
          <span>BU SAYFADA</span>
          ${toc}
        </nav>

        <div class="guide-body">${sections}</div>

        <section class="guide-faq" aria-labelledby="faq-title">
          <h2 id="faq-title" data-mask>Sık sorulanlar</h2>
          <div class="faq-list" data-stagger>${faq}</div>
        </section>

        <section class="guide-sources" aria-labelledby="sources-title">
          <h2 id="sources-title" data-mask>Kaynaklar</h2>
          <ul class="source-list">${sources}</ul>
          <p class="guide-note">${escape(GUIDE_DISCLAIMER)}</p>
        </section>

        ${related ? `<section class="guide-related" aria-labelledby="related-title">
          <h2 id="related-title" data-mask>İlgili rehberler</h2>
          <div class="guide-cards" data-stagger>${related}</div>
        </section>` : ""}

        <aside class="guide-cta" data-reveal>
          <p>Bu sayfa Kionel tarafından yazıldı. Aktarım adımını kayda alan bir araç
             geliştiriyoruz; mevcut sisteminiz bu işi zaten çözüyorsa bunu da bilmek
             bizim için değerli.</p>
          <a class="site-button" href="/index.html">Laboratuvar iş akışını seç</a>
          <a class="site-button" href="/numune-karsilastirma.html">Numune karşılaştırma demosunu dene</a>
        </aside>
      </article>
    </main>
${footer}
    <script type="module" src="/src/segment-page.ts"></script>
  </body>
</html>
`;
}

const written = [];
for (const guide of GUIDES) {
  writeFileSync(join(WEB, `${guide.slug}.html`), page(guide), "utf8");
  written.push(guide.slug);
}

// Rehber dizini: ürün sayfasından buraya bir kapı olmalı, yoksa sayfalar yalnız
// arama sonucundan bulunur ve site kendi içinde onlara hiç bağlanmaz.
const indexCards = GUIDES.map((guide) =>
  `<a class="guide-card" href="/${guide.slug}.html" data-reveal>` +
  `<span>${escape(guide.searchIntent[0])}</span>` +
  `<strong>${escape(guide.title)}</strong>` +
  `<p>${escape(guide.metaDescription)}</p>` +
  `<em>Rehberi aç →</em></a>`,
).join("");

const indexSection =
  `<section id="guides" class="section-space" aria-labelledby="guides-title">` +
  `<span class="section-index">REHBERLER</span>` +
  `<h2 id="guides-title" data-mask>Önce sorunun kendisi.</h2>` +
  `<p class="segment-note">Bu sayfalar ürün anlatmıyor; ağa bağlı olmayan sistemlerden veri ` +
  `taşımanın gerçekten nasıl yapıldığını anlatıyor. Bizim çözümümüzün uygun olmadığı ` +
  `durumları da yazıyoruz.</p>` +
  `<div class="guide-cards" data-stagger>${indexCards}</div>` +
  `</section>`;

let salesPage = readFileSync(productsPath, "utf8");
const marker = /<section id="guides"[\s\S]*?<\/section>/;
salesPage = marker.test(salesPage)
  ? salesPage.replace(marker, indexSection)
  : salesPage.replace(/(<section id="technology")/, `${indexSection}\n      $1`);
if (!salesPage.includes('href="#guides"')) {
  salesPage = salesPage.replace(
    '<a data-section-link href="#segments">Sektörler</a>',
    '<a data-section-link href="#segments">Sektörler</a><a data-section-link href="#guides">Rehberler</a>',
  );
}
if (!salesPage.includes('href="/src/guide.css"')) {
  salesPage = salesPage.replace(
    '<link rel="stylesheet" href="/src/segment.css" />',
    '<link rel="stylesheet" href="/src/segment.css" />\n    <link rel="stylesheet" href="/src/guide.css" />',
  );
}
writeFileSync(productsPath, salesPage, "utf8");

console.log(
  `${written.length} rehber sayfası üretildi` +
    (ORIGIN ? "" : " (siteUrl yok: JSON-LD url alanı atlandı)"),
);
for (const slug of written) console.log(`  ${slug}.html`);
