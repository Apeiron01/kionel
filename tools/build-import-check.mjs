import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const app = fileURLToPath(new URL("../apps/web/", import.meta.url));

for (const [slug, lang, excel] of [["import-check", "en", false], ["csv-aktarim-kontrolu", "tr", false], ["excel-import-check", "en", true]]) {
  const t = (en, tr) => lang === "tr" ? tr : en;
  const title = t("Check and map a CSV before import", "CSV'yi aktarmadan önce kontrol edin");
  const description = t("Check record keys, missing rows, decimal formats and units; map columns and download the prepared CSV. Files stay in your browser. No account required.", "Kayıt kimliklerini, eksik satırları, ondalık biçimini ve birimleri kontrol edin. Sütunları eşleyip hazırlanan CSV'yi indirin. Dosya içeriği sunucuya gönderilmez.");
  writeFileSync(`${app}${slug}.html`, `<!doctype html>
<html lang="${lang}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Kionel Import Check</title><meta name="description" content="${description}">
<meta name="referrer" content="no-referrer"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
${excel ? '<meta name="robots" content="noindex,nofollow"><script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>' : `<link rel="canonical" href="https://kionel.com/${slug}.html"><link rel="alternate" hreflang="en" href="https://kionel.com/import-check.html"><link rel="alternate" hreflang="tr" href="https://kionel.com/csv-aktarim-kontrolu.html">`}
<link rel="stylesheet" href="/src/funnel.css"><script type="module" src="/src/import-check-page.ts"></script></head>
<body class="import-check-page${excel ? " excel-pane" : ""}"><a class="skip-link" href="#main">${t("Skip to content", "İçeriğe geç")}</a>
<header><a class="brand" href="/index.html"><b>Kionel</b></a><nav aria-label="${t("Navigation", "Gezinme")}"><a href="/transfer.html">${t("File transfer", "Dosya aktarımı")}</a><a href="/${lang === "tr" ? "import-check" : "csv-aktarim-kontrolu"}.html">${lang === "tr" ? "English" : "Türkçe"}</a></nav></header>
<main id="main"><section class="ic-intro"><p class="eyebrow">KIONEL / IMPORT CHECK</p><h1>${title}</h1>
<p class="lead">${t("Give the next system a file that matches your rules.", "Sonraki sisteme, belirlediğiniz kurallara uyan bir dosya hazırlayın.")}</p>
<p>${description}</p><p class="ic-free">${t("Free hosted tool · your own CSV · no sign-up", "Ücretsiz web aracı · kendi CSV'niz · üyelik gerekmez")}</p>
<div class="ic-actions"><button type="button" id="ic-example">${t("Try a valid example", "Doğru örneği dene")}</button><button type="button" class="secondary" id="ic-broken">${t("See a missing-record example", "Eksik kayıt örneğini gör")}</button></div>
</section>
<p id="ic-status" class="ic-status" role="status" aria-live="polite" hidden></p>
<section class="ic-panel" aria-labelledby="ic-source-heading"><div class="ic-step">01</div><h2 id="ic-source-heading">${t("Choose the source", "Kaynağı seçin")}</h2>
${excel ? `<div class="ic-excel"><button type="button" id="ic-excel">Read selected Excel range</button><p>Select a single rectangle including column headers. Only the displayed text is read, after you click. Existing Excel rounding or lost digits cannot be recovered. This add-in candidate still needs real Excel host testing and marketplace review.</p></div>` : ""}
<div class="ic-source-options"><label>${t("CSV file (UTF-8, up to 2 MB)", "CSV dosyası (UTF-8, en fazla 2 MB)")}<input id="ic-source-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"></label>
<label>${t("Source separator", "Kaynak ayırıcı")}<select id="ic-source-separator"><option value="auto">${t("Detect from header", "Başlıktan belirle")}</option><option value=",">${t("Comma", "Virgül")} (,)</option><option value=";">${t("Semicolon", "Noktalı virgül")} (;)</option><option value="tab">${t("Tab", "Sekme")}</option></select></label></div>
<details id="ic-paste"><summary>${t("Or paste / inspect the CSV", "CSV'yi yapıştırın veya inceleyin")}</summary><label for="ic-source-text">${t("Source CSV, including header", "Başlık dahil kaynak CSV")}</label><textarea id="ic-source-text" rows="5" maxlength="2097152" spellcheck="false" autocomplete="off"></textarea></details>
<p id="ic-source-info" class="ic-note">${t("CSV and TSV are supported. For .xlsx use CSV UTF-8 export, or the Excel add-in candidate.", "CSV ve TSV desteklenir. .xlsx için CSV UTF-8 olarak dışa aktarın.")}</p>
<button type="button" class="secondary" id="ic-columns">${t("Create a profile from these columns", "Bu sütunlardan yeni profil oluştur")}</button></section>
<section class="ic-panel" aria-labelledby="ic-profile-heading"><div class="ic-step">02</div><h2 id="ic-profile-heading">${t("Set the import rules", "Aktarım kurallarını belirleyin")}</h2>
<p>${t("A saved profile keeps the expected source header, target names and checks together. Loading another file never silently replaces its rules.", "Profil; beklenen kaynak başlığını, hedef sütun adlarını ve kontrolleri birlikte saklar. Başka bir dosya seçmek kuralları kendiliğinden değiştirmez.")}</p>
<label>${t("Load a saved profile (JSON)", "Kaydedilmiş profil yükle (JSON)")}<input id="ic-profile-file" type="file" accept=".json,application/json"></label>
<div id="ic-profile-editor" hidden><div class="ic-settings"><label>${t("Profile name", "Profil adı")}<input id="ic-profile-name" maxlength="120" value="My import"></label><label>${t("Revision", "Sürüm")}<input id="ic-profile-revision" type="number" min="1" max="999999" value="1"></label>
<label>${t("Output separator", "Çıktı ayırıcı")}<select id="ic-output-separator"><option value=",">${t("Comma", "Virgül")}</option><option value=";">${t("Semicolon", "Noktalı virgül")}</option><option value="tab">${t("Tab", "Sekme")}</option></select></label>
<label>${t("Output decimal", "Çıktı ondalık işareti")}<select id="ic-output-decimal"><option value=".">. (${t("dot", "nokta")})</option><option value=",">, (${t("comma", "virgül")})</option></select></label></div>
<p class="ic-note">${t("Use one or several key columns, such as sample + test. Rule: ID width, decimal separator (. or ,), or allowed choices separated by |. Every mapped value is required. No rounding, trimming or unit conversion is performed.", "Numune + test gibi bir veya birkaç kimlik sütunu seçin. Kural: kimlik uzunluğu, ondalık işareti (. veya ,) ya da | ile ayrılmış izinli değerler. Eşlenen her değer zorunludur. Yuvarlama, boşluk temizleme ve birim dönüşümü yapılmaz.")}</p>
<div class="ic-table-wrap"><table class="ic-mapping"><thead><tr><th>${t("Source", "Kaynak")}</th><th>${t("Target name", "Hedef adı")}</th><th>${t("Type", "Tür")}</th><th>${t("Rule", "Kural")}</th><th>${t("Key", "Kimlik")}</th></tr></thead><tbody id="ic-mapping"></tbody></table></div>
<div class="ic-actions"><button type="button" class="secondary" id="ic-save-profile">${t("Download profile", "Profili indir")}</button><button type="button" class="secondary" id="ic-plan-template">${t("Download expected-list header", "Beklenen liste başlığını indir")}</button></div></div></section>
<section class="ic-panel" aria-labelledby="ic-plan-heading"><div class="ic-step">03</div><h2 id="ic-plan-heading">${t("Check completeness, if you have a plan", "Planınız varsa kapsamı da kontrol edin")}</h2>
<p>${t("Optional: provide the expected keys. Use only the target key column names, in profile order. Without this list, missing records cannot be determined.", "İsteğe bağlı: beklenen kayıt kimliklerini ekleyin. Başlıkta yalnız hedef kimlik sütunlarının adlarını, profildeki sırayla kullanın. Bu liste olmadan eksik kayıt belirlenemez.")}</p>
<label>${t("Expected-key CSV", "Beklenen kimlik CSV'si")}<input id="ic-plan-file" type="file" accept=".csv,.tsv,.txt,text/csv"></label>
<label for="ic-plan-text">${t("Or paste expected keys", "Ya da beklenen kimlikleri yapıştırın")}</label><textarea id="ic-plan-text" rows="3" maxlength="2097152" spellcheck="false" autocomplete="off"></textarea>
<button type="button" class="secondary" id="ic-clear-plan">${t("Remove expected list", "Beklenen listeyi kaldır")}</button></section>
<div class="ic-run"><button type="button" id="ic-check">${t("Check and prepare CSV", "Kontrol et ve CSV'yi hazırla")}</button><button type="button" class="secondary" id="ic-reset">${t("Clear all data", "Tüm veriyi temizle")}</button><span>${t("Up to 10,000 rows · 32 columns", "En fazla 10.000 satır · 32 sütun")}</span></div>
<section id="ic-result" class="ic-panel" aria-live="polite" hidden><h2 id="ic-result-title"></h2><p id="ic-result-summary"></p><p id="ic-coverage" class="ic-note"></p>
<div class="ic-table-wrap"><table><thead id="ic-result-head"></thead><tbody id="ic-result-body"></tbody></table></div>
<div class="ic-actions"><button type="button" id="ic-download" disabled>${t("Download prepared CSV", "Hazırlanan CSV'yi indir")}</button><button type="button" class="secondary" id="ic-report" disabled>${t("Download check report", "Kontrol raporunu indir")}</button></div>
<p class="ic-note">${t("This is a local check against the supplied rules, not destination acceptance, an approval signature or a compliance certificate. Only an explicitly selected decimal separator is converted. Import identifier columns as text if you open the output in a spreadsheet.", "Bu sonuç, verilen kurallara göre yerel kontroldür; hedef sistemin kabulü, onay imzası veya uygunluk sertifikası değildir. Yalnız açıkça seçilen ondalık işareti dönüştürülür. Çıktıyı elektronik tabloda açarken kimlik sütunlarını metin olarak içe aktarın.")}</p></section>
<section class="ic-next"><h2>${t("Use these rules on every incoming file", "Bu kuralları gelen her dosyada kullanın")}</h2><p>${t("Import Automation runs your saved profile against a local folder and prepares passing CSVs with per-file reports. Download its synthetic demonstration before purchasing a separate automation licence.", "Import Automation, kayıtlı profilinizi yerel klasörde uygular; geçen CSV'leri dosya raporlarıyla hazırlar. Ayrı otomasyon lisansını satın almadan önce sentetik örneğini indirip deneyin.")}</p><a class="button secondary" href="/${lang === "tr" ? "csv-otomasyonu" : "import-automation"}.html?source=import-check">${t("See folder automation", "Klasör otomasyonunu incele")}</a></section>
<p class="ic-note">${t("Your files are processed in this tab and are not sent to Kionel. Nothing is saved automatically. In the Excel add-in, Microsoft supplies the Office runtime. Closing this tab clears the working data; downloaded files remain on your device.", "Dosyalar bu sekmede işlenir ve Kionel'e gönderilmez. Kendiliğinden kayıt yapılmaz. Sekmeyi kapatınca çalışma verisi silinir; indirdiğiniz dosyalar cihazınızda kalır.")}</p>
</main><footer><a href="/terms.html">${t("Terms", "Koşullar")}</a> · <a href="/privacy.html">${t("Privacy", "Gizlilik")}</a> · <a href="/index.html">Kionel</a></footer></body></html>`, "utf8");
}
mkdirSync(`${app}public/office`, { recursive: true });
writeFileSync(`${app}public/office/kionel-import-check.xml`, `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp">
  <Id>68d8db7b-9db1-4ae6-99c4-8ee87427310b</Id><Version>0.1.0.0</Version><ProviderName>Kionel</ProviderName><DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Kionel Import Check"/><Description DefaultValue="Check selected result data and prepare a mapped CSV before importing it into another system."/>
  <SupportUrl DefaultValue="https://kionel.com/contact.html"/>
  <Hosts><Host Name="Workbook"/></Hosts>
  <Requirements><Sets DefaultMinVersion="1.1"><Set Name="MatrixCoercion"/></Sets></Requirements>
  <DefaultSettings><SourceLocation DefaultValue="https://kionel.com/excel-import-check.html"/></DefaultSettings>
  <Permissions>ReadDocument</Permissions>
</OfficeApp>`, "utf8");
// Preserve existing page content; add discovery links without regenerating the older funnel.
for (const [file, target, label] of [["index.html", "import-check", "Import Check"], ["excel-damage-check.html", "import-check", "Import Check"],
  ["excel-bozulma-kontrolu.html", "csv-aktarim-kontrolu", "CSV aktarım kontrolü"]]) {
  const path = `${app}${file}`;
  if (!existsSync(path)) continue;
  const html = readFileSync(path, "utf8");
  const nav = /(<nav\b[^>]*>)([\s\S]*?)(<\/nav>)/;
  const updated = html.replace(nav, (all, open, content, close) => content.includes(`/${target}.html`) ? all
    : `${open}<a href="/${target}.html">${label}</a>${content}${close}`);
  if (updated !== html) writeFileSync(path, updated, "utf8");
}
console.log("Built EN/TR Import Check pages and Excel sideload candidate. No deployment or marketplace submission.");
