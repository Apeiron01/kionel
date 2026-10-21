import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const configPath = join(root, "config/launch.local.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const blockers = [];
let origin = "";
try {
  const url = new URL(config.siteUrl);
  if (url.protocol !== "https:" || url.hostname.endsWith(".example") || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error();
  origin = url.origin;
} catch { blockers.push("Gerçek HTTPS siteUrl gerekli (config/launch.local.json)."); }
if (!config.sellerName?.trim()) blockers.push("Gerçek satıcı adı gerekli.");
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.supportEmail ?? "")) blockers.push("Çalışan destek e-postası gerekli.");
/**
 * Alanların ikiye ayrılması bilinçli.
 *
 * TÜRETİLEN alanlar bir karar değil, yapılandırmanın sonucudur: alan adı
 * alındığında privacy@/security@/abuse@ adresleri ve yürürlük tarihi kendiliğinden
 * belli olur. Bunları kullanıcıdan istemek, onu kendi yazdığı bilgiyi tekrar
 * yazmaya zorlamak olurdu.
 *
 * ELLE doldurulacak alanlar ise yalnız işletmecinin bilebileceği şeylerdir. Engel
 * listesinin kısa ve gerçek kalması için ayrım burada yapılıyor: bir insanın
 * bakıp "bunu ben veremem" diyeceği bir madde listede durmamalı.
 */
const hostname = origin ? new URL(origin).hostname : "";
const effectiveDate = config.effectiveDate?.trim() || new Date().toISOString().slice(0, 10);

/**
 * Barındırma platformlarının ücretsiz alt alan adları posta ALAMAZ: bölge sizin
 * olmadığı için Cloudflare Email Routing (veya herhangi bir MX kaydı) kurulamaz.
 *
 * Bu, sessiz olduğu için tehlikeli bir hataydı: kendi alan adı olmadan çıkan
 * biri için araç `privacy@proje.pages.dev` üretip "hazır" derdi ve KVKK
 * aydınlatmasının zorunlu kıldığı başvuru kanalı yayımlandığı gün ölü olurdu.
 * Eksik adres, çalışmayan adresten iyidir; çalışan adres ikisinden de iyidir —
 * o yüzden bu durumda üç takma ad yerine gerçek destek adresi yazılır.
 */
const MAILLESS_HOSTS = ["pages.dev", "workers.dev", "netlify.app", "vercel.app", "github.io"];
const canHostMail = hostname !== "" &&
  !MAILLESS_HOSTS.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
const alias = (prefix) => (canHostMail ? `${prefix}@${hostname}` : config.supportEmail);

const derived = hostname
  ? new Map([
      ["[ALAN ADI]", hostname],
      ["[privacy@ALAN-ADI]", alias("privacy")],
      ["[security@ALAN-ADI]", alias("security")],
      ["[abuse@ALAN-ADI]", alias("abuse")],
      ["[YÜRÜRLÜK TARİHİ]", effectiveDate],
      // Satış yüzeyi İngilizce; aynı değerler İngilizce metinlerde de doldurulur,
      // yoksa her yayında iki dilde elle düzeltme gerekirdi.
      ["[DOMAIN]", hostname],
      ["[privacy@DOMAIN]", alias("privacy")],
      ["[security@DOMAIN]", alias("security")],
      ["[EFFECTIVE DATE]", effectiveDate],
    ])
  : new Map();

const placeholders = /\[(?:[A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜ\s,/@.0-9—-]*|(?:privacy|security|abuse)@[^\]]+)\]/gu;
const manualLeft = new Set();
for (const file of ["LICENSE", ...readdirSync(join(root, "legal")).filter(f => f.endsWith(".md") && f !== "README.md").map(f => `legal/${f}`)]) {
  const found = readFileSync(join(root, file), "utf8").match(placeholders) ?? [];
  // Sonunda açıklama taşıyan alanlar ("… yoksa Yok yazın") isteğe bağlıdır.
  const missing = [...new Set(found)].filter((token) => !derived.has(token) && !token.includes("—"));
  for (const token of missing) manualLeft.add(token);
  if (missing.length) blockers.push(`${file}: ${missing.join(", ")}`);
}
const ready = blockers.length === 0;
const index = config.indexMarketing === true && ready;
/**
 * İndekslenecek sayfalar: yalnız İngilizce satış yüzeyi.
 *
 * Türkçe rehberler ve segment sayfaları dosyada duruyor ama listede değil:
 * hedef pazar yurt dışı olduğu için Türkçe sorgulardan gelen trafik satışa
 * dönmüyor ve arama motoruna sitenin dili konusunda karışık sinyal veriyor.
 * İngilizce karşılıkları yazıldığında buraya eklenecekler.
 */
const marketing = [
  // İngilizce satış yüzeyi — asıl hedef pazar.
  "index", "how-it-works", "security", "limits", "get-started", "pilot", "contact",
  "terms", "privacy", "sample-reconciliation", "changelog", "verify", "import-check", "csv-aktarim-kontrolu", "import-automation", "csv-otomasyonu", "import-automation-guide",
  "air-gapped-instrument-data-transfer", "file-transfer-audit-trail", "second-person-review-offline",
  "offline-pc-to-phone-file-transfer", "usb-file-transfer-signed-record", "usb-transfer-audit-trail-options", "pair-devices-by-sound", "data-diode-vs-usb-lab", "21-cfr-part-11-file-transfer", "alcoa-plus-file-transfer", "open-source-qr-file-transfer-vs-kionel", "ot-air-gapped-file-transfer", "iec-62443-file-transfer", "offline-package", "validation-pack", "sha256-file-checksum", "what-is-in-a-qr-code", "qr-file-transfer-benchmark", "nist-sp-1334-usb-ot", "qr-code-capacity-file-transfer", "excel-csv-changes-lab-data", "excel-damage-check", "serial-data-diode", "print-file-as-qr-codes", "encrypted-paper-backup", "offline-root-ca-ceremony-file-transfer", "leave-passwords-to-family", "medical-device-data-offline", "digital-evidence-chain-of-custody-offline", "instrument-results-to-lims-offline", "screen-recording-qr-codes-not-scanning", "cdn-changed-download-sha256", "send-file-pc-to-phone-without-internet", "guides", "transfer-speed-calculator", "site-policy",
  // Türkçe rehber, segment ve araç sayfaları. Zaten yazılmışlardı ve aramada
  // İngilizce sayfalarla yarışmıyorlar: farklı dil, farklı sorgu. Satın alma
  // yolu (fiyat, teslim) yalnız İngilizce kalır; iki dilde fiyat sürdürmek tek
  // kişilik ekipte her değişikliği ikiye katlardı.
  "numune-karsilastirma", "excel-csv-veri-bozulmasi", "excel-bozulma-kontrolu", "dosyayi-qr-kod-olarak-yazdir", "sifreli-kagit-yedek", "sifreleri-aileye-birakmak",
  // Almanca: DACH ilaç, kimya ve endüstriyel otomasyon.
  "sichere-datenuebertragung-offline", "messdaten-offline-pc-lims", "annex-11-dateitransfer", "ot-dateitransfer-ohne-usb", "serielle-datendiode", "excel-csv-fehler-pruefen", "datei-als-qr-code-drucken", "verschluesseltes-papier-backup", "sha256-pruefen", "impressum", "research", "seri-kablo-veri-diyotu", "sha256-dogrulama", "qr-kodun-icinde-ne-var", "usb-ile-dosya-aktarimi-imzali-kayit", "ekran-kaydi-qr-okunmuyor", "internetsiz-bilgisayardan-telefona-dosya-aktarma", "air-gap-dosya-aktarimi", "usb-yasak-alternatifler",
  "laboratuvar-veri-butunlugu", "ikinci-goz-incelemesi", "excel-numune-listesi-kontrolu",
  "laboratuvar-cihazindan-excele-veri", "air-gap-laboratuvar", "ot-uretim",
  "saglik-ve-klinik", "saha-ve-kanit-zinciri", "savunma-tedarik", "iletisim", "policies",
];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
for (const file of readdirSync(join(root, "apps/web")).filter(f => f.endsWith(".html"))) {
  const path = join(root, "apps/web", file);
  const slug = file.slice(0, -5);
  let html = readFileSync(path, "utf8");
  html = html.replace(/<meta\s+name="robots"[^>]*>/gi, "").replace(/<link\s+rel="canonical"[^>]*>/gi, "");
  html = html.replace(/<!-- launch-meta -->[\s\S]*?<!-- \/launch-meta -->/g, "");
  const robots = index && marketing.includes(slug) ? "index,follow" : "noindex,nofollow";
  let meta = `<meta name="robots" content="${robots}">`;
  if (origin && marketing.includes(slug)) meta += `<link rel="canonical" href="${esc(origin)}/${slug}.html">`;
  // Dil eşleri (hreflang) build-funnel.mjs'de üretilir; burada yinelenirse arama motoru çift etiket görür.
  html = html.replace("</head>", `<!-- launch-meta -->${meta}<!-- /launch-meta --></head>`);
  // Türetilen alanlar yalnız ÜRETİLEN sayfada doldurulur; legal/ kaynağı şablon
  // olarak kalır, yoksa alan adı değiştiğinde geri dönülemez.
  for (const [token, value] of derived) html = html.split(token).join(esc(value));
  writeFileSync(path, html);
}
const publicDir = join(root, "apps/web/public");
writeFileSync(join(publicDir, "robots.txt"), `User-agent: *\nAllow: /\nDisallow: /api/\n${index ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`);
writeFileSync(join(publicDir, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${index ? marketing.map(s => `<url><loc>${esc(origin)}/${s}.html</loc></url>`).join("") : ""}</urlset>`);

/**
 * security.txt (RFC 9116) da üretiliyor, elle doldurulmuyor.
 *
 * Elle tutulan hâli iki sessiz hata taşıyordu ve ikisi de aynı cinsten: yayımlanan
 * ama ÇALIŞMAYAN işaretler. `[ALAN-ADI]` yer tutucuları hiçbir zaman doldurulmuyordu
 * (bu dosya yer tutucu taramasının kapsamında değildi), ve dosya var olmayan bir
 * `pgp.txt` ile var olmayan bir `/security` sayfasına işaret ediyordu.
 *
 * RFC 9116 zorunlu alan olarak yalnız Contact ve Expires ister. Olmayanı yazmamak
 * doğru davranış: bir güvenlik araştırmacısının kırık bağlantıya tıklaması, hiç
 * bağlantı görmemesinden kötüdür. Expires altı ay sonrasıdır — RFC bir yıldan
 * kısa olmasını öğütler ve altı ay, dosyanın gerçekten gözden geçirileceği bir
 * aralıktır.
 */
const securityTxt = join(publicDir, ".well-known/security.txt");
if (!origin) {
  // siteUrl yoksa önceki koşumdan kalan dosya BAYATTIR ve başka bir alan adını
  // gösterir. Silmek şart: yanlış adresi yayımlamak, hiç yayımlamamaktan kötüdür.
  rmSync(securityTxt, { force: true });
} else {
  const expires = new Date(Date.now() + 180 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, ".000Z");
  mkdirSync(join(publicDir, ".well-known"), { recursive: true });
  writeFileSync(securityTxt, [
    "# Kionel guvenlik acigi bildirim kanali",
    "# RFC 9116 — https://www.rfc-editor.org/rfc/rfc9116",
    "",
    `Contact: mailto:${alias("security")}`,
    `Expires: ${expires}`,
    "Preferred-Languages: tr, en",
    `Canonical: ${origin}/.well-known/security.txt`,
    `Policy: ${origin}/policies.html`,
    "",
  ].join("\n"));
}
console.log(JSON.stringify({
  ready, indexed: index, commerceRequiresSeparateSandboxVerification: true,
  // Görünür olsun: takma adlar kendi alan adına mı bağlandı, yoksa alan adı
  // posta alamadığı için gerçek destek adresine mi düştü?
  contactAliases: hostname ? (canHostMail ? `*@${hostname}` : `${config.supportEmail} (alan adı posta alamıyor)`) : null,
  derivedFromSiteUrl: [...derived.keys()],
  manualFieldsLeft: [...manualLeft],
  blockers,
}, null, 2));
if (process.argv.includes("--check") && !ready) process.exitCode = 1;
