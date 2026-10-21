import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
// Validasyon paketi: gereksinimler, IQ ve OQ tek listeden; izlenebilirlik buradan üretilir.
// Bir test eklenince/çıkınca "Verified by" sütunu kendiliğinden değişir.
const VP_REQUIREMENTS = [
  ["URS-01", "Runs on the isolated PC from a single file, with no installation, network access or administrator rights."],
  ["URS-02", "The installed file can be identified by version and checked against a published SHA-256; it does not change itself."],
  ["URS-03", "File content is encrypted before it is shown, so that only the intended receiving device can open it."],
  ["URS-04", "A transfer cannot be opened with a wrong code."],
  ["URS-05", "The received file is identical to the sent file; a different or incomplete file is not accepted."],
  ["URS-06", "The sending device signs a record of the file's SHA-256, size, work order, classification and target system."],
  ["URS-07", "The receiving device signs a delivery receipt that includes the sender's record."],
  ["URS-08", "Records can be verified independently of Kionel, and any change to them is detected."],
  ["URS-09", "A human-readable report of each record can be printed or saved as PDF."],
  ["URS-10", "All functions are available in the open-source edition without a licence file; records stay verifiable regardless of edition."],
  ["URS-11", "Every user action ends with a visible success or failure message."],
  ["URS-12", "An unsupported browser is reported clearly before any transfer is attempted."],
  ["URS-13", "Optionally, received files and receipts are written to a chosen folder without overwriting existing files."],
  ["URS-14", "Optionally, receipts carry an independent trusted timestamp; its failure never blocks a delivery."],
  ["URS-15", "A signed record can be made for a file without transferring it (seal)."],
  ["URS-16", "Loaded files can be removed, and codes shown on screen can be hidden."],
  ["URS-17", "Users are warned about flashing images before the first transfer."],
  ["URS-18", "Several files can be sent as one transfer, with a signed list of each file's SHA-256."],
  ["URS-19", "Every file a device sends, receives or seals is kept in a transfer log with its signed record, exportable for periodic audit-trail review."],
  ["URS-20", "Files and work orders that do not match the site's policy are refused before sending, and the active policy is recorded for each transfer."],
  ["URS-21", "The operator's name or ID, as declared at the sending PC, is signed into the dispatch record and shown in the transfer log; a site policy can make it mandatory."],
  ["URS-24", "A file can be printed as pages of encrypted codes and rebuilt from the pages in any order, with some codes unreadable, by camera, photo or scan."],
  ["URS-27", "A file that travelled outside Kionel (for example on a USB stick) can be checked on the receiving device against the sending device's sealed record; if it matches, the receiving device signs a delivery receipt, and if it differs, nothing is signed."],
  ["URS-26", "The receiving device can be set to accept files only from pinned sender keys; a file signed by any other key is refused and not saved, and a repeated transfer on a serial link is not delivered twice."],
  ["URS-25", "A sending PC can watch a folder and send each new or changed file over a one-way serial cable, unattended; the receiver keeps listening and saves each file with its receipt."],
  ["URS-23", "A file can be sent over a serial cable, one way, with the same encryption and signed records as the optical route; corrupted or lost data on the line is detected and recovered."],
  ["URS-22", "Files saved to a folder can be named from the signed record (work order, date, operator) so an importer can match them without renaming."],
];

const VP_IQ = [
  ["Download the package from kionel.com/offline-package.html on a PC with internet access.", "File name matches the version in scope (section 1)."],
  ["Compute its SHA-256 (for example <code>certutil -hashfile &lt;file&gt; SHA256</code>).", "Value equals the SHA-256 in section 1."],
  ["Copy the file to each target PC through the site's approved route.", "Route and change reference recorded."],
  ["Place it in a folder users cannot write to.", "Path and permissions recorded."],
  ["Check the browser version (<code>edge://version</code> or <code>chrome://version</code>).", "Chrome or Edge 137 or later."],
  ["Open the file. Read the line at the bottom of the page.", "Shows <em>Kionel offline package</em> with the version and build in section 1."],
  ["On a computer that will receive, open Receive with its webcam.", "The camera picture appears; no error message."],
  ["Read the status line under the device identity.", "It says <em>Open source edition (AGPL-3.0)</em> and no licence file is asked for."],
  ["On the PC, disconnect or confirm the absence of any network, then reload the file.", "The page works unchanged."],
];

const VP_OQ = [
  { id: "OQ-01", title: "Send a result file with a typed code", req: ["URS-03", "URS-05", "URS-06", "URS-07", "URS-11"],
    steps: ["On the receiver choose <em>Receive → Show a code</em>.", "On the PC choose a small CSV result file, enter work order <code>OQ-01</code>, type the code, press <em>Send with this code</em>.", "Point the receiver's camera at the PC screen until the file arrives.", "Compute the SHA-256 of the source file on the PC and of the received file."],
    expect: "The receiver shows “received and verified”. Both SHA-256 values are identical. The receipt names OQ-01." },
  { id: "OQ-02", title: "A wrong code is refused", req: ["URS-04", "URS-11"],
    steps: ["Repeat OQ-01, but change one character of the code typed on the PC."],
    expect: "The receiver does not open the transfer and says the code does not open it. No file is offered." },
  { id: "OQ-03", title: "Larger file by recording the screen", req: ["URS-05"],
    steps: ["On the PC choose <em>Fast</em> and a file of about 500 KB; send with a code.", "On the receiver choose <em>Record the screen now</em> and film for the time the PC shows.", "Let Kionel read the recording."],
    expect: "The file arrives and is verified. If the recording was too short, the receiver says how many seconds more to film." },
  { id: "OQ-04", title: "Transaction details in the signed records", req: ["URS-06", "URS-09"],
    steps: ["After OQ-01, print the transfer report on the receiver (<em>Print transfer report</em>)."],
    expect: "The report shows the work order, classification, target system, file size and SHA-256, and both signatures as valid." },
  { id: "OQ-05", title: "Independent verification", req: ["URS-08"],
    steps: ["Open kionel.com/verify.html (or the saved verify page) on any computer.", "Add the receipt from OQ-01 and the original file."],
    expect: "All checks pass: delivery signature, dispatch signature and file content." },
  { id: "OQ-06", title: "Tampering is detected", req: ["URS-08", "URS-05"],
    steps: ["Edit one character of the receipt JSON (for example the size) and verify it again.", "Verify the unmodified receipt with a different file."],
    expect: "The edited receipt is reported <em>Not valid</em>. With a different file, the signatures pass and the file content check fails." },
  { id: "OQ-07", title: "Every function is available without a licence", req: ["URS-10", "URS-11"],
    steps: ["Open the transfer page in a browser that has never loaded a licence.", "Try the seal, the recording mode and printing more than 5 pages."],
    expect: "Each function works and no licence is requested. Records made earlier still verify (OQ-05)." },
  { id: "OQ-08", title: "Seal a file without transferring it", req: ["URS-15"],
    steps: ["On the PC choose a file, enter a work order and press <em>Seal without transferring</em>.", "Scan the seal code with the receiver's live camera."],
    expect: "The receiver reports the sealed record received and its signature verified; the file itself is not transferred." },
  { id: "OQ-09", title: "Save to a folder without overwriting", req: ["URS-13"],
    steps: ["On a receiving computer press <em>Save received files to a folder…</em> and choose an empty test folder.", "Receive the same file twice."],
    expect: "The folder holds <code>name</code>, <code>name.makbuz.json</code>, <code>name (2)</code> and <code>name (2).makbuz.json</code>; nothing is overwritten." },
  { id: "OQ-10", title: "Trusted timestamp (website version only)", req: ["URS-14"],
    steps: ["On a receiver using kionel.com, switch on <em>Add a trusted timestamp</em> and receive a file.", "Verify the receipt on the verify page.", "Disconnect the receiver from the internet and receive again."],
    expect: "The first message shows a trusted time from DigiCert, and the verify page passes the trusted-time check. Offline, the delivery completes with a warning that no timestamp was added." },
  { id: "OQ-11", title: "Remove a file and hide codes", req: ["URS-16", "URS-11"],
    steps: ["Choose a file and start sending, then press <em>Remove file</em>.", "Show the pairing code, then press the same button again."],
    expect: "Sending stops and the codes disappear with a confirmation. The pairing code is hidden with a confirmation." },
  { id: "OQ-12", title: "Warnings before risk", req: ["URS-17", "URS-12"],
    steps: ["In a fresh browser profile, start the first transfer.", "Open the package in a browser older than version 137, if one is available."],
    expect: "A flashing-images warning appears first; cancelling it sends nothing. The old browser shows a message naming the required versions." },
  { id: "OQ-13", title: "Several files in one transfer", req: ["URS-18", "URS-05"],
    steps: ["On the PC select two result files together and send them with a code.", "On the receiver, download the ZIP and unpack it.", "Check each file against MANIFEST-SHA256.txt (for example <code>sha256sum -c MANIFEST-SHA256.txt</code>) and against the SHA-256 of the source files."],
    expect: "One ZIP arrives and is verified. It holds both files and MANIFEST-SHA256.txt; every SHA-256 matches the source files." },
  { id: "OQ-15", title: "Site policy refuses what it should", req: ["URS-20", "URS-11"],
    steps: ["Load your site policy (see kionel.com/site-policy.html) with <em>Load site policy</em>.", "Choose a file with an extension the policy does not allow; then one above its size limit.", "Choose an allowed file and enter a work order in the wrong format, then in the right one.", "After sending, export the transfer log as CSV."],
    expect: "Disallowed files and the wrong work order are refused with a message naming the rule; the correct one is sent. The CSV names the policy in the site_policy column." },
  { id: "OQ-22", title: "File carried on a USB stick, with a sealed record", req: ["URS-27", "URS-15", "URS-05", "URS-11"],
    steps: ["On the sending PC seal a test file and download the sealed record.", "Copy the file and the sealed record to a USB stick; make a second copy of the file and change one character in it.", "On the receiving device open <em>Receive</em>, add the sealed record, then add the changed copy.", "Add the unchanged file.", "Add the sealed record and the unchanged file once more."],
    expect: "The changed copy is refused with the reason and no receipt is offered. The unchanged file is delivered with a delivery receipt whose SHA-256 matches the source, and the result states that the file travelled outside Kionel. The repeat is not signed again and the date of the first delivery is shown." },
  { id: "OQ-21", title: "Receiver accepts only pinned senders", req: ["URS-26", "URS-11"],
    steps: ["Receive one file over the serial cable from the intended sending PC and press <em>Accept only this sender from now on</em>.", "Send a file from a second PC, or from another browser profile on the same PC, with the same receiver card or code.", "On the receiver press <em>Accept any sender again</em>."],
    expect: "After pinning, the receiver names the pinned key. The second sender's file is refused with that sender's key in the message and is neither offered for download nor written to the folder. After the last step the receiver states that any sender is accepted again." },
  { id: "OQ-20", title: "Unattended folder over a serial cable", req: ["URS-25", "URS-13", "URS-11"],
    steps: ["On the receiving computer create a receiver card, choose a folder for received files, choose <em>Receive → Fixed PC — receiver card → Serial cable</em>, tick <em>Keep listening after each file</em> and listen.", "On the PC load the card, enter a change ticket, open <em>Unattended: watch a folder</em>, choose an empty test folder and start.", "Copy two small files into the watched folder, one minute apart; then change one of them.", "Stop watching on the PC and stop listening on the receiver."],
    expect: "The receiving folder holds both files, the changed file as a second copy, and a receipt for each; their SHA-256 values match the sources. Both stop messages give the number of files: three." },
  { id: "OQ-19", title: "Print a file and read it back", req: ["URS-24", "URS-05", "URS-11"],
    steps: ["On the PC choose a CSV of about 20 KB and press <em>Print the file as codes</em> (standard density). Note the code shown.", "Cross out one code on one page with a marker.", "On the receiving device choose <em>Receive → Printed pages</em>, enter the code and scan the pages in reverse order.", "Compare the SHA-256 of the source and received files."],
    expect: "The file is delivered and verified despite the crossed-out code; both SHA-256 values match. Before the last page, the receiver reports the share collected." },
  { id: "OQ-18", title: "One-way serial cable", req: ["URS-23", "URS-05", "URS-11"],
    steps: ["Connect the PC's transmit line to the receiving computer's receive line and ground only (see kionel.com/serial-data-diode.html).", "On the receiving computer choose <em>Receive → Sender has no camera — show a code → Serial cable</em>, set 115,200 baud and listen.", "On the PC type the code, open <em>Send over a serial cable</em>, set 115,200 baud and send a file with work order <code>OQ-18</code>.", "Repeat with the receiver set to a different speed.", "Compare the SHA-256 of the source and received files."],
    expect: "The file arrives and is verified; both SHA-256 values match and the receipt names OQ-18. With mismatched speeds the receiver reports data without Kionel frames and delivers nothing." },
  { id: "OQ-17", title: "File names from the signed record", req: ["URS-22", "URS-13"],
    steps: ["After OQ-09, enter <code>{workorder}_{name}</code> under <em>File names in the folder</em>.", "Receive a file sent with work order <code>OQ-17</code>.", "Enter <code>{wo}</code> in the same field."],
    expect: "The folder holds <code>OQ-17_name</code> and <code>OQ-17_name.makbuz.json</code>, with the same SHA-256 as the source. The unknown field is refused with a message and the previous pattern stays in use." },
  { id: "OQ-16", title: "Operator in the signed record", req: ["URS-21", "URS-08"],
    steps: ["With a site policy that sets <code>\"requireOperator\": true</code>, send a file with the operator field empty.", "Enter the operator's name or ID and send it again.", "On the receiver, open the receipt on the verify page; then change one letter of the operator in the receipt JSON and verify it again.", "Export the transfer log as CSV on both devices."],
    expect: "The empty field is refused with a message naming the policy. The receipt shows <em>Operator (declared)</em> with the name and verifies; the edited receipt is reported <em>Not valid</em>. The CSV has the name in the operator column." },
  { id: "OQ-14", title: "Transfer log for periodic review", req: ["URS-19"],
    steps: ["After OQ-01 and OQ-08, open <em>Transfer log and periodic review</em> on each device and choose today's date as the period.", "Press <em>Export CSV</em>, <em>Print review report</em> and <em>Download signed records (JSON)</em>.", "Verify one record from the JSON on the verify page."],
    expect: "The counts match the transfers made (sent, received, sealed). The CSV opens in Excel with correct characters, the report lists every entry with fields for the reviewer's signature, and the record verifies." },
];

// Üretici testleri: yayımlanan sürüm için koşulan sayılar (tools/e2e/ ve vitest).
const VENDOR_TESTS = {
  unit: 429,
  e2e: [
    ["Free edition", "Sending, receiving and every message of the free edition", 21],
    ["Licence", "Loading, moving and removing the licence", 10],
    ["Seal, paper seal and carried file", "Sealing, scanning and printing a seal; a file that arrived by USB checked against its sealed record and signed for; a wrong file refused; a repeated delivery not signed twice", 19],
    ["Film now, read later", "A recording read later on another device; a wrong code refused while what was read is kept, then opened with the right code", 9],
    ["Open and close", "Removing files and licences, hiding codes", 22],
    ["Start over", "Restarting a transfer for a receiver who missed the start", 7],
    ["Folder saving", "Saving files and receipts without overwriting, and naming them from the signed record", 19],
    ["Trusted timestamp", "A real DigiCert timestamp, its verification, and failure without blocking", 11],
    ["Offline package", "The package opened from disk: licence, sending, no outside connection even if a script is injected", 7],
    ["Package acceptance", "A real browser download from kionel.com checked by SHA-256, then used as sender and as two receivers (recording and live camera); receipt checked by the offline verifier", 12],
    ["Old browser", "The message on browsers without the required cryptography", 4],
    ["Several files", "Two files sent as one ZIP; contents and manifest checked with an independent ZIP reader", 8],
    ["Phone-like recording", "A 4K recording with the code in part of the picture, read to delivery", 5],
    ["Shrunk video", "A video at the size a messaging app leaves (478×850): the reason and the fix are shown, the stopwatch stops", 5],
    ["Background tab", "Reading pauses while the page is in the background and completes on return; a missing transfer code is named", 6],
    ["Transfer log", "Log entries on both devices with the operator, CSV export with formula-safe cells, review report, signed records that verify independently", 10],
    ["Paper", "A file printed as pages, photographed, one code removed, pages opened out of order; dense pages; identical file; images ready before printing; one sheet per page on A4 and Letter; step guide; a wrong code keeps what was read; code entered after scanning", 20],
    ["Unattended folder link", "A watched folder sent over a simulated serial line to a receiver that keeps listening: new and changed files arrive with receipts, existing files are left, contents identical, counts on stop", 12],
    ["Pairing and receipt by sound", "The receiving page's pairing sound fed to the sending page's microphone: reply code, the same comparison code on both screens, file delivered and identical; then the signed delivery receipt played back as sound, heard and verified on the sending page; a sound that is not a receipt is refused; messages for no file, stop and success", 21],
    ["Serial cable", "Two browsers on a simulated serial line with corrupted bytes: delivery, identical file, signed context, wrong speed, no port chosen, stop, licence; a pinned sender, a second device refused and then accepted, and a replayed transfer not delivered twice", 22],
    ["Excel damage check", "Traces found in one file, every changed cell against the original, identical files, removal, download, Turkish page, nothing sent from the page", 15],
    ["Site policy", "Refusing file types, sizes, work orders and a missing operator, with the rule named; the policy and operator in the log; removal", 13],
    ["Colour code in the package", "The package opened from disk sends by colour code; its recording is read back and the file matches", 5],
  ],
};

const offlineReleases = existsSync(join(root, "tools/offline-releases.json"))
  ? JSON.parse(readFileSync(join(root, "tools/offline-releases.json"), "utf8")) : [];
const configPath = join(root, "config/launch.local.json");
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
/**
 * Sayfalarda e-posta adresi yazılmıyor; form sayfasına yönlendiriliyor.
 *
 * Açıkta duran bir `mailto:` spam toplar ve geri alınamaz. Politika sayfalarındaki
 * privacy@/security@/abuse@ takma adları hukuken yayımlanmak zorunda ve zaten
 * yönlendirmeli adreslerdir; satış yazışması için ayrıca adres yayımlamanın
 * karşılığı yok.
 */
const contact = (lang = "tr") => lang === "en" ? '<a href="/contact.html">Contact form</a>' : '<a href="/iletisim.html">İletişim formu</a>';
const tool = (en) => `<p>${en ? "Free and open source: up to 10,000 IDs per list. Compare two lists without uploading their contents. One ID per line; paste an Excel column without its header. Leading zeroes and case are preserved." : "Ücretsiz ve açık kaynak: liste başına 10.000 kimliğe kadar. İki listeyi içeriklerini sunucuya yüklemeden karşılaştırın. Her satıra bir kimlik yazın; Excel sütununu başlık olmadan yapıştırın. Baştaki sıfırlar ve büyük/küçük harf korunur."}</p>
<div class="columns"><label>${en ? "Expected IDs" : "Beklenen kimlikler"}<textarea id="expected" rows="9" spellcheck="false" placeholder="LAB-001&#10;LAB-002"></textarea></label>
<label>${en ? "Received IDs" : "Teslim alınan kimlikler"}<textarea id="received" rows="9" spellcheck="false" placeholder="LAB-001&#10;LAB-003"></textarea></label></div>
<div class="actions"><button id="compare">${en ? "Compare lists" : "Listeleri karşılaştır"}</button><button id="example" class="secondary">${en ? "Load example" : "Örnekle dene"}</button><button id="download" class="secondary" disabled>${en ? "Download report" : "Raporu indir"}</button><button id="clear" class="secondary">${en ? "Clear" : "Temizle"}</button></div>
<div id="comparison-result" role="status" aria-live="polite"></div>
<p class="note">${en ? "This checks textual identifiers, not physical sample identity, analytical results or regulatory compliance. The JSON report is unsigned; its hashes describe the supplied text, not who supplied it. No list is stored between visits." : "Bu araç metin kimliklerini karşılaştırır; fiziksel numune kimliğini, analiz doğruluğunu veya mevzuata uyumu doğrulamaz. JSON raporu imzasızdır; özet değerler verilen metni tanımlar, kimin verdiğini kanıtlamaz. Listeler sonraki ziyaret için saklanmaz."}</p>
<h2>${en ? "Need a controlled handover?" : "Karşılaştırmadan sonra kontrollü teslim gerekiyor mu?"}</h2>
<p>${en ? "Missing records are one step. Kionel's pilot also evaluates offline file delivery and signed handover evidence in your actual workflow." : "Eksik kaydı bulmak ilk adım. Kionel pilotunda dosyanın çevrimdışı teslimi ve imzalı teslim kaydı da kendi iş akışınızda değerlendirilebilir."}</p>
<a class="button" href="https://github.com/Apeiron01/kionel">${en ? "Source code on GitHub" : "Kaynak kod GitHub'da"}</a>`;
// QR inceleme aracının soruları: sayfadaki metin ve FAQPage verisi tek listeden üretilir.
const QR_FAQ = {
  en: [
    ["Is a QR code encrypted?", "No. A QR code is a way of drawing text, and any phone reads it. If the text was encrypted before it was drawn, the code carries encrypted text; you cannot tell that by looking at the squares."],
    ["Can someone get my Wi-Fi password from a photo of the QR code?", "Yes. A Wi-Fi sharing code contains the network name and the password in plain text. Show the code of a guest network, not of your main one."],
    ["Is it safe to send a screenshot of a two-factor (2FA) set-up QR code?", "No. It contains the secret that generates every future login code, so anyone with the screenshot can generate them too. If one was exposed, set up two-factor again so the old secret stops working."],
    ["Can a camera's sharing QR code reveal its password?", "It can, if the app puts the password into the code and only scrambles it. This tool shows whether a code carries readable text or an unreadable string; for the unreadable kind, only the maker can say whether it is encrypted."],
    ["Does this tool upload my QR code?", "No. The picture is read in your browser tab and nothing is sent anywhere. Once the page has loaded, it works with the network switched off."],
  ],
  tr: [
    ["QR kod şifreli midir?", "Hayır. QR kod bir metni çizmenin yoludur ve her telefon okur. Metin çizilmeden önce şifrelendiyse kod şifreli metin taşır; bunu karelere bakarak anlayamazsınız."],
    ["QR kodun fotoğrafından Wi-Fi parolam öğrenilebilir mi?", "Evet. Wi-Fi paylaşım kodu ağın adını ve parolasını düz metin olarak taşır. Ana ağın değil, misafir ağının kodunu gösterin."],
    ["İki adımlı doğrulama (2FA) kurulum kodunun ekran görüntüsünü göndermek güvenli mi?", "Hayır. Kod, ileride üretilecek bütün giriş kodlarının sırrını taşır; ekran görüntüsünü alan herkes aynı kodları üretebilir. Açığa çıktıysa iki adımlı doğrulamayı yeniden kurun, eski sır geçersiz olur."],
    ["Kameranın paylaşım QR kodu parolasını ele verebilir mi?", "Verebilir; uygulama parolayı kodun içine koyup yalnızca karıştırıyorsa. Bu araç kodun okunabilir metin mi, okunamayan bir dizi mi taşıdığını gösterir; okunamayan türün şifreli olup olmadığını yalnızca üretici söyleyebilir."],
    ["Bu araç QR kodumu bir yere yüklüyor mu?", "Hayır. Resim tarayıcı sekmenizde okunur, hiçbir yere gönderilmez. Sayfa bir kez açıldıktan sonra ağ kapalıyken de çalışır."],
  ],
};
const USB_FAQ = {
  en: [
    ["How do I create an audit trail for files moved by USB stick?", "Record what left and what arrived, and tie the two together. With Kionel the sending PC signs a sealed record of the file's SHA-256, size, time and work order before it leaves; the receiving device checks the file against that record and signs a delivery receipt. Both devices keep a transfer log that can be exported."],
    ["How can I prove a file was not changed on a USB stick?", "Compare its SHA-256 on arrival with the SHA-256 recorded before it left. A signed record makes that comparison checkable later: the receiving device signs only if the two match, and anyone can verify both signatures offline."],
    ["Does this replace USB device control or malware scanning?", "No. It does not lock ports, decide which sticks may be used, or scan content. It records the handover. Use it alongside the site's device-control and scanning tools."],
    ["Is the file encrypted on the stick?", "Not by Kionel. On this route the file travels as it is. Use an encrypted stick, or the screen-to-camera route, which encrypts before the first image is shown."],
    ["Does it need a network or an installation?", "No. It runs in a browser tab. For PCs that never go online there is an offline package: one HTML file with a published SHA-256."],
  ],
  tr: [
    ["USB bellekle taşınan dosyalar için denetim kaydı nasıl tutulur?", "Neyin çıktığını ve neyin ulaştığını kaydedip ikisini birbirine bağlayarak. Kionel'de gönderen bilgisayar dosya çıkmadan önce SHA-256 özetini, boyutunu, zamanını ve iş emrini içeren mühürlü bir kaydı imzalar; alan cihaz dosyayı bu kayda karşı denetler ve teslim makbuzunu imzalar. İki cihaz da dışa aktarılabilen bir aktarım günlüğü tutar."],
    ["Dosyanın USB bellekte değişmediğini nasıl kanıtlarım?", "Varıştaki SHA-256 özetini, dosya çıkmadan önce kaydedilen özetle karşılaştırarak. İmzalı kayıt bu karşılaştırmayı sonradan da denetlenebilir kılar: alan cihaz yalnızca ikisi aynıysa imzalar ve iki imza da çevrimdışı doğrulanabilir."],
    ["Bu, USB cihaz denetiminin ya da zararlı yazılım taramasının yerini tutar mı?", "Hayır. Port kilitlemez, hangi belleğin kullanılacağına karar vermez, içeriği taramaz. Teslimi kaydeder. Kurumun cihaz denetimi ve tarama araçlarıyla birlikte kullanılır."],
    ["Dosya bellekte şifreli mi?", "Kionel tarafından değil. Bu yolda dosya olduğu gibi taşınır. Şifreli bellek kullanın ya da ilk görüntü gösterilmeden önce şifreleyen ekrandan kameraya yolunu seçin."],
    ["Ağ ya da kurulum gerekir mi?", "Hayır. Tarayıcı sekmesinde çalışır. Hiç çevrimiçi olmayan bilgisayarlar için çevrimdışı paket vardır: SHA-256 özeti yayımlanan tek bir HTML dosyası."],
  ],
};
const faqLd = (items) => `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: items.map(([name, text]) => ({ "@type": "Question", name, acceptedAnswer: { "@type": "Answer", text } })) }).replace(/</g, "\\u003c")}</script>`;
const faqHtml = (items) => items.map(([question, answer]) => `<h3>${question}</h3>\n<p>${answer}</p>`).join("\n");

const pages = [
  { slug: "iletisim", title: "İletişim", description: "Kionel hakkında soru sorun. Mesajınız formla iletilir; yanıt e-posta ile döner.", body: `
<h1>İletişim</h1>
<p>Laboratuvar iş akışınızı, mevcut çözümünüzün yetmediği adımı veya pilot kapsamını
konuşmak isterseniz yazın. <strong>Kurumunuzun gerçek verisini veya dosyasını göndermeyin;</strong>
soruyu anlamak için kurmaca bir örnek yeterli.</p>
<form id="contact-form">
<label>Ad soyad<input name="name" maxlength="120" required autocomplete="name"></label>
<label>E-posta<input name="email" type="email" maxlength="200" required autocomplete="email"></label>
<label>Kurum <span class="note">(isteğe bağlı)</span><input name="organisation" maxlength="200" autocomplete="organization"></label>
<label>Mesajınız<textarea name="message" rows="7" maxlength="4000" required></textarea></label>
<label class="trap" aria-hidden="true" tabindex="-1">Bu alanı boş bırakın<input name="website" tabindex="-1" autocomplete="off"></label>
<button id="contact-submit">Gönder</button><p id="contact-status" role="status" aria-live="polite"></p>
</form>
<p class="note">Formu gönderdiğinizde adınız, e-posta adresiniz ve mesajınız yalnız
size dönüş yapmak için işlenir. Ayrıntı ve haklarınız için
<a href="/policies.html#privacy">gizlilik bildirimi</a>. Mevzuat gereği yayımlanan
başvuru adresleri de aynı sayfadadır.</p>
<p class="note">Güvenlik açığı bildiriyorsanız formu değil,
<a href="/policies.html#security">güvenlik bildirim politikasındaki</a> adresi kullanın.</p>` },
  { slug: "contact", lang: "en", title: "Contact", description: "Ask about Kionel for your laboratory. Your message is sent through a form and we reply by email.", body: `
<h1>Contact</h1>
<p>Tell us about the handover step your current tools do not cover, or ask about
scope and pricing. <strong>Do not send your organisation's real data or files;</strong>
a made-up example is enough for us to understand the question.</p>
<form id="contact-form">
<label>Name<input name="name" maxlength="120" required autocomplete="name"></label>
<label>Email<input name="email" type="email" maxlength="200" required autocomplete="email"></label>
<label>Organisation <span class="note">(optional)</span><input name="organisation" maxlength="200" autocomplete="organization"></label>
<label>What are you trying to move?<select name="workflow"><option value="">Select one</option><option>Small result files from an instrument PC</option><option>Method or configuration files to an instrument</option><option>Sample manifests to reconcile</option><option>Signed evidence for an existing transfer route</option><option>Something else</option></select></label>
<label>How is it handled today?<select name="current"><option value="">Select one</option><option>USB stick</option><option>Network or LIMS connection</option><option>Manual transcription or printing</option><option>No approved route yet</option><option>Something else</option></select></label>
<label>Message<textarea name="message" rows="7" maxlength="4000" required></textarea></label>
<label class="trap" aria-hidden="true" tabindex="-1">Leave this field empty<input name="website" tabindex="-1" autocomplete="off"></label>
<button id="contact-submit">Send</button><p id="contact-status" role="status" aria-live="polite"></p>
</form>
<p class="note">Your name, email and message are used only to reply to you. See the
<a href="/privacy.html">privacy notice</a>.</p>
<p class="note">Reporting a security issue? Use the address in the
<a href="/privacy.html">privacy notice</a>, not this form.</p>` },
  { slug: "index", lang: "en", head: "<script type=\"application/ld+json\">{\"@context\": \"https://schema.org\", \"@type\": \"FAQPage\", \"mainEntity\": [{\"@type\": \"Question\", \"name\": \"Does the instrument PC need a camera?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"No. The receiving phone or tablet shows a one-time 12-character code; you type it on the PC, and the PC sends by screen only. For a PC that always sends to the same device, a receiver card replaces the code. A PC with no usable screen route can print the file as pages of codes, or send over a one-way serial cable.\"}}, {\"@type\": \"Question\", \"name\": \"Can the file travel on a USB stick?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"Yes. Seal the file on the sending PC, carry the file and its sealed record on the stick, and the receiving device checks the file against the record and signs the delivery receipt. On that route Kionel does not encrypt the file or control the USB port; the screen-to-camera route encrypts before the first image is shown.\"}}, {\"@type\": \"Question\", \"name\": \"How fast is it?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"Reading live with a phone's camera: in our phone test, a 117 KB file took 10 to 24 seconds. Filming the screen with the phone's camera app and letting Kionel read the video took about 7 seconds for the same file and suits files of a few megabytes; the sending screen counts down how long to film. The speed calculator on the site gives an estimate for any size. Text and CSV are compressed first and often shrink four to ten times. It is the wrong tool for large raw data.\"}}, {\"@type\": \"Question\", \"name\": \"Is anything installed on the instrument PC?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"No. It runs in the browser, and after the first visit it works with no network at all.\"}}, {\"@type\": \"Question\", \"name\": \"Does Kionel see our files?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"No. File content goes from screen to camera between your two devices. Our server only receives contact messages; if you switch on trusted timestamps, it also passes each receipt's 32-byte fingerprint to DigiCert, never the file.\"}}, {\"@type\": \"Question\", \"name\": \"Can an auditor check a record without Kionel?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"Yes. Records verify offline with a free Apache-2.0 verifier, or in any browser at kionel.com/verify.html, where nothing is uploaded. A printable one-page report is produced for reviewers who do not read JSON.\"}}, {\"@type\": \"Question\", \"name\": \"What happens if we clear the browser or change computers?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"Device keys and receiver cards belong to the browser that made them; create new ones if that data is cleared. Records you already exported stay verifiable.\"}}, {\"@type\": \"Question\", \"name\": \"Is Kionel open source?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"Yes. The code is on GitHub under AGPL-3.0 and the record verifier under Apache-2.0. Organisations that embed Kionel in a closed-source product can buy a commercial licence.\"}}, {\"@type\": \"Question\", \"name\": \"Do both devices have to be there at the same time?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"No. The phone can film the sending screen with its camera app, and Kionel can read the video later — on the same or another phone — once the code used for the transfer is typed in. Without that code the recording cannot be opened.\"}}, {\"@type\": \"Question\", \"name\": \"Which computers and browsers does it run on?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"Chrome or Edge 137 or later, Firefox 130 or later, or Safari 17 or later, on both devices. Windows 10 and 11, macOS, Linux, Android and iOS can run these. Windows 7 and 8.1 cannot, so Kionel does not run there. The app checks this when it opens and says so.\"}}, {\"@type\": \"Question\", \"name\": \"Does the sending PC need internet access?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"No. Download the offline package once on another PC, check its SHA-256, and copy the single file to the isolated PC. It opens in Chrome or Edge 137 or later and never contacts the network or updates itself.\"}}, {\"@type\": \"Question\", \"name\": \"Is there a free version?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"Yes, all of it. Kionel is open source: signed records, reports, the audit chain, the fast recording mode and receiver cards are included, for personal and organisational use. A commercial licence is only for embedding Kionel in a closed-source product.\"}}, {\"@type\": \"Question\", \"name\": \"How is it different from free QR file transfer tools?\", \"acceptedAnswer\": {\"@type\": \"Answer\", \"text\": \"Open-source tools move the file, some faster than Kionel. Kionel adds what a regulated lab needs around the move: encryption tied to the receiving device, a signed dispatch and delivery record bound to the work order, a local audit chain and a printable report. Kionel is open source too.\"}}]}</script>", title: "Verifiable file handover for isolated lab systems", description: "Signed records for files leaving isolated laboratory instrument PCs: the sender signs what left, the receiver signs what arrived, by screen and camera, one-way cable, printed pages or the USB stick you already use. Verifiable offline, years later.", body: `
<div class="hero-light" aria-hidden="true"></div>
<section class="hero">
<div>
<p class="eyebrow">Lab Bridge</p>
<h1>Verifiable file handover for isolated lab systems.</h1>
<p class="lead">Whatever carries the file — a screen and a camera, a one-way cable, printed pages, or the USB stick you already use — the sending device signs what left and the receiving device signs what arrived. Anyone can check both offline, years later.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/how-it-works.html">See how it works</a></div>
<p class="note">The file left the instrument PC. Can you prove what arrived?</p>
</div>
<div><svg class="bridge" viewBox="0 0 560 300" role="img" aria-label="A file on an isolated instrument PC is encrypted, carried to a receiving device as optical frames on screen, and both sides sign the handover."><rect x="6" y="54" width="196" height="150" rx="10" fill="#0f2025" stroke="#3d626b"/><text x="26" y="82" fill="#7d979b" font-family="PlexMono, monospace" font-size="11" letter-spacing="1.6">INSTRUMENT PC</text><text x="26" y="112" fill="#f1f7f6" font-family="PlexMono, monospace" font-size="14">result.csv</text><text x="26" y="134" fill="#a9bec0" font-family="PlexMono, monospace" font-size="11">42 KB</text><text x="26" y="166" fill="#6de3c2" font-family="PlexMono, monospace" font-size="11">AES-256-GCM sealed</text><text x="26" y="184" fill="#7d979b" font-family="PlexMono, monospace" font-size="10">sha-256 9ad2...a77e</text><rect x="358" y="54" width="196" height="150" rx="10" fill="#0f2025" stroke="#3d626b"/><text x="378" y="82" fill="#7d979b" font-family="PlexMono, monospace" font-size="11" letter-spacing="1.6">RECEIVING DEVICE</text><text x="378" y="112" fill="#f1f7f6" font-family="PlexMono, monospace" font-size="14">result.csv</text><g class="verified"><text x="378" y="150" fill="#6de3c2" font-family="PlexMono, monospace" font-size="12">hash match</text><text x="378" y="170" fill="#6de3c2" font-family="PlexMono, monospace" font-size="12">signatures valid</text></g><g class="frame f1"><rect x="226" y="120" width="20" height="20" rx="2" fill="#6de3c2" opacity=".9"/></g><g class="frame f2"><rect x="226" y="120" width="20" height="20" rx="2" fill="#6de3c2" opacity=".9"/></g><g class="frame f3"><rect x="226" y="120" width="20" height="20" rx="2" fill="#6de3c2" opacity=".9"/></g><line x1="210" y1="130" x2="350" y2="130" stroke="#243b42" stroke-width="1" stroke-dasharray="3 5"/><text x="232" y="106" fill="#7d979b" font-family="PlexMono, monospace" font-size="10" letter-spacing="1.2">SCREEN</text><text x="228" y="166" fill="#7d979b" font-family="PlexMono, monospace" font-size="10" letter-spacing="1.2">CAMERA</text><text x="6" y="248" fill="#a9bec0" font-family="PlexMono, monospace" font-size="11">signed dispatch</text><text x="358" y="248" fill="#a9bec0" font-family="PlexMono, monospace" font-size="11">signed delivery</text><text x="6" y="270" fill="#7d979b" font-family="PlexMono, monospace" font-size="10">verifiable offline, without Kionel</text></svg></div>
</section>
<div class="trust-strip"><span>No network required</span><span>File content stays on device</span><span>Two signed receipts</span><span>Offline verification</span></div>

<h2>Three situations this solves</h2>
<div class="cards">
<section><p class="eyebrow">Isolated workstation</p><svg class="mini" viewBox="0 0 240 72" role="img" aria-label="An isolated instrument PC sends to a tablet through a camera, with no network."><rect x="2" y="16" width="62" height="42" rx="6" fill="none" stroke="#3d626b"/><text x="10" y="41" fill="#a9bec0" font-family="PlexMono, monospace" font-size="9">PC</text><rect x="176" y="16" width="62" height="42" rx="6" fill="none" stroke="#3d626b"/><text x="192" y="41" fill="#a9bec0" font-family="PlexMono, monospace" font-size="9">TABLET</text><rect class="mini-frame m1" x="92" y="28" width="12" height="12" rx="2" fill="#6de3c2"/><rect class="mini-frame m2" x="110" y="28" width="12" height="12" rx="2" fill="#6de3c2"/><rect class="mini-frame m3" x="128" y="28" width="12" height="12" rx="2" fill="#6de3c2"/><line x1="66" y1="34" x2="88" y2="34" stroke="#243b42" stroke-dasharray="3 4"/><line x1="144" y1="34" x2="174" y2="34" stroke="#243b42" stroke-dasharray="3 4"/><text x="92" y="60" fill="#7d979b" font-family="PlexMono, monospace" font-size="8">NO NETWORK</text></svg><h2>The instrument PC cannot join the network</h2><p>An old validated configuration, or a site policy that forbids the connection. The results still have to leave. Today they leave on a USB stick, and the stick leaves no record. Kionel can replace the stick, or <a href="/usb-file-transfer-signed-record.html">leave it in place and add the record</a>.</p><a class="text-link" href="/air-gapped-instrument-data-transfer.html">Compare the routes</a></section>
<section><p class="eyebrow">Reconciliation</p><svg class="mini" viewBox="0 0 240 72" role="img" aria-label="Expected and received sample lists compared: one missing, one unexpected."><text x="4" y="14" fill="#7d979b" font-family="PlexMono, monospace" font-size="8">EXPECTED</text><text x="128" y="14" fill="#7d979b" font-family="PlexMono, monospace" font-size="8">RECEIVED</text><text x="4" y="32" fill="#a9bec0" font-family="PlexMono, monospace" font-size="11">A01</text><text x="4" y="48" fill="#a9bec0" font-family="PlexMono, monospace" font-size="11">A02</text><text x="4" y="64" fill="#a9bec0" font-family="PlexMono, monospace" font-size="11">A03</text><text x="128" y="32" fill="#a9bec0" font-family="PlexMono, monospace" font-size="11">A01</text><text class="hl" x="128" y="48" fill="#f2c66d" font-family="PlexMono, monospace" font-size="11">A04</text><text x="128" y="64" fill="#a9bec0" font-family="PlexMono, monospace" font-size="11">A03</text><text x="62" y="32" fill="#6de3c2" font-family="PlexMono, monospace" font-size="11">ok</text><text class="hl" x="62" y="48" fill="#f2c66d" font-family="PlexMono, monospace" font-size="11">missing</text><text x="62" y="64" fill="#6de3c2" font-family="PlexMono, monospace" font-size="11">ok</text></svg><h2>The sample lists do not match</h2><p>Expected versus received manifests, with missing, unexpected and duplicate IDs found in the browser. Nothing is uploaded.</p><a class="text-link" href="/sample-reconciliation.html">Start free</a></section>
<section><p class="eyebrow">Second-person review</p><svg class="mini" viewBox="0 0 240 72" role="img" aria-label="Produced, reviewed and released, each step signed over the previous one."><circle cx="18" cy="36" r="9" fill="none" stroke="#6de3c2"/><circle cx="106" cy="36" r="9" fill="none" stroke="#6de3c2"/><circle cx="200" cy="36" r="9" fill="none" stroke="#6de3c2"/><line class="link l1" x1="28" y1="36" x2="96" y2="36" stroke="#243b42"/><line class="link l2" x1="116" y1="36" x2="190" y2="36" stroke="#243b42"/><text x="2" y="62" fill="#a9bec0" font-family="PlexMono, monospace" font-size="9">produced</text><text x="84" y="62" fill="#a9bec0" font-family="PlexMono, monospace" font-size="9">reviewed</text><text x="180" y="62" fill="#a9bec0" font-family="PlexMono, monospace" font-size="9">released</text><text x="40" y="28" fill="#7d979b" font-family="PlexMono, monospace" font-size="8">signed</text><text x="134" y="28" fill="#7d979b" font-family="PlexMono, monospace" font-size="8">signed</text></svg><h2>Someone else has to approve it</h2><p>Who produced the result, who reviewed it, who released it — signed in order, travelling with the file instead of living in three separate systems.</p><a class="text-link" href="/how-it-works.html">See the evidence model</a></section>
</div>

<h2>See Lab Bridge in action</h2>
<p>This is the app itself, not an illustration: the same labels and the same two steps you will see on your own devices. It runs in a browser tab and needs no install.</p>
<div class="app-shots">
<figure class="app-frame"><div class="app-bar"><i></i><i></i><i></i><span>kionel.com/transfer.html</span></div>
<div class="app-body">
<div class="app-tabs"><b>Send</b><span>Receive</span></div>
<div class="app-file"><strong>result_041.csv</strong><small>42 KB · chosen</small></div>
<div class="app-field"><small>Work order / instrument reference</small><span>LCMS-2026-0042</span></div>
<div class="app-row"><div class="app-field"><small>Classification</small><span>Confidential</span></div><div class="app-field"><small>Target system</small><span>LC-MS workstation</span></div></div>
<p class="app-hint">Scan the receiver's offer QR</p>
</div><figcaption>1 · Sender prepares the file and its work order</figcaption></figure>
<figure class="app-frame"><div class="app-bar"><i></i><i></i><i></i><span>kionel.com/transfer.html</span></div>
<div class="app-body">
<div class="app-sas"><span class="app-digits">482 917</span><div class="app-marks"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20 L12 4 L20 20 Z"/></svg><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5 H19 V19 H5 Z"/></svg><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 A9 9 0 1 0 12.01 3 Z"/></svg><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 L21 12 L12 21 L3 12 Z"/></svg><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 H20 M12 4 V20"/></svg></div><small>The digits AND the symbols must match on both devices</small></div>
<div class="app-button">Codes match — start transfer</div>
<dl class="app-done"><dt>content hash</dt><dd>match</dd><dt>delivery signature</dt><dd>valid</dd></dl>
</div><figcaption>2 · Both screens show the same code, then the file moves</figcaption></figure>
</div>
<p><a class="text-link" href="/transfer.html">Open the app with the sample file</a></p>
<ul class="capabilities">
<li><strong>PC without a camera</strong><span>Type a one-time code from the phone; the PC sends by screen only.</span></li>
<li><strong>Report for the auditor</strong><span>One printable page: file, SHA-256, work order, each signature check.</span></li>
<li><strong>Verify in any browser</strong><span><a href="/verify.html">kionel.com/verify.html</a> — offline, nothing uploaded.</span></li>
<li><strong>Colour code</strong><span>Denser images for a clean screen recording, recognised automatically by the receiver.</span></li>
<li><strong>Read from a recording</strong><span>Film the screen with the phone's camera app; no need to hold still, and a countdown says when to stop.</span></li>
<li><strong>Compressed before sending</strong><span>CSV and text results shrink four to ten times on screen.</span></li>
</ul>


<h2>From file to verifiable evidence</h2>
<p>Five steps, about a minute for a small file. The detail is on the <a href="/how-it-works.html">protocol page</a>.</p>
<ol class="flow">
<li><span>01</span><strong>Prepare</strong><small>Choose the file, add the work order</small></li>
<li><span>02</span><strong>Compare</strong><small>Six digits and five symbols, on both screens</small></li>
<li><span>03</span><strong>Transfer</strong><small>Encrypted optical frames, loss tolerant</small></li>
<li><span>04</span><strong>Sign</strong><small>Dispatch and delivery, two keys</small></li>
<li><span>05</span><strong>Verify</strong><small>Offline, years later, without us</small></li>
</ol>
<p><a class="text-link" href="/how-it-works.html">See the complete protocol</a></p>

<h2>What the two records actually say</h2>
<p>This is the part a USB stick cannot do. <strong>One transfer produces two independently signed records</strong> — one from each device — and anyone with the free verifier can read them.</p>
<div class="preview">
<div class="panel"><div class="panel-head"><span>Sender</span><span>Lab Bridge</span></div><div class="panel-body"><dl>
<dt>file</dt><dd>result_041.csv</dd>
<dt>size</dt><dd>42 KB</dd>
<dt>work order</dt><dd>LCMS-2026-0042</dd>
<dt>target</dt><dd>Analysis workstation</dd>
<dt>hash</dt><dd>9ad2...a77e</dd>
<dt>status</dt><dd class="ok">dispatch signed</dd>
</dl></div></div>
<div class="panel"><div class="panel-head"><span>Receiver</span><span>Delivery receipt</span></div><div class="panel-body"><dl>
<dt>content hash</dt><dd class="ok">match</dd>
<dt>dispatch signature</dt><dd class="ok">valid</dd>
<dt>delivery signature</dt><dd class="ok">valid</dd>
<dt>audit entry</dt><dd class="ok">chained</dd>
<dt>verified by</dt><dd>offline verifier</dd>
<dt>needs Kionel</dt><dd>no</dd>
</dl></div></div>
</div>
<p class="note">The verifier is licensed under Apache-2.0 and stays free forever, so a record you hold today can still be checked if we raise our price, change direction or disappear.</p>

<h2>Beyond the lab</h2>
<p>The same problem sits on plant floors: operator and engineering stations that must stay off the network, and files that still have to leave. Kionel moves logs, reports and recipes out of an isolated OT zone with a signed record per file — or seals a file so that only the proof leaves. <a href="/ot-air-gapped-file-transfer.html">Kionel for OT and manufacturing</a> · <a href="/iec-62443-file-transfer.html">IEC 62443 and file transfer</a></p>

<h2>Questions labs ask first</h2>
<div class="faq">
<details><summary>Can the file travel on a USB stick?</summary><p>Yes. Seal the file on the sending PC, carry the file and its sealed record on the stick, and the receiving device checks the file against the record and signs the delivery receipt. On that route Kionel does not encrypt the file or control the USB port; the screen-to-camera route encrypts before the first image is shown. <a href="/usb-file-transfer-signed-record.html">How to do it</a>.</p></details>
<details><summary>Does the instrument PC need a camera?</summary><p>No. The receiving phone or tablet shows a one-time 12-character code; you type it on the PC, and the PC sends by screen only. For a PC that always sends to the same device, a receiver card replaces the code. A PC with no usable screen route can print the file as pages of codes, or send over a one-way serial cable.</p></details>
<details><summary>How fast is it?</summary><p>Reading live with a phone's camera: in our phone test, a 117 KB file took 10 to 24 seconds. Filming the screen with the phone's camera app and letting Kionel read the video took about 7 seconds for the same file and suits files of a few megabytes; the sending screen counts down how long to film. <a href="/transfer-speed-calculator.html">The speed calculator</a> gives an estimate for any size. Text and CSV are compressed first and often shrink four to ten times. It is the wrong tool for large raw data.</p></details>
<details><summary>Is anything installed on the instrument PC?</summary><p>No. It runs in the browser, and after the first visit it works with no network at all.</p></details>
<details><summary>Does Kionel see our files?</summary><p>No. File content goes from screen to camera between your two devices. Our server only receives contact messages; if you switch on trusted timestamps, it also passes each receipt's 32-byte fingerprint to DigiCert, never the file.</p></details>
<details><summary>Can an auditor check a record without Kionel?</summary><p>Yes. Records verify offline with a free Apache-2.0 verifier, or in any browser at kionel.com/verify.html, where nothing is uploaded. A printable one-page report is produced for reviewers who do not read JSON.</p></details>
<details><summary>What happens if we clear the browser or change computers?</summary><p>Device keys and receiver cards belong to the browser that made them; create new ones if that data is cleared. Records you already exported stay verifiable.</p></details>
<details><summary>Is Kionel open source?</summary><p>Yes. The code is on GitHub under AGPL-3.0 and the record verifier under Apache-2.0. Organisations that embed Kionel in a closed-source product can buy a commercial licence.</p></details>
<details><summary>Do both devices have to be there at the same time?</summary><p>No. The phone can film the sending screen with its camera app, and Kionel can read the video later — on the same or another phone — once the code used for the transfer is typed in. Without that code the recording cannot be opened.</p></details>
<details><summary>Which computers and browsers does it run on?</summary><p>Chrome or Edge 137 or later, Firefox 130 or later, or Safari 17 or later, on both devices. Windows 10 and 11, macOS, Linux, Android and iOS can run these. Windows 7 and 8.1 cannot, so Kionel does not run there. The app checks this when it opens and says so.</p></details>
<details><summary>Does the sending PC need internet access?</summary><p>No. Download the offline package once on another PC, check its SHA-256, and copy the single file to the isolated PC. It opens in Chrome or Edge 137 or later and never contacts the network or updates itself.</p></details>
<details><summary>Is there a free version?</summary><p>Yes, all of it. Kionel is open source: signed records, reports, the audit chain, the fast recording mode and receiver cards are included, for personal and organisational use. A commercial licence is only for embedding Kionel in a closed-source product.</p></details>
<details><summary>How is it different from free QR file transfer tools?</summary><p>Open-source tools move the file, some faster than Kionel. Kionel adds what a regulated lab needs around the move: encryption tied to the receiving device, a signed dispatch and delivery record bound to the work order, a local audit chain and a printable report. Kionel is open source too.</p></details>
</div>

<h2>Is Lab Bridge right for this workflow?</h2>
<div class="fit">
<div class="yes"><h3>Probably yes</h3><ul>
<li>The air gap has to stay, and the file still has to move.</li>
<li>USB is banned, discouraged, or leaves no record you can show.</li>
<li>An auditor has asked, or will ask, who moved which file.</li>
<li>Files are small: results, certificates, methods, configurations.</li>
</ul></div>
<div class="no"><h3>Probably not</h3><ul>
<li>An approved USB route with its own audit trail already works.</li>
<li>The instrument PC may be connected to the network.</li>
<li>Your data fits in a single printed QR code, which costs nothing.</li>
<li>You need bulk throughput — this is not a data diode.</li>
</ul></div>
</div>

<h2>Open source</h2>
<p>Kionel is free and open source. Every feature is included for personal and organisational use: signed dispatch and delivery records, reports, the local audit chain, the fast recording mode, printed pages (up to 60, also from photos and scans), the one-way serial cable, receiver cards and site policies.</p>
<div class="plans">
<div class="plan featured"><h3>Open source</h3><p class="note">AGPL-3.0. Free for any use that keeps the source open.</p>
<ul><li>All features, files up to 64 MB</li><li>In the browser or as one offline file</li><li>Verifier under Apache-2.0</li><li>Issues and discussion on GitHub</li></ul>
<p><a class="button" href="https://github.com/Apeiron01/kionel">Source on GitHub</a></p></div>
<div class="plan"><h3>Commercial licence</h3><p class="note">For products that embed Kionel without publishing their source.</p>
<ul><li>Use outside the AGPL's obligations</li><li>Integration and support by agreement</li><li>Offered by Lumina Digitale</li></ul>
<p><a class="button secondary" href="/contact.html">Ask about a commercial licence</a></p></div>
</div>

<h2>Before you rely on it, read the limits</h2>
<div class="columns">
<div><p>Kionel does not sanitise file content, does not prove who a person is, and has not had an independent security audit yet. We publish that list ourselves, because the buyer who checks is the buyer worth having.</p>
<div class="actions"><a class="button secondary" href="/limits.html">What Kionel does not do</a><a class="button secondary" href="/security.html">Security model</a></div></div>
<div class="panel"><div class="panel-head"><span>Security status</span><span>2026</span></div><div class="panel-body"><dl>
<dt>Threat model</dt><dd class="ok">published</dd>
<dt>Offline verification</dt><dd class="ok">available</dd>
<dt>Verifier licence</dt><dd class="ok">Apache-2.0</dd>
<dt>File upload to Kionel</dt><dd class="ok">none</dd>
<dt>Trusted timestamps</dt><dd>optional, DigiCert RFC 3161, verified in the browser and offline</dd>
<dt>Device matrix</dt><dd class="warn">not published</dd>
<dt>Protocol model</dt><dd class="ok">machine-checked</dd>
<dt>Independent audit</dt><dd class="warn">not completed</dd>
</dl></div></div>
</div>` },
  { slug: "how-it-works", lang: "en", head: "<script type=\"module\" src=\"/src/storyboard-site.ts\"></script>", title: "How Kionel moves a file with a screen and a camera", description: "The handshake, the two-code comparison, the encrypted optical transfer, the two signed receipts and offline verification, step by step.", body: `
<p class="eyebrow">How it works</p><h1>A screen, a camera, and two signatures.</h1>
<p class="lead">Kionel moves a file between two devices that share no network. The sending device shows it as a stream of codes; the receiving device reads them with its camera. Both sides then sign what happened.</p>

<ol class="steps-flow">
<li><h3>Handshake</h3><p>The receiver shows one code; the sender reads it and replies with another. From those two codes both sides derive the same session key — X25519 key agreement, HKDF, AES-256-GCM. Nothing travels over a network.</p></li>
<li><h3>Compare</h3><p>Each device shows the same six digits and five drawn symbols. The operator checks that the screens agree. This is what stops a screen or camera placed in the middle; skip it and that protection is gone.</p></li>
<li><h3>Transfer</h3><p>The file is encrypted, split into blocks and displayed as rapidly changing codes. A fountain code means a missed frame is not a failed transfer: the receiver keeps reading until it has enough blocks, and a long transfer can be paused and resumed.</p></li>
<li><h3>Sign</h3><p>The sender signs a dispatch record — content hash, work order, classification, target system. The receiver verifies the content against that hash, then signs a delivery record. Ed25519 over a fixed byte layout.</p></li>
<li><h3>Verify</h3><p>An offline verifier checks both signatures and the hash. It is Apache-2.0 licensed and needs no account, no network and no permission from us.</p></li>
</ol>

<h2>When the PC has no camera</h2>
<p>The handshake above needs a camera on both sides. Most instrument PCs have none, so there is a one-way mode. The receiving phone shows a one-time 12-character code (60 bits of randomness); the operator types it on the PC. The PC derives the encryption key from it (PBKDF2, 600,000 rounds) and plays the file on screen; only the phone that showed the code can open it. A camera filming the monitor records ciphertext. The dispatch and delivery records are the same as in the two-way mode.</p>
<p>For a fixed pair of devices, a signed receiver card installed once on the PC replaces the code. The trade-off is written down: the card's key is long-lived, so it does not have the forward secrecy of the two-way mode.</p>

<h2>See it in motion</h2>
<p>The same steps as above, animated. Pick the one that matches your devices.</p>
<h3>Sender without a camera, receiver reads live</h3>
<div data-story="code-live"><ol><li>Receiver: show a code</li><li>Sender: type it, press Send</li><li>Sender: shows the file as codes</li><li>Receiver: reads them live</li><li>Receiver: file and signed receipt</li></ol></div>
<h3>Larger files: the receiver films the screen</h3>
<div data-story="code-record"><ol><li>Receiver: show a code</li><li>Sender: type it, choose Fast</li><li>Sender: counts down while sending</li><li>Receiver: film until “Enough”</li><li>Receiver: Kionel reads the video</li><li>Receiver: file and signed receipt</li></ol></div>
<h3>Film now, read later</h3>
<div data-story="later"><ol><li>Receiver: show a code once</li><li>Sender: type it and send</li><li>Receiver: film with the camera app</li><li>Later: any device</li><li>Open the video, type the code</li><li>File and signed receipt</li></ol></div>
<h3>Proof without the file</h3>
<div data-story="seal"><ol><li>Sender: choose file and work order</li><li>Sender: seal — the file stays</li><li>Sender: one small code</li><li>Receiver: scan it</li><li>Signed proof, no data</li></ol></div>

<h2>Evidence without the optical channel</h2>
<p>The receipts do not depend on how the file travelled. If your file goes by approved USB, a data diode or a courier, the same command-line tool signs the dispatch and the delivery. A dispatch record is a few hundred bytes — small enough for one printed or displayed code — so the content can take one route and the evidence another.</p>

<h2>The approval chain</h2>
<p>A receipt says "this went from A to B". A laboratory usually needs a different sentence: "X produced this result, Y reviewed it, Z released it". Kionel can attach those approvals to the file itself, each link signed over the previous one, so the order is provable and removing a link breaks the chain.</p>

<h2>What it runs on</h2>
<p>A browser on each side, or a single-file command-line tool for the evidence-only workflow. No agent on the instrument PC, no driver, no network change. Keys stay in the browser's non-exportable key store.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/security.html">Security model</a><a class="button secondary" href="/limits.html">Limits</a></div>` },
  { slug: "security", lang: "en", title: "Security model: cryptography, boundaries and current status", description: "Which primitives Kionel uses, what crosses the server boundary, how the evidence is built, and which assurances do not exist yet.", body: `
<p class="eyebrow">Security</p><h1>What protects the handover, and what it rests on.</h1>
<p class="lead">Everything here is what the software actually does today. Where an assurance is missing, it says so on this page rather than in a footnote.</p>

<h2>Where the boundary is</h2>
<p>"No server" is easy to say and easy to abuse, so here is the precise version: <strong>file content never reaches us.</strong> For enterprise deployments, device enrolment and revocation do use our infrastructure. So do trusted timestamps when you switch them on: one receipt fingerprint, never the file, passes through to DigiCert.</p>
<svg viewBox="0 0 560 200" role="img" aria-label="Diagram: file content stays between the two devices; only contact messages reach the Kionel server." class="diagram"><rect x="4" y="30" width="250" height="130" rx="10" fill="#0f2025" stroke="#3d626b"/><text x="24" y="58" fill="#7d979b" font-family="PlexMono, monospace" font-size="11" letter-spacing="1.6">YOUR DEVICES</text><text x="24" y="86" fill="#f1f7f6" font-family="PlexMono, monospace" font-size="12">file content</text><text x="24" y="106" fill="#f1f7f6" font-family="PlexMono, monospace" font-size="12">encryption keys</text><text x="24" y="126" fill="#f1f7f6" font-family="PlexMono, monospace" font-size="12">camera frames</text><text x="24" y="146" fill="#f1f7f6" font-family="PlexMono, monospace" font-size="12">receipts</text><line x1="280" y1="14" x2="280" y2="186" stroke="#f2c66d" stroke-width="1.5" stroke-dasharray="6 6"/><text x="288" y="24" fill="#f2c66d" font-family="PlexMono, monospace" font-size="10" letter-spacing="1.2">BOUNDARY</text><rect x="306" y="30" width="250" height="130" rx="10" fill="#0f2025" stroke="#3d626b"/><text x="326" y="58" fill="#7d979b" font-family="PlexMono, monospace" font-size="11" letter-spacing="1.6">KIONEL SERVER</text><text x="326" y="86" fill="#a9bec0" font-family="PlexMono, monospace" font-size="12">timestamp relay</text><text x="326" y="106" fill="#a9bec0" font-family="PlexMono, monospace" font-size="12">no user accounts</text><text x="326" y="126" fill="#a9bec0" font-family="PlexMono, monospace" font-size="12">contact messages</text><text x="326" y="146" fill="#7d979b" font-family="PlexMono, monospace" font-size="11">no file content, ever</text></svg>

<h2>Cryptography</h2>
<div class="cards">
<section><p class="eyebrow">Session</p><h2>X25519 + HKDF</h2><p>The two devices agree a key through the optical channel itself. Nothing is exchanged over a network, and the key exists only for that transfer.</p></section>
<section><p class="eyebrow">Content</p><h2>AES-256-GCM</h2><p>The file is sealed before the first frame is displayed. A camera pointed at the wrong screen, or a photograph of it, yields ciphertext.</p></section>
<section><p class="eyebrow">Evidence</p><h2>Ed25519 / ES256</h2><p>Dispatch and delivery are signed over a fixed byte layout, so a record cannot be re-interpreted later. The enterprise wire uses P-256 with canonical low-S signatures.</p></section>
</div>
<p>Two codes are derived from the session with separate labels: six digits and five drawn symbols. The operator compares them on both screens. That comparison is what defends against a screen or camera placed in the middle — and it only works if a person actually does it.</p>

<h2>The evidence model</h2>
<ol class="steps-flow">
<li><h3>Dispatch record</h3><p>The sender signs the content hash together with the work order, classification and target system.</p></li>
<li><h3>Delivery receipt</h3><p>The receiver verifies the content against the hash and signs that it arrived intact.</p></li>
<li><h3>Approval chain</h3><p>Optional. Produced, reviewed, released — each link signed over the previous one, so the order is provable and removing a link breaks the chain.</p></li>
<li><h3>Audit ledger</h3><p>Entries are hash-chained locally, so a deleted entry is visible as a gap.</p></li>
<li><h3>Offline verification</h3><p>An Apache-2.0 tool checks all of it without contacting us, with no account and no network.</p></li>
</ol>

<h2>Threat model</h2>
<p>What each attack meets. The last two rows are outside what the software can defend, and the <a href="/limits.html">limits page</a> explains why.</p>
<div class="table-scroll"><table><thead><tr><th>Attack</th><th>What stops it</th></tr></thead><tbody>
<tr><td>A photograph or recording of the sending screen</td><td class="ok">AES-256-GCM: the frames are ciphertext</td></tr>
<tr><td>A screen or camera placed between the two devices</td><td class="ok">The six digits and five symbols differ; the operator stops</td></tr>
<tr><td>Editing a dispatch or delivery record afterwards</td><td class="ok">Ed25519 signature no longer verifies</td></tr>
<tr><td>Swapping the file after delivery</td><td class="ok">Content hash no longer matches the signed record</td></tr>
<tr><td>Deleting an entry from the local audit log</td><td class="ok">The hash chain shows a gap</td></tr>
<tr><td>Operator skips the code comparison</td><td class="warn">Not defended — the protection depends on it</td></tr>
<tr><td>Malware already on either device</td><td class="warn">Not defended — no transfer tool can be</td></tr>
</tbody></table></div>

<h2>Machine-checked protocol models</h2>
<p>The three ways Kionel moves a file are modelled in <a href="https://bblanche.gitlabpages.inria.fr/proverif/">ProVerif</a>, a tool that searches for attacks by an adversary who controls every frame on the optical channel. Each model also runs with one assumption removed, and there the tool must find the attack — otherwise the model would not be measuring anything.</p>
<div class="table-scroll"><table><thead><tr><th>Mode</th><th>File stays secret</th><th>Sender authenticated</th></tr></thead><tbody>
<tr><td>Two-way, codes compared</td><td class="ok">Proved, including after both identity keys leak</td><td class="ok">Proved; receipts verified by an auditor are sound</td></tr>
<tr><td>Two-way, codes <em>not</em> compared</td><td class="warn">Attack found — this is why the comparison is required</td><td class="warn">Attack found</td></tr>
<tr><td>One-way, typed code</td><td class="ok">Proved while the code is unknown</td><td class="ok">Proved</td></tr>
<tr><td>One-way, receiver card installed over a trusted route</td><td class="ok">Proved</td><td class="ok">Proved</td></tr>
<tr><td>One-way card, long-term key leaks later</td><td class="warn">Not secret — no forward secrecy, as documented</td><td class="ok">Proved</td></tr>
</tbody></table></div>
<p>A symbolic model treats the cryptography as ideal and cannot count bits: it does not prove that the implementation is free of bugs, and it is not an audit. Download the models and rerun them: <a href="/formal/kionel-v1.pv">two-way</a>, <a href="/formal/kionel-oneway-code.pv">typed code</a>, <a href="/formal/kionel-oneway-card.pv">receiver card</a>, <a href="/formal/README.md">assumptions and limits</a>.</p>

<h2>Current status — read this before procurement</h2>
<div class="table-scroll"><table><thead><tr><th>Assurance</th><th>Status</th></tr></thead><tbody>
<tr><td>Symbolic protocol verification (ProVerif)</td><td class="ok">Published: 3 models, 6 checks, sanity variants included</td></tr>
<tr><td>Independent security audit of the implementation</td><td class="warn">Not completed</td></tr>
<tr><td>Published device matrix (speed, success rate on real hardware)</td><td class="warn">Not published</td></tr>
<tr><td>Hardware-backed device identity (TPM, StrongBox, App Attest)</td><td>Verifier implemented; production enrolment not shipped</td></tr>
<tr><td>Trusted timestamps (RFC 3161)</td><td>Optional on the receiving device: a DigiCert token attached to the receipt, verified in the browser and by the offline verifier against a pinned root</td></tr>
<tr><td>Formal certification (Common Criteria and similar)</td><td class="warn">None, and none claimed</td></tr>
<tr><td>Vulnerability disclosure channel</td><td class="ok">Published in security.txt</td></tr>
</tbody></table></div>
<p>If a procurement checklist requires a certified product, we are not it yet, and we would rather you learn that here than three meetings in.</p>

<h2>Reporting a vulnerability</h2>
<p>Write to the address published in <a href="/.well-known/security.txt">security.txt</a>. We do not run a bug bounty; we do answer.</p>
<div class="actions"><a class="button" href="/limits.html">What Kionel does not protect</a><a class="button secondary" href="/how-it-works.html">How a transfer works</a></div>` },
  { slug: "changelog", lang: "en", title: "Changelog", description: "What changed in Kionel Lab Bridge, by date: new features, fixes and changes to the licence model.", body: `
<p class="eyebrow">Changelog</p><h1>What changed, and when.</h1>
<p class="lead">Customer-visible changes only.</p>

<h2>October 2026</h2>
<ul>
<li><strong>Kionel is open source.</strong> The code is published on <a href="https://github.com/Apeiron01/kionel">GitHub</a> under AGPL-3.0; the record verifiers stay Apache-2.0. Every feature is now available without a licence file: signed records, reports, the audit chain, the fast recording mode, 60 printed pages and the serial cable. Purchases, licence files and subscriptions have ended; a commercial licence is available for closed-source products. Entries below describe the product as it was at the time.</li>
<li><strong>Files that travel by USB can be signed for.</strong> A file sealed on the sending PC can now be checked and signed for on the receiving device when it arrives another way: on a USB stick, over a share, by hand. Add the sealed record and the file under <em>Receive</em>; if the file matches, the device signs the same delivery receipt as for an optical transfer, and if it differs it signs nothing. The file itself is not encrypted on the way, and the result says so. <a href="/usb-file-transfer-signed-record.html">Keep the USB stick, add the proof</a>.</li>
<li><strong>The receiver can accept only pinned senders.</strong> Until now a receiving device verified the signature on every file and recorded which key signed it, but did not decide who may send. After a delivery it can now pin that sender: from then on a file signed by any other key is refused, with the key named, and nothing is saved. Further senders can be added from the refusal message, and the list can be cleared. There are no certificates; this is key pinning, as in SSH. On a serial link, a transfer that is replayed byte for byte is recognised from the transfer log and not delivered a second time. Thanks to the reader who asked how the sender is authenticated.</li>
<li><strong>NIST SP 1334, control by control.</strong> A new guide goes through NIST's 2025 list of controls for portable storage media in OT and says which a transfer without a medium covers, which stop applying, and which it does not cover: <a href="/nist-sp-1334-usb-ot.html">NIST SP 1334 and moving files without a USB stick</a>.</li>
<li><strong>One-way links: did everything arrive?</strong> A one-way cable or a data diode cannot tell the sending side that a file arrived. The <a href="/verify.html#link">verifier</a> now takes the signed records of both sides and lists every file the sender signed with its verified receipt, or without one. It runs in the browser, offline, and needs no licence to check.</li>
<li><strong>Faster live reading.</strong> The receiving device used to decode one camera picture at a time and skip the pictures that arrived meanwhile. It now decodes several at once, on separate processor cores, so more of the codes the screen shows are actually read. Nothing changes on the sending side. Phone measurements will be added to the <a href="/qr-file-transfer-benchmark.html">measurement page</a> when we have them.</li>
<li><strong>A test anyone can repeat.</strong> <a href="/qr-file-transfer-benchmark.html">How fast is file transfer by QR code?</a> describes a repeatable test, lists what we have measured ourselves, including a failure, and keeps it apart from the figures other projects report for themselves.</li>
<li><strong>Kionel Link, and a USB parts list.</strong> The one-way serial link can be built between two USB ports from two adapters and two wires; the <a href="/serial-data-diode.html">guide</a> lists the parts. 1,500,000 and 3,000,000 baud are offered as experimental speeds, not yet measured on hardware.</li>
<li><strong>Free tool: what is inside a QR code.</strong> Drop a picture of a QR code and see what it would give away: a Wi-Fi password, the secret behind one-time login codes, a link with a token, or data that only looks encrypted. It is read in the browser and nothing is uploaded. The tool does not try to undo any scrambling, and says so when it cannot tell scrambled from encrypted. <a href="/what-is-in-a-qr-code.html">Open the tool</a>.</li>
<li><strong>Delivery receipt by sound.</strong> A sending PC without a camera could not read the delivery receipt back, so the proof stayed on the receiving device. Now the file goes by light and the proof comes back by sound: with a business licence, the receiving device plays the signed receipt as about four seconds of tones, and the PC checks the receiver's signature against the file it sent and shows <em>Delivery verified</em>. Only the signature, its time and the transfer number travel by sound; a recorded or imitated receipt does not match and is refused. <a href="/pair-devices-by-sound.html">How it works</a>.</li>
<li><strong>Pair by sound.</strong> A sending PC with a microphone but no camera no longer needs a typed code: the receiving device plays its pairing offer as about six seconds of tones, the PC hears it and shows a reply code, and both screens show the comparison code as usual. Only the public pairing offer travels by sound; the secret transfer code is never played. The microphone is used on that page only and nothing is recorded. <a href="/pair-devices-by-sound.html">How it works and when it will not</a>.</li>
<li><strong>Colour code: honest about where it works.</strong> Tested on a real phone filming a 24-inch monitor, the colour code read none of 429 images, while the same transfer from a clean screen recording read 94%. The app now says so when you choose it, tells the sender to go full screen, and reports how many images were tried and read. A recording that collected part of the file is no longer reported as "no codes found"; what was collected is kept.</li>
</ul>

<h2>September 2026</h2>
<ul>
<li><strong>Unattended folder link over a serial cable.</strong> With a business licence, a PC can watch a folder and send every new or changed file over a one-way serial cable, encrypted to the receiving computer's card and signed; the receiver keeps listening and writes each file with its receipt into its folder. Files already in the folder are left alone unless you ask. This is the first step towards a software one-way link for OT; priced per link, ask us.</li>
<li><strong>Printed pages in the free edition.</strong> The personal edition prints and reads up to 5 pages of codes (about 19 KB standard, 57 KB dense); a business licence raises this to 60 pages and opens photos and scans of the pages. When a file does not fit, the app says whether Dense would fit it.</li>
<li><strong>Which side am I on?</strong> Sending is teal and receiving is sky blue, on the tab, the section and its buttons, and a bar at the top of the screen says <em>This device is SENDING</em> or <em>RECEIVING</em> while you scroll.</li>
<li><strong>Printed pages: the code can come last, and a wrong code no longer costs a rescan.</strong> In a real test the receiver still held the code of an earlier transfer, collected the whole file, and could only report that the code did not open it. Now choosing <em>Printed pages</em> never reuses an old code; the pages can be scanned first and the code entered when Kionel asks for it; and a wrong code keeps everything read, so entering the right one opens the file at once. The same applies to a screen recording read later: type the right code and it opens without reading the video again. Each page of codes now fits on one sheet of A4 or Letter, with or without the browser's header and footer.</li>
<li><strong>Step-by-step guide on both screens.</strong> Choose how the file leaves the PC (screen, paper or serial cable) and the steps for that route are listed in order; finished steps are ticked, the next one is highlighted, and <em>Show me</em> scrolls to the control it needs. The receiving screen does the same, and has its own choice for printed pages.</li>
<li><strong>Printing fixes from the first real test.</strong> Pages could come out without their codes when the print dialog opened before the images were ready; printing now waits for them. The code for the pages is shown in large letters with a button to hide it, and after the code is entered on the receiver the camera view is brought on screen.</li>
<li><strong>Faster live reading.</strong> After the first code is found, the camera reads only the part of the picture around it, with a full-picture check every ten frames. In our slowed-down test (a phone-speed processor, 200 KB) delivery went from 35 to 27 seconds. We will publish phone measurements when we have them.</li>
<li><strong>Print a file as codes.</strong> A PC with only a printer can now send: the file is printed as pages of encrypted QR codes, and any phone reads them back in any order. About 30% of the codes are spares chosen so that any smudged code can be replaced. With a business licence, photos or scans of the pages can be opened too. The same pages work as a paper backup. The receiver also finishes sooner on every route: when only a few blocks are missing, it now solves them from what it already has instead of waiting for more codes.</li>
<li><strong>Send over a serial cable.</strong> With a business licence, a PC can send to another computer over an RS-232 or USB serial cable instead of the screen. With the return wire left out, nothing can travel back: a low-cost one-way link, up to about 80 KB/s. Same encryption, same signed records; it works from the offline package. See the serial data diode guide for wiring and speeds.</li>
<li><strong>Excel damage check.</strong> A free page that finds what Excel leaves in a CSV: gene names and decimals turned into dates, IDs in scientific notation, digits lost after the 15th, removed leading zeros and garbled characters. With the original file as well, it lists every changed cell and why. The file is read in the browser and never uploaded. English and Turkish.</li>
<li><strong>Honest speed figures.</strong> Pages that said "about 30 KB/s live" now give our measured result instead: a 117 KB file in 10 to 24 seconds live and about 7 seconds from a screen recording, with the speed calculator for other sizes.</li>
<li><strong>File names from the signed record.</strong> When received files are saved to a folder, they can be named from the record instead of the sender's name, for example <code>{workorder}_{name}</code> gives <code>WO-004213_results.csv</code>. Fields: name, work order, classification, operator, date and time. The receipt follows the file's name, and nothing is overwritten.</li>
<li><strong>Operator in the signed record.</strong> The sender can enter who is doing the transfer, a name or an ID. It is signed into the dispatch record with the work order, shown on the receiver and on the verify page, and kept in the transfer log, its CSV and the review report. A site policy can make it mandatory. It is what the person declared, not a login. A record that carries an operator needs Kionel from this version on the receiving side; older versions refuse it rather than show it without the name.</li>
<li><strong>Site policy.</strong> A quality or IT unit can load a small policy file that refuses files outside the allowed types or size, and work orders or classifications that do not match its rules, before anything is sent. The transfer log records which policy applied. See the site policy page for the fields and an example.</li>
<li><strong>Transfer log and periodic review.</strong> With a business licence, every file a device sends, receives or seals is kept in the browser with its signed record. Choose a period to export it as CSV (safe to open in Excel), print a review report with fields for the reviewer's signature, or download the signed records themselves.</li>
<li><strong>Speed calculator, and an honest name.</strong> A calculator on the site uses the app's own formulas. Doing the sums showed the colour code is not faster on paper than the dense QR recording; its strength is how reliably it reads from a phone video, so it is now called Robust instead of Fastest.</li>
<li><strong>A clearer hint when the code is missing.</strong> If the receiving camera sees a Kionel transfer it has no code for, it now says which option to choose instead of waiting silently. The offline package also carries its own fonts, so it looks the same with no connection.</li>
<li><strong>Guides in one place.</strong> All guides are listed on a new Guides page, and English and Turkish versions of the same guide now point to each other.</li>
<li><strong>Colour code in the offline package.</strong> The colour code now works in the offline package too, from a PC that never goes online. libcimbar's files are embedded unchanged; the package still makes no outside connection.</li>
<li><strong>Reading a recording survives switching tabs.</strong> Browsers stop handing video frames to a page in the background, while the video keeps playing; a reading at 99% failed that way when the user switched tabs. Reading now pauses while the page is in the background and continues when you return. A recording opened without the transfer's code now says the code is missing, instead of that no codes were found.</li>
<li><strong>Clearer help when a recording cannot be read.</strong> Messaging apps shrink videos (one test video arrived at 478×850); dense codes cannot be read at that size. Kionel now says so as soon as such a video is opened and suggests copying the original. When only a few codes are read, it no longer suggests filming for minutes longer, since the picture, not the length, is the problem. The stopwatch now also stops when a recording ends without a delivery.</li>
<li><strong>Fixed: our host added an analytics script.</strong> Cloudflare's free plan inserts its own analytics script into HTML pages at the edge, without it being in our code. On our pages the site's security policy stopped it from running, but it was also inserted into offline packages downloaded with a browser, which is why their SHA-256 did not match. Every response is now marked so it cannot be changed on the way, and the offline package carries its own security policy that blocks any outside script or connection. If you downloaded version 1.0.3 in a browser before this fix, check its SHA-256 and download it again.</li>
<li><strong>Several files at once.</strong> Select several files together and they travel as one ZIP, with MANIFEST-SHA256.txt inside listing each file's SHA-256; the signed records cover the whole ZIP, so the list is signed too. It opens with any unzip tool, and <code>sha256sum -c</code> checks the files.</li>
<li><strong>Validation pack.</strong> A printable IQ/OQ protocol for the offline package: scope and SHA-256, requirements with traceability, test scripts with blanks for results and signatures. The offline package also works as a receiving computer with a webcam, so both sides of a validated setup can run the same fixed version.</li>
<li><strong>Trusted timestamps.</strong> On the receiving device, each receipt can carry an RFC 3161 timestamp from DigiCert. Only the receipt's fingerprint is sent; the token is verified in the browser, on the verify page and by the offline verifier.</li>
<li><strong>Save straight to a folder.</strong> On a receiving computer with Chrome or Edge, received files and their signed receipts are written into a folder you choose, such as one your LIMS imports from. Nothing is ever overwritten.</li>
<li><strong>Colour code reading fixed.</strong> Camera frames were sometimes handed to the decoder before they had been copied, so they arrived empty; this hit phones hardest and made colour codes read on some attempts and not on others. Live reading of colour codes remains experimental.</li>
<li><strong>Start over, and a stopwatch.</strong> While sending for a recording, <em>Start over</em> restarts the countdown for a receiver who missed the start. Both sides show elapsed time; the receiver's stops at delivery and is repeated in the message.</li>
<li><strong>Offline package.</strong> Kionel as one HTML file for PCs that never go online: checked by its SHA-256, opened in the browser, never updates itself. Each version keeps its own file.</li>
<li><strong>SHA-256 checker.</strong> A free page that gives a file's SHA-256 in the browser without uploading it, with the equivalent command for each system.</li>
<li><strong>Clear message on old browsers.</strong> Kionel needs Chrome or Edge 137 or later, Firefox 130 or later, or Safari 17 or later. On an older browser it now says so when it opens, instead of failing when you press Send.</li>
<li><strong>Seal on paper.</strong> A sealed record can be printed together with its code. The code on paper can be scanned later with any device running Kionel, so the proof leaves the offline PC without a second device being there at that moment. The file itself is never in the code.</li>
<li><strong>Film now, read later.</strong> The two devices do not have to work at the same moment: film the sending screen with the receiving device's camera app, then open the video hours later — on the same or another device — and type the code. Checked end to end, including a wrong code being refused.</li>
<li><strong>Animated guides.</strong> Each way of sending, receiving, sealing and moving the licence is shown as a short animation of its steps, in the app and on the How it works page.</li>
<li><strong>Colour code.</strong> A third sending option, "Fastest — colour code", carries the same encrypted envelope in libcimbar colour barcodes (MPL-2.0). In our browser test almost every recorded image was readable (98–99.5%), against about half for dense QR codes; the receiver recognises the colour code by itself and decodes on several threads, so a recording is read as fast as it plays.</li>
<li><strong>Flashing-image warning.</strong> Sending shows rapidly changing images; a warning about photosensitive epilepsy now appears before a transfer starts.</li>
<li><strong>Full screen</strong> on the sending device, for larger, easier-to-read codes.</li>
<li><strong>Read from a screen recording.</strong> The phone records the sending screen with its own camera app; Kionel reads the recording at its own pace. In a browser test with ideal recordings a 1 MB file needed 16 seconds at 60 codes a second; on real phones, which usually record at 30 fps, the default is now 20 codes a second and the sending screen counts down how long to film. A recording that ends early is not wasted: the next one continues from there. Two presets on the sender — "Phone reads live" and "Phone records the screen" — set the code density and frame rate.</li>
<li><strong>Honest progress bar.</strong> Progress now counts the codes received, not only the blocks already solved, so it no longer sits near zero until the last moment.</li>
<li><strong>Machine-checked protocol models.</strong> The two-way, typed-code and receiver-card modes are modelled in ProVerif; results, assumptions and the models themselves are on the <a href="/security.html">security page</a>.</li>
<li><strong>PC without a camera: send with a typed code.</strong> The receiving phone shows a one-time code; the PC sends by screen only. Receiver cards remain for fixed device pairs, and a phone can retire its card key.</li>
<li><strong>Compression.</strong> Files are compressed before encryption when it helps; CSV and text shrink four to ten times. One-way transfers no longer carry base64 overhead.</li>
<li><strong>Printable report.</strong> Every dispatch record and receipt can be printed or saved as PDF, re-verified at print time.</li>
<li><strong>Browser verifier.</strong> <a href="/verify.html">kionel.com/verify.html</a> checks a receipt or dispatch record, and optionally the file, without uploading anything.</li>
<li><strong>Clearer messages.</strong> Success, warnings and errors appear at the top of the screen; loaded files show as loaded; the time a file will take is shown before sending.</li>
<li><strong>Camera on/off</strong> on the receiving device at any time.</li>
<li><strong>Fix:</strong> files above roughly 100 KB failed in one-way mode ("Maximum call stack size exceeded").</li>
<li><strong>Fix:</strong> a failing offline cache could stop pages from opening; the cache can no longer block a page.</li>
<li><strong>One-way transfer.</strong> A sender without a camera, such as a desktop instrument PC, can now send; the receiver no longer has to show a code back.</li>
<li><strong>Works offline after the first visit.</strong> The transfer app is cached on the device and runs with no network at all.</li>
<li><strong>Clearer start.</strong> The app explains that two devices are needed and shows a code to open the page on the second one, instead of an empty camera frame.</li>
<li><strong>Licence warnings.</strong> The licence line turns amber 30 days before expiry and during the 14-day grace period, and states the days left.</li>
<li><strong>Clock rollback resistance.</strong> Setting the device clock back to stretch a licence is detected and shown on screen.</li>
<li><strong>Annual subscription.</strong> Each renewal delivers a new signed licence file, downloaded with your licence key.</li>
<li><strong>Command-line tools</strong> for signing dispatch and delivery when the file travels by another route.</li>
</ul>

<h2>August 2026</h2>
<ul>
<li><strong>Enterprise protocol (v2).</strong> P-256 signatures with canonical low-S form, enrolment trust bundles and a control plane contract.</li>
<li><strong>Hardware-backed keys.</strong> Windows TPM key bridge and Android attestation verification; production enrolment is not yet shipped.</li>
<li><strong>Device qualification.</strong> A signed matrix of how a sender and receiver pair actually performed.</li>
</ul>
<div class="actions"><a class="button secondary" href="/security.html">Security model</a><a class="button secondary" href="/limits.html">Limits</a></div>` },
  { slug: "limits", lang: "en", title: "What Kionel does not protect against", description: "The honest limits: compromised endpoints, skipped code comparison, file content, identity, timestamps, and the assurances that do not exist yet.", body: `
<p class="eyebrow">Limits</p><h1>What Kionel does not do.</h1>
<p class="lead">Security tools are chosen by people who have to defend the choice. Read this before buying rather than after; it is the same list our internal threat model carries.</p>

<div class="columns">
<div><h3>Kionel protects</h3><ul class="status-list protects">
<li data-mark="+">File content in transit, sealed before the first frame is shown</li>
<li data-mark="+">Integrity: a delivered file that differs from the dispatched hash is rejected</li>
<li data-mark="+">Who signed: dispatch and delivery, by two separate keys</li>
<li data-mark="+">Order of approvals, chained so a removed link is visible</li>
<li data-mark="+">Independent verification, offline, without us</li>
</ul></div>
<div><h3>Kionel does not protect</h3><ul class="status-list protects-not">
<li data-mark="!">A compromised endpoint: malware or a screen recorder defeats everything above</li>
<li data-mark="!">An operator who skips the code comparison</li>
<li data-mark="!">Malicious file content — optical transfer does not scan or sanitise</li>
<li data-mark="!">Who a person is: a receipt proves keys signed, not people</li>
<li data-mark="!">That a file was read, understood or acted on</li>
<li data-mark="!">Coercion: a forced approval looks like an approval</li>
<li data-mark="!">Traffic analysis: an observer sees that a transfer happened</li>
<li data-mark="!">Screen emanation (TEMPEST): no claim is made</li>
<li data-mark="!">Old systems: it needs Chrome or Edge 137 or later, Firefox 130 or later, or Safari 17 or later, so it does not run on Windows 7 or 8.1</li>
</ul></div>
</div>

<h2>Limits of individual features</h2>
<ul>
<li><strong>Offline package.</strong> It sends and, on a computer with a webcam, receives; phones use kionel.com. Trusted timestamps are only in the website version, because the package contacts no service. It needs Chrome or Edge 137 or later. It never updates itself: a newer version has to be downloaded, checked and copied like the first one. A licence loaded into it lives in that browser's storage on that PC, like on the website.</li>
<li><strong>Stopwatch.</strong> It uses the device's own clock, starts at the first code received and stops at delivery. It is a practical measurement, not a certified one, and it is not part of the signed records.</li>
<li><strong>Seal printed on paper.</strong> The code on the paper carries the signed record, not the file, but it is not encrypted: anyone who scans it can read the file name, size, SHA-256 and the work-order fields. Treat the paper like the record itself.</li>
<li><strong>Colour code from a phone camera.</strong> The colour code is made for a clean recording in which the code fills the picture. A phone filming a monitor from arm's length often reads nothing, because video compression blurs the small colour cells; in our own test it read none of 429 images. Use "Fast — recording" there.</li>
<li><strong>Files carried on a USB stick.</strong> Kionel shows that the file that arrived is the file that was sealed, and both devices sign for it. It does not encrypt the file on the stick, does not control the USB port, and does not scan the stick; a file can still be copied without being sealed. Where the reason for avoiding USB is malware or confidentiality in transit, use the optical route or a one-way cable.</li>
<li><strong>Pinned senders.</strong> Pinning says which key may send, not which person or which machine: a key copied from a compromised sending PC is accepted like the original. There are no certificates and no revocation service; to stop accepting a sender, clear the list and pin again. The list lives in this browser's storage and goes if the browser's data is cleared, after which any sender is accepted again until one is pinned. The check for a repeated transfer applies to serial links, because it uses the transfer log; recordings and printed pages can be read again on purpose.</li>
<li><strong>Pairing by sound.</strong> The sending PC needs a working microphone and a clock within two minutes of the receiver's. The sound is audible and can be heard, recorded or imitated by anyone nearby; it carries nothing secret, and an imitated offer shows up as different comparison codes, so the comparison must not be skipped. A PC paired this way has no camera, so it cannot scan the delivery receipt; the receipt comes back as about four seconds of sound and the PC checks its signature against the file it sent. If that sound is not heard, the delivery itself is unaffected and the signed receipt can still be exported on the receiving device.</li>
<li><strong>Colour code read live.</strong> Experimental and slower than filming the screen; recording remains the recommended way to read colour codes.</li>
<li><strong>Saving to a folder.</strong> Chrome or Edge on a computer only; phones and other browsers download instead. After the browser restarts it asks once for permission again, and until then files are only offered for download. It writes files; it does not talk to your LIMS, which has to import from that folder itself.</li>
<li><strong>Trusted timestamps.</strong> They need internet on the receiving device. DigiCert's public service makes no availability promise: if it does not answer, the receipt is issued without a timestamp and the app says so. A timestamp proves when the receipt existed, not when the file was created on the instrument.</li>
<li><strong>SHA-256 checker.</strong> Reads the whole file into the browser's memory, so it stops at 1 GB; larger files need the command for your system.</li>
<li><strong>Printed pages.</strong> Up to 60 pages. Printer and paper quality matter: a faded or creased page may need a rescan, and the dense setting needs a sharp laser print. The pages are only as confidential as their code; printing the code on them makes them readable to anyone who holds them.</li>
<li><strong>Watching a folder.</strong> Chrome or Edge on a computer, with a receiver card. The folder is checked every three seconds, and a file is sent once it has not changed for two seconds. Nothing comes back over a one-way cable, so a file sent while the receiver was off or not listening is not resent by itself; the sender's transfer log shows what went, and starting again with the existing files included fills the gap.</li>
<li><strong>Serial cable.</strong> Chrome or Edge on a computer. It is one-way by wiring, not by certification; a USB serial adapter is a USB device where USB is locked, so use a built-in COM port or have the adapter allowed. The sender gets no confirmation back and offers to send more.</li>
<li><strong>Operator field.</strong> The name is what the person at the sending PC typed. The signature proves it was written with the transfer and not changed afterwards; it does not prove who typed it. Where that matters, pair it with the PC's own login records.</li>
</ul>

<h2>Where time comes from</h2>
<p>Without a trusted timestamp, the time in a receipt is the device clock, and two parties who agree could backdate it. Switch on <em>Add a trusted timestamp</em> on the receiving device and each receipt carries an RFC 3161 token from DigiCert: an independent authority's signature that the receipt, with both device signatures, existed at that moment. The token is checked in the browser and by the offline verifier against DigiCert Trusted Root G4, pinned by its fingerprint; a receipt without one says plainly that the time came from a device.</p>

<h2>What is still unproven</h2>
<ul>
<li><strong>No independent security audit yet.</strong> We will not use the word "audited" until someone outside has done it.</li>
<li><strong>No published device matrix yet.</strong> Speed and success rates on real phones, screens and lighting are unmeasured, so we promise no throughput figure.</li>
<li><strong>Qualification is not validation.</strong> A signed qualification report does not replace your IQ/OQ/PQ, supplier audit or change control.</li>
<li><strong>Accessibility.</strong> Aligning a camera and comparing codes are visual acts. The codes can be read aloud by a screen reader; audible and haptic alignment feedback is not built yet.</li>
</ul>

<h2>When you do not need us</h2>
<div class="fit">
<div class="yes"><h3>Kionel fits</h3><ul>
<li>The air gap has to stay and the file still has to move.</li>
<li>USB is banned or leaves no record you can show an auditor.</li>
<li>Small files: results, certificates, methods, configurations.</li>
</ul></div>
<div class="no"><h3>Use something else</h3><ul>
<li>A printed QR code already carries your data (up to about 3 KB) and costs nothing.</li>
<li>The instrument PC may be networked, or an approved USB route with its own audit trail exists.</li>
<li>You need bulk throughput — a data diode moves gigabits; we move kilobytes.</li>
<li>Your site bans cameras outright.</li>
</ul></div>
</div>

<h2>What "no server" means precisely</h2>
<p>File content never reaches a server: the transfer happens between your two devices. The enterprise services for device enrolment and revocation, and trusted timestamps if you switch them on (one receipt fingerprint, never the file) do use our infrastructure. Both sentences are true and we say them together. The <a href="/security.html">security model</a> shows exactly where the boundary sits.</p>
<div class="actions"><a class="button" href="https://github.com/Apeiron01/kionel">Source code on GitHub</a><a class="button secondary" href="/transfer.html">Start free</a></div>` },
  { slug: "air-gapped-instrument-data-transfer", lang: "en", guide: true, title: "Moving data off a standalone instrument PC without a USB stick", description: "Options for getting result files off an offline laboratory workstation — approved USB, data diode, scanning kiosk, printing and optical transfer — and what an auditor asks about each.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>Getting result files off a standalone instrument PC</h1>
<p>Many laboratory instruments run on a workstation that is deliberately kept off the network: an old operating system, a validated configuration nobody wants to touch, or a site policy that forbids the connection. The data still has to leave. In practice it leaves on a USB stick — the industry even has a name for it, "sneakerware" — and the recurring finding is not speed but that the transfer leaves no reliable audit trail.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Kionel sells one of the options below; the comparison is meant to be usable even if you choose another.</p>
<h2>The options</h2>
<div class="table-scroll"><table><thead><tr><th>Route</th><th>Good for</th><th>What an auditor asks</th></tr></thead><tbody>
<tr><td><strong>Approved, controlled USB</strong></td><td>Any size, already familiar</td><td>Who took it, what was on it, was it scanned, where is the record?</td></tr>
<tr><td><strong>Data diode</strong></td><td>Continuous one-way flow between two networks</td><td>Was the receiving side verified? Cost and installation are high for occasional files.</td></tr>
<tr><td><strong>Scanning kiosk</strong></td><td>Sites that must keep removable media</td><td>The media is still there, just scanned. Who approved this transfer?</td></tr>
<tr><td><strong>Printing and re-keying</strong></td><td>A handful of values</td><td>Transcription errors; a second person must check. Not viable for files.</td></tr>
<tr><td><strong>Optical transfer (screen to camera)</strong></td><td>Small files, no media, no network</td><td>Does the site allow cameras? Is there a record of the handover?</td></tr>
</tbody></table></div>
<h2>The question behind all of them</h2>
<p>Regulated laboratories are expected to keep an audit trail for data and for second-person review. Standalone instrument workstations are singled out in inspections precisely because they often lack one: shared accounts, manual copies and no record of who moved which file where.</p>
<p>So the choice is less "which cable" and more: <em>after the file has moved, what can you show?</em> A route that produces a record you can hand to an inspector is worth more than a faster route that produces none.</p>
<h2>Where Kionel fits</h2>
<p>Kionel is the optical route with the record attached: the file is encrypted, carried on screen and read by a camera, and both sides sign what was sent and what was received. The receipt verifies offline, years later, with a tool that stays free under Apache-2.0. It suits small files — results, certificates, methods, configurations — and it is the wrong tool for bulk data.</p>
<p>It does not sanitise file content, and it needs a site that permits cameras. If your site bans cameras or an approved USB route with its own audit trail already works, use that instead.</p>
<h2>Try it on your own bench</h2>
<p>Kionel is free and open source (AGPL-3.0): it moves files up to 64 MB between two of your devices, end to end, with signed records and reports. Nothing is uploaded.</p>
<p><a class="button" href="/index.html">Start free</a> <a class="text-link" href="/limits.html">What Kionel does not protect →</a></p><p>If the file has to stay on a USB stick, the same two signed records can be made around it: <a href="/usb-file-transfer-signed-record.html">keep the USB stick, add the proof</a>.</p>
` },
  { slug: "open-source-qr-file-transfer-vs-kionel", lang: "en", guide: true, title: "Open-source QR file transfer tools compared with Kionel", description: "Free screen-to-camera file transfer tools exist, and some are faster than Kionel. What they do, what a regulated lab still needs around the transfer, and when to use which.", body: `
<p class="eyebrow">GUIDE · UPDATED SEPTEMBER 2026</p><h1>Free QR file transfer tools, and when a lab needs more</h1>
<p>Moving a file from a screen to a camera is not new, and it is not ours. Several open-source projects do it well, and some move bytes faster than Kionel. If all you need is the file, use one of them. This page says what they do, and what a regulated laboratory usually needs on top.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Facts about other projects are taken from their public documentation in September 2026 and may have changed since.</p>
<h2>What the free tools do well</h2>
<ul>
<li><strong>libcimbar</strong> uses colour barcodes instead of QR and reports about 850 kbit/s (roughly 100 KB/s) from a monitor to a phone — faster than any QR-based tool, Kionel included.</li>
<li><strong>sendmecongo</strong> records the screen with the phone's own camera app and rebuilds the file afterwards; it reports around 100 KB/s with a phone on a stand. Its roadmap lists encryption and an audit log as future work.</li>
<li><strong>LumenLink</strong>, <strong>QRShare</strong> and similar projects stream fountain-coded QR codes; on an ordinary phone, rates of tens of kilobytes a second are reported. In our own phone test, Kionel read a 117 KB file live in 10 to 24 seconds. Kionel also reads screen recordings, the approach sendmecongo uses.</li>
</ul>
<h2>What a regulated lab needs around the transfer</h2>
<div class="table-scroll"><table><thead><tr><th></th><th>Typical open-source tool</th><th>Kionel</th></tr></thead><tbody>
<tr><td><strong>Speed</strong></td><td class="ok">From ~30 KB/s up to ~100 KB/s</td><td>117 KB in 10–24 s live and about 7 s from a screen recording in our phone test; text compressed 4–10×</td></tr>
<tr><td><strong>Encryption</strong></td><td class="warn">Usually none: a photo of the screen is the file</td><td class="ok">AES-256-GCM, key tied to the receiving device</td></tr>
<tr><td><strong>Knowing which device received it</strong></td><td class="warn">No</td><td class="ok">Code comparison or one-time code; device keys</td></tr>
<tr><td><strong>Record of the transfer</strong></td><td class="warn">None</td><td class="ok">Signed dispatch and delivery records with the work order</td></tr>
<tr><td><strong>Audit chain and printable report</strong></td><td class="warn">None</td><td class="ok">Local hash chain; one-page report</td></tr>
<tr><td><strong>Independent verification</strong></td><td>—</td><td class="ok">Free Apache-2.0 verifier and in-browser check</td></tr>
<tr><td><strong>Licence and support</strong></td><td>Varies by project; community support</td><td>AGPL-3.0; commercial licence and support on request</td></tr>
<tr><td><strong>Independent security audit</strong></td><td>Not that we know of</td><td class="warn">Not yet — see the <a href="/security.html">security page</a></td></tr>
</tbody></table></div>
<h2>Which to use</h2>
<ul>
<li><strong>Personal or one-off transfer, nothing to prove afterwards:</strong> a free tool. libcimbar if speed matters most.</li>
<li><strong>Large files:</strong> none of these — use a controlled network route or a data diode.</li>
<li><strong>Regulated work where someone will later ask what moved, to where, for which order:</strong> this is the case Kionel is built for. The transfer is the easy part; the record is the product.</li>
</ul>
<h2>Try it on your own bench</h2>
<p>Kionel is free and open source and produces both signed records. <a href="/verify.html">Verify</a> them afterwards in any browser.</p>
<p><a class="button" href="/transfer.html">Start free</a> <a class="text-link" href="/limits.html">What Kionel does not protect</a></p>` },
  { slug: "ot-air-gapped-file-transfer", lang: "en", guide: true, title: "Getting logs, recipes and reports out of an isolated plant network", description: "How to move small files off an air-gapped OT workstation or HMI host without USB sticks, with integrity checks and a signed record of every transfer — and where optical transfer does not fit.", body: `
<p class="eyebrow">OT AND MANUFACTURING</p><h1>Out of the plant network, without a USB stick</h1>
<p class="lead">Operator stations, engineering workstations and historian clients are kept off the corporate network for good reasons. Their logs, batch reports, alarm exports and recipes still have to leave — and in many plants they leave on a USB stick, the route most security programmes are trying to close.</p>
<p>Written by Taha Bayar, who builds Kionel. Kionel is one of the options below; the comparison is meant to be usable even if you choose another.</p>
<h2>What Kionel does on the plant floor</h2>
<ul>
<li><strong>No media, no network, no agent.</strong> The station shows the file as a stream of codes in a browser; a phone or tablet films it. Nothing is plugged in and nothing is installed on the station.</li>
<li><strong>Integrity you can show.</strong> The file is encrypted to the receiving device, its SHA-256 is signed by the sending station together with the work order or change ticket, and the receiver signs that it arrived intact.</li>
<li><strong>A record per transfer.</strong> Dispatch and delivery records, a printable report, and a local hash-chained log make each movement auditable.</li>
<li><strong>Proof without the file.</strong> Where the data must not leave at all, the station can seal a file — hash, size, time, ticket — and only the small signed seal goes out.</li>
</ul>
<h2>Unattended: a folder that sends itself</h2>
<p>For logs and reports that appear all day, nobody should have to stand at the station. The station watches a folder and sends every new or changed file over a <a href="/serial-data-diode.html">one-way serial cable</a>: encrypted to the receiving computer's card, signed with the change ticket, and written with its receipt into a folder on the other side, where a historian or SIEM can pick it up. With the return wire left out, nothing can reach the station.</p>
<p>It is a file link, not a network bridge: files, not protocols; up to about 80 KB/s; and because nothing comes back, a file sent while the receiver was off is not resent on its own. The sending station's log lists what was sent, and starting again with <em>Also send the files that are already in the folder</em> fills a gap.</p>
<h2>Direction matters — read this first</h2>
<div class="table-scroll"><table><thead><tr><th>Direction</th><th>Fit</th><th>Why</th></tr></thead><tbody>
<tr><td><strong>Out of the plant</strong> (logs, reports, recipes, alarm exports)</td><td class="ok">Good</td><td>The station only needs a screen; the phone outside does the reading.</td></tr>
<tr><td><strong>Into the plant</strong> (patches, firmware, new recipes)</td><td class="warn">With a camera on the target, or a serial cable turned round</td><td>By screen, the receiving machine must see the sending screen, and most HMIs have no camera. A one-way serial cable wired the other way carries files in with nothing able to come out.</td></tr>
<tr><td><strong>A steady flow</strong> (logs, alarm exports, reports all day)</td><td class="ok">Good, over a serial cable</td><td>The station watches a folder and sends each new file unattended; the receiver saves each one with its receipt.</td></tr>
<tr><td><strong>Large files</strong> (historian archives, full backups, images)</td><td class="warn">Wrong tool</td><td>Tens of kilobytes per second by screen, up to about 80 KB/s by cable. Use a data diode or a controlled network conduit.</td></tr>
</tbody></table></div>
<h2>Compared with the usual routes</h2>
<div class="table-scroll"><table><thead><tr><th></th><th>Controlled USB + kiosk</th><th>Data diode</th><th>Kionel</th></tr></thead><tbody>
<tr><td>Physical media in the zone</td><td class="warn">Yes</td><td class="ok">No</td><td class="ok">No</td></tr>
<tr><td>Installation</td><td>Kiosk, procedure</td><td>Hardware, network change</td><td>A browser</td></tr>
<tr><td>Signed record per file</td><td>Depends on logs</td><td>Depends on software around it</td><td class="ok">Built in</td></tr>
<tr><td>Throughput</td><td>High</td><td>High</td><td class="warn">Small files</td></tr>
<tr><td>Continuous one-way flow</td><td class="warn">No</td><td class="ok">Yes, any protocol it supports</td><td class="ok">Files, over a serial cable</td></tr>
<tr><td>Typical cost</td><td>Kiosk in the tens of thousands of dollars</td><td>From thousands to well over $100,000 per link, plus installation</td><td>Annual licence per site; continuous links priced per link, <a href="/contact.html">ask us</a></td></tr>
</tbody></table></div>
<p>Kionel has not had an independent security audit yet; its protocols are modelled and machine-checked, with results on the <a href="/security.html">security page</a>. It does not inspect file content for malware.</p>
<h2>Try it on one station</h2>
<p>Kionel is free and open source, so you can see it work on a real station, signed records included, before anyone commits to anything.</p>
<p><a class="button" href="/transfer.html">Open the app</a> <a class="text-link" href="/iec-62443-file-transfer.html">IEC 62443 and file transfer</a></p>` },
  { slug: "nist-sp-1334-usb-ot", lang: "en", guide: true, title: "NIST SP 1334 and moving files in OT without a USB stick", description: "NIST SP 1334 lists the controls for portable storage media in OT: logs, hash checks, encryption, scanning, disabled ports. Which of them a screen-to-camera or one-way cable transfer covers, which stop applying because there is no medium, and which it does not cover at all.", body: `
<p class="eyebrow">GUIDE · OT AND MANUFACTURING</p><h1>NIST SP 1334 and moving files without a USB stick</h1>
<p class="lead">In September 2025 NIST published SP 1334, a two-page guide on reducing the risks of portable storage media in OT. It accepts that USB sticks are still how firmware goes in and logs come out, and lists the controls that should surround them. This page goes through that list and says, control by control, what changes when the file crosses by screen and camera or by a one-way cable instead of on a stick.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Quotations are from NIST SP 1334 (<a href="https://doi.org/10.6028/NIST.SP.1334" rel="noopener">doi.org/10.6028/NIST.SP.1334</a>). Kionel is not mentioned in it, and nothing here is a statement by NIST.</p>
<h2>The controls, one by one</h2>
<div class="table-scroll"><table><thead><tr><th>NIST SP 1334 asks for</th><th>With a transfer by Kionel</th></tr></thead><tbody>
<tr><td>"Enabling logs for traceability (e.g., system and user identity, device serial number, date and time)"</td><td class="ok">Each transfer leaves a dispatch record signed by the sending device and a receipt signed by the receiving device: file hash, size, work order, declared operator, time. Both sides keep a transfer log that can be exported. There is no device serial number because there is no device.</td></tr>
<tr><td>"Hash or checksum verification should be performed when transporting files"</td><td class="ok">Done on every transfer without anyone having to remember it: the receiver accepts the file only if its SHA-256 equals the one the sender signed.</td></tr>
<tr><td>"Encrypting the data stored on portable storage media using a FIPS-certified algorithm"</td><td class="warn">The file is encrypted with AES-256-GCM before the first code is shown, and nothing is stored on a medium. AES-GCM is a FIPS-approved algorithm; the implementation is the browser's, and Kionel has no FIPS validation of its own.</td></tr>
<tr><td>"Disabling unnecessary ports"</td><td class="ok">Screen-to-camera transfer needs no port on the OT machine, so USB ports can stay disabled or sealed. The one-way cable needs one serial port.</td></tr>
<tr><td>"Prohibiting media usage unless expressly authorized. Authorization should be limited to specific personnel and purposes"</td><td class="warn">A site policy can refuse file types, sizes and transfers without a work order or operator; a receiver card fixes which device may receive, and the receiver can pin which sender keys it accepts. It does not identify a person: the operator is declared, not authenticated.</td></tr>
<tr><td>"Scanning of media before and after use"</td><td class="warn">Not covered. Kionel does not inspect file content. A file arriving in OT should be scanned on an approved machine before it is sent, as it would be before being copied to a stick.</td></tr>
<tr><td>"Restricting devices or file execution through allowlisting solutions"</td><td class="warn">Not covered. That is a control on the OT machine itself.</td></tr>
<tr><td>"Detection of removable media activity by configuring alerts on insertion and data transfer"</td><td class="warn">No alerts. The transfer log records every file; nothing is pushed to a monitoring system.</td></tr>
<tr><td>Purchasing, labelling, storing, write-protecting, reformatting and sanitizing media</td><td>No longer applies to these transfers: there is no medium to buy, label, lock away or wipe. It still applies to every stick that remains in use.</td></tr>
</tbody></table></div>
<h2>What a stick cannot do, and what this cannot do</h2>
<p>A USB stick is a computer's storage, plugged into another computer. It can carry more than the file, it can be reprogrammed, and it remembers what it carried last time. A picture on a screen and a cable with one wire carry the bytes that were sent and nothing else, and they carry them one way.</p>
<p>The other side of that is speed and reach. A screen moves kilobytes a second, so this is for logs, recipes, reports and small updates, not disk images; the <a href="/serial-data-diode.html">one-way serial cable</a> is faster and still not a network. Where cameras are forbidden, the screen route is not available. And the two documents SP 1334 points to for the detail, NIST SP 800-82 and SP 800-53, ask for far more than a file transfer tool can supply.</p>
<h2>After a one-way transfer: did it arrive?</h2>
<p>SP 1334 asks for logs. On a one-way route the sending side cannot be told that a file arrived, so two logs exist and somebody has to compare them. Kionel's records are signed on both sides, and the <a href="/verify.html#link">verifier</a> compares them: every file the sender signed, with the receiver's verified receipt or without one.</p>
<p>Related: <a href="/iec-62443-file-transfer.html">IEC 62443 and file transfer</a>, <a href="/ot-air-gapped-file-transfer.html">file transfer for OT</a>, and <a href="/limits.html">what Kionel does not protect against</a>.</p>
<div class="actions"><a class="button" href="/transfer.html">Try it free</a><a class="button secondary" href="/pilot.html">Open source and commercial licence</a></div>` },
  { slug: "iec-62443-file-transfer", lang: "en", guide: true, title: "IEC 62443 and moving files across the air gap", description: "Which IEC 62443-3-3 system requirements a file transfer into or out of an isolated OT zone touches — portable media, integrity, audit, confidentiality — and what evidence answers them.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>IEC 62443 and the file that crosses the air gap</h1>
<p class="lead">An air gap is a conduit with no cable. IEC 62443 still expects it to be controlled: who may move data across, how its integrity is checked, and what is recorded. The weakest point is usually the moment a file changes zones.</p>
<p>Written by Taha Bayar, who builds Kionel. Kionel is one of the options below; the comparison is meant to be usable even if you choose another.</p>
<p><em>This is not compliance advice. Map the requirements to your own security level targets with your integrator or assessor.</em></p>
<h2>The requirements a transfer touches (IEC 62443-3-3)</h2>
<div class="table-scroll"><table><thead><tr><th>Requirement</th><th>What it asks, in plain terms</th><th>What answers it for a file transfer</th></tr></thead><tbody>
<tr><td><strong>SR 2.3</strong> Use control for portable and mobile devices</td><td>Portable devices and media are restricted and controlled.</td><td>Removing USB media from the route; a controlled, named receiving device.</td></tr>
<tr><td><strong>SR 3.4</strong> Software and information integrity</td><td>Unauthorised changes to software and information can be detected.</td><td>A SHA-256 taken on the source and checked on arrival, bound to a signature.</td></tr>
<tr><td><strong>SR 3.1</strong> Communication integrity</td><td>Transmitted information is protected against modification.</td><td>Authenticated encryption end to end, so a modified transfer fails.</td></tr>
<tr><td><strong>SR 4.1</strong> Information confidentiality</td><td>Information in transit is protected where required.</td><td>Encryption to the receiving device; an image of the screen is ciphertext.</td></tr>
<tr><td><strong>SR 2.8</strong> Auditable events</td><td>Security-relevant events are recorded.</td><td>A record per transfer: what, from which device, to which device, when, for which ticket.</td></tr>
</tbody></table></div>
<h2>Out of the zone is the easy half</h2>
<p>Exporting logs, reports and recipes needs only a screen on the source. Bringing patches and firmware <em>into</em> a zone is harder for any optical method: the target must have a camera, and it must verify what it receives before use. For inbound patches, a validated media process or a one-way conduit with integrity checks is usually the right answer; an optical route can still carry the signed hash so the target can verify a package that arrived another way.</p>
<h2>A checklist you can apply to any route</h2>
<ol>
<li>Is the route named in your zone and conduit model, with an owner?</li>
<li>Is every file's hash taken at the source and checked at the destination?</li>
<li>Is each transfer tied to a ticket, work order or change request?</li>
<li>Can an assessor verify the record later without calling the vendor?</li>
<li>Does the route bring any removable media into the zone?</li>
</ol>
<h2>Where Kionel fits</h2>
<p>Kionel answers points 2 to 5 for small outbound files and for sealed proofs, with records that verify offline under a free Apache-2.0 tool. It does not scan content and it is not certified; see the <a href="/limits.html">limits</a>.</p>
<p><a class="button" href="/ot-air-gapped-file-transfer.html">Kionel for OT</a> <a class="text-link" href="/verify.html">Verify a record</a></p>` },
  { slug: "offline-pc-to-phone-file-transfer", lang: "en", guide: true, title: "Moving a file from an offline PC to a phone without USB or network", description: "How to get a small file off a computer that has no network, no USB access and no camera onto a phone or tablet — the realistic options and what each one leaves behind.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>From an offline PC to a phone, with no USB and no network</h1>
<p>The situation is common in laboratories and on production floors: a result file sits on a computer that is not allowed on the network, its USB ports are locked, and it has no camera. Someone needs that file on a phone or tablet — to attach it to a record, send it on, or show it to a reviewer.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Kionel sells one of the options below; the comparison is meant to be usable even if you choose another.</p>
<h2>The realistic options</h2>
<div class="table-scroll"><table><thead><tr><th>Route</th><th>Works when</th><th>What it leaves behind</th></tr></thead><tbody>
<tr><td><strong>Photograph the screen</strong></td><td>You need to read a few values</td><td>An image, not the file. Values must be re-keyed and checked by a second person.</td></tr>
<tr><td><strong>Bluetooth</strong></td><td>The radio is enabled and pairing is allowed</td><td>Usually disabled on validated workstations for the same reason the network is. No record of what moved.</td></tr>
<tr><td><strong>A single static QR code</strong></td><td>The content is a few hundred bytes of text</td><td>Too small for most result files; anyone who photographs it has the content.</td></tr>
<tr><td><strong>Approved USB, via IT</strong></td><td>A controlled route exists</td><td>A ticket and a wait. The file lands on a second computer, not the phone.</td></tr>
<tr><td><strong>An encrypted stream of QR codes</strong></td><td>The phone has a camera and the PC has a screen and keyboard</td><td>The file itself, plus a signed record of what was sent and what arrived.</td></tr>
</tbody></table></div>
<h2>Why the last option needs one thing typed on the PC</h2>
<p>A screen can only talk; it cannot listen. If the PC simply showed the file as codes, anyone pointing a camera at the monitor — or a photo taken over a shoulder — would get the file too. Something has to travel from the phone back to the PC first, so the PC knows whom to encrypt for.</p>
<p>With no camera on the PC, the keyboard is that return channel. The phone shows a one-time 12-character code; the operator types it on the PC. The PC encrypts the file with a key derived from that code and plays it on screen; only the phone that showed the code can open it. A camera filming the monitor records ciphertext.</p>
<h2>Where Kionel fits</h2>
<p>This is how Kionel's Lab Bridge works for a PC without a camera. The file travels screen to camera, the sending PC signs a dispatch record bound to the file's hash and the work order, and the phone signs a delivery receipt after checking the content. Both records verify offline with a free Apache-2.0 tool. For a PC that always sends to the same device, a one-time "receiver card" replaces the typed code.</p>
<p>It suits small files — results, certificates, methods, configurations. It is the wrong tool for large raw data sets, and it does not inspect file content for malware.</p>
<h2>Try it on your own bench</h2>
<p>Kionel is free and open source (AGPL-3.0): it moves files up to 64 MB between two of your devices, end to end, with signed records and reports. Nothing is uploaded.</p>
<p><a class="button" href="/transfer.html">Start free</a> <a class="text-link" href="/limits.html">What Kionel does not protect</a></p>` },
  { slug: "usb-file-transfer-signed-record", lang: "en", guide: true, head: faqLd(USB_FAQ.en), title: "Keep the USB stick, add the proof: a signed record for files that travel by USB", description: "Most instrument PCs still hand their results over on a USB stick, and the stick leaves no record. Seal the file before it leaves, check it on arrival and sign for it: the same two signed records as an optical transfer, without changing how the file travels.", body: `
<p class="eyebrow">GUIDE</p><h1>Keep the USB stick, add the proof</h1>
<p class="lead">In most laboratories the instrument PC is kept off the network and the results leave it on a USB stick. The stick is not the problem an auditor asks about. The question is what left, what arrived, and how anyone knows they are the same file. Kionel answers that without changing how the file travels.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover.</p>
<h2>How to do it</h2>
<ol>
<li><strong>On the instrument PC</strong>, open Kionel (the <a href="/offline-package.html">offline package</a> works), choose the file, enter the work order and press <strong>Seal without transferring</strong>. The PC signs a record of the file's SHA-256, size, time and work order. Download it: <code>result.csv.seal.json</code>.</li>
<li><strong>Carry both</strong>, the file and its sealed record, the way you do today: on the stick, over a share, by hand.</li>
<li><strong>On the receiving device</strong>, open <em>Receive</em>, add the sealed record and then the file. The device checks the file against the record. If they match, it signs the delivery receipt; if one byte differs, it says so and signs nothing.</li>
</ol>
<p>The sending device seals; the receiving device signs.</p>
<p>The sealed record is a few hundred bytes. If you would rather not put it on the stick, show it as a code on the instrument PC's screen and scan it with the receiving device's camera; the file can still travel on the stick.</p>
<h2>What you have afterwards</h2>
<ul>
<li><strong>A dispatch record</strong> signed by the sending device: which file, how large, when, for which work order, declared by which operator.</li>
<li><strong>A delivery receipt</strong> signed by the receiving device over that record: exactly this file arrived here.</li>
<li><strong>A transfer log on both sides</strong> and a one-page report. The <a href="/verify.html#link">verifier</a> can compare the two logs and list every sealed file with its receipt, or without one.</li>
</ul>
<p>These are the same records an optical transfer produces, and the same free <a href="/verify.html">verifier</a> checks them, offline and without us. One licence covers every route: screen, one-way cable, printed pages, or the stick.</p>
<h2>What this does not do</h2>
<ul>
<li><strong>It does not encrypt the file on the stick.</strong> The file travels outside Kionel. Kionel shows that what arrived is what was sealed; it does not hide it on the way. If the content must stay confidential in transit, use the <a href="/transfer.html">optical route</a>, which encrypts before the first image is shown, or an encrypted stick.</li>
<li><strong>It does not control the USB port.</strong> Someone can still copy a file to a stick without sealing it. Port control is the job of the site's device-control software; Kionel records the handovers that go through it.</li>
<li><strong>It does not scan the stick.</strong> A stick is removable media, with everything <a href="/nist-sp-1334-usb-ot.html">NIST SP 1334</a> says about scanning, labelling and wiping. If the reason for leaving USB is malware, a record does not help; the optical route or a <a href="/serial-data-diode.html">one-way cable</a> does.</li>
<li><strong>It does not identify a person.</strong> The records show which keys signed and what the operator declared.</li>
</ul>
<h2>Questions people ask</h2>
${faqHtml(USB_FAQ.en)}
<p>How this compares with device-control software, media kiosks and compliance wrappers: <a href="/usb-transfer-audit-trail-options.html">audit trail for USB transfers, the options compared</a>.</p>
<h2>Which route when</h2>
<div class="table-scroll"><table><thead><tr><th>Situation</th><th>Route</th></tr></thead><tbody>
<tr><td>USB is allowed and the files are large</td><td>The stick, with a sealed record</td></tr>
<tr><td>USB ports are locked, files are small</td><td>Screen to camera</td></tr>
<tr><td>Cameras and phones are not allowed in the room</td><td>The stick with a sealed record, or a one-way cable</td></tr>
<tr><td>Files appear all day and nobody should have to carry them</td><td>One-way cable, unattended</td></tr>
<tr><td>The PC has only a printer</td><td>Printed pages</td></tr>
</tbody></table></div>
<div class="actions"><a class="button" href="https://github.com/Apeiron01/kionel">Source on GitHub</a><a class="button secondary" href="/transfer.html">Open Kionel</a></div>` },
  { slug: "usb-transfer-audit-trail-options", lang: "en", guide: true, title: "Audit trail for USB file transfers from lab instruments: the options compared", description: "A logbook, device-control software, a media kiosk, a compliance wrapper or a signed record: what each one records when a result file leaves an instrument PC on a USB stick, which question each answers, and what each leaves open.", body: `
<p class="eyebrow">GUIDE · COMPARISON</p><h1>Audit trail for USB transfers from instrument PCs: the options compared</h1>
<p class="lead">A result file leaves a standalone instrument PC on a USB stick. Months later an assessor asks what left, what arrived, and how you know they are the same file. Five kinds of tool sit around that moment, and each answers a different question. This page says which.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Statements about other products are taken from their public pages in October 2026 and may have changed; Kionel is our product, so read that row with that in mind.</p>
<h2>The five options</h2>
<div class="table-scroll"><table><thead><tr><th>Option</th><th>The question it answers</th><th>What it leaves open</th></tr></thead><tbody>
<tr><td><strong>Logbook and SOP</strong></td><td>Who says they moved which file, and when</td><td>Nothing checks that the file that arrived is the file that left; entries depend on people remembering</td></tr>
<tr><td><strong>Device-control software</strong><br>for example Microsoft Defender device control, ManageEngine Device Control Plus</td><td>Which sticks and which users may copy at all; often a log of what was copied</td><td>Runs on managed, usually networked PCs; says nothing about arrival, and knows no work order or sample</td></tr>
<tr><td><strong>Media kiosk</strong><br>for example OPSWAT MetaDefender Kiosk, Honeywell SMX</td><td>Is this stick clean before it goes into a protected system</td><td>Built for files going in and priced as infrastructure; not a record of a result leaving a laboratory</td></tr>
<tr><td><strong>Compliance wrapper for instrument software</strong><br>for example TotalLab AuditSafe</td><td>Who did what inside the instrument's software: logins, audit trail, electronic signatures</td><td>Covers work on the PC; the handover to another system is outside it</td></tr>
<tr><td><strong>Signed record and receipt</strong><br>Kionel</td><td>Exactly which file left, for which work order, and that exactly that file arrived, signed by both devices</td><td>Does not lock ports, scan content, or encrypt the stick; shows keys and declared operators, not identities</td></tr>
</tbody></table></div>
<h2>They are not substitutes</h2>
<p>A laboratory under GMP may reasonably run three of these at once: device control so that only approved sticks work, a wrapper so that the instrument software has an audit trail, and a record of each handover. The mistake is to expect one of them to answer another's question. Device control that logs "user copied result.csv" does not show that the LIMS received the same bytes. A signed receipt does not stop someone using an unapproved stick.</p>
<h2>Choosing by the question you are asked</h2>
<ul>
<li><strong>"How do you stop unapproved media?"</strong> Device control, and physical port locks.</li>
<li><strong>"How do you keep malware out?"</strong> Scanning, a kiosk, or no media at all: a <a href="/serial-data-diode.html">one-way cable</a> or a screen and a camera.</li>
<li><strong>"Who changed this result on the instrument?"</strong> The instrument software's own audit trail, or a wrapper.</li>
<li><strong>"What left, what arrived, and are they the same?"</strong> A hash taken at the source, checked at the destination, and signed. That is the part <a href="/usb-file-transfer-signed-record.html">Kionel does on a USB stick</a>, and the same part it does by <a href="/how-it-works.html">screen and camera</a>.</li>
</ul>
<h2>What the rules ask for</h2>
<p>EU GMP Annex 11 asks that systems exchanging data electronically include appropriate built-in checks for the correct and secure entry and processing of data. NIST SP 1334 asks for logs and for hash or checksum verification when files are transported on portable media; we go through it <a href="/nist-sp-1334-usb-ot.html">control by control</a>. Neither names a product, and no product makes a laboratory compliant by being installed.</p>
<div class="actions"><a class="button" href="/usb-file-transfer-signed-record.html">Keep the stick, add the proof</a><a class="button secondary" href="/limits.html">What Kionel does not do</a></div>` },
  { slug: "data-diode-vs-usb-lab", lang: "en", guide: true, title: "Data diode, controlled USB or optical transfer for an isolated lab PC", description: "A practical comparison of three ways to move files off an isolated laboratory workstation: cost, installation, what the auditor sees, and which fits occasional small files.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>Data diode, controlled USB or optical transfer?</h1>
<p>Once a laboratory decides an instrument PC must stay isolated, the next question is how files leave it. Three routes come up in almost every discussion. They are not competitors in every case: they solve different volumes and different frequencies.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Kionel sells one of the options below; the comparison is meant to be usable even if you choose another.</p>
<h2>Side by side</h2>
<div class="table-scroll"><table><thead><tr><th></th><th>Data diode</th><th>Controlled USB</th><th>Optical (screen to camera)</th></tr></thead><tbody>
<tr><td><strong>Best for</strong></td><td>Continuous one-way flow between two networks</td><td>Any size, occasional</td><td>Small files, occasional or daily</td></tr>
<tr><td><strong>Installation</strong></td><td>Hardware, network changes, IT project</td><td>Media, scanning station, procedure</td><td>A browser on each device</td></tr>
<tr><td><strong>Physical media</strong></td><td>None</td><td>Yes — the thing policies try to remove</td><td>None</td></tr>
<tr><td><strong>Record of each transfer</strong></td><td>Depends on the software around it</td><td>Depends on logs and people</td><td>Two signed records per transfer</td></tr>
<tr><td><strong>Throughput</strong></td><td>High</td><td>High</td><td>Low: kilobytes per second</td></tr>
<tr><td><strong>Main weakness</strong></td><td>Cost and effort for a few files a week</td><td>Malware and lost media; weak audit trail</td><td>Needs cameras allowed on site; small files only</td></tr>
</tbody></table></div>
<h2>How to choose</h2>
<ul>
<li><strong>Large or continuous data</strong> (raw spectra, images, streaming instrument output): a data diode or a controlled network route. Optical transfer is too slow.</li>
<li><strong>Occasional files of any size, and USB is already controlled well</strong>: keep it. Add a written record of each transfer if an inspector has asked for one.</li>
<li><strong>Small files, several times a week, and the finding is "no audit trail"</strong>: optical transfer with signed records is the cheapest route that answers that finding without new hardware.</li>
</ul>
<h2>The question an inspector asks</h2>
<p>Whatever the route, the question is the same: after the file moved, what can you show? Who sent which file, bound to which work order, and did the receiving side get exactly those bytes? A route that answers that with a document you can hand over is worth more than a faster route that answers it with memory.</p>
<h2>A fourth route: a one-way serial cable</h2>
<p>Between a diode and a camera sits a cable: a serial line with the return wire left out. Nothing can travel back, it needs no camera, and at 80 KB/s it is several times faster than optical transfer. It suits a fixed instrument PC next to the computer that feeds the LIMS. <a href="/serial-data-diode.html">Wiring, speeds and limits</a>.</p>
<h2>Where Kionel fits</h2>
<p>Kionel is the optical route, and it also sends over a one-way serial cable. It runs in a browser, needs no installation on the instrument PC, and produces a signed dispatch record and a signed delivery receipt for every transfer. It has not had an independent security audit yet and does not sanitise file content — if either matters for your decision, the <a href="/security.html">security page</a> lists the current status.</p>
<h2>Try it on your own bench</h2>
<p>Kionel is free and open source (AGPL-3.0): it moves files up to 64 MB between two of your devices, end to end, with signed records and reports. Nothing is uploaded.</p>
<p><a class="button" href="/transfer.html">Start free</a> <a class="text-link" href="/limits.html">What Kionel does not protect</a></p><p>If the file has to stay on a USB stick, the same two signed records can be made around it: <a href="/usb-file-transfer-signed-record.html">keep the USB stick, add the proof</a>.</p>
` },
  { slug: "21-cfr-part-11-file-transfer", lang: "en", guide: true, title: "21 CFR Part 11 and moving files between laboratory systems", description: "What Part 11 and EU Annex 11 expect when an electronic record moves between systems, where manual USB transfers fall short, and what a signed transfer record can and cannot cover.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>Part 11 and the file that changes systems</h1>
<p>Most Part 11 attention goes to the systems themselves: the chromatography data system, the LIMS, the ELN. The moment between them gets less attention — the file exported on one system and imported on another. That gap is where inspection findings about incomplete audit trails often start.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Kionel sells one of the options below; the comparison is meant to be usable even if you choose another.</p>
<p><em>This is not legal or regulatory advice. Your quality unit decides how a tool is validated and used under your procedures.</em></p>
<h2>What the regulations ask, in plain terms</h2>
<ul>
<li><strong>Audit trails</strong> (21 CFR 11.10(e), EU GMP Annex 11 §9): changes to electronic records are recorded with who and when, and the trail is retained with the record.</li>
<li><strong>Accuracy and integrity checks</strong> (11.10(a), Annex 11 §5 on data exchange): when data moves between systems, there should be checks that it arrived correctly and completely.</li>
<li><strong>Validation</strong> (11.10(a), Annex 11 §4): the tools involved do what they are supposed to, in your environment.</li>
<li><strong>Electronic signatures</strong> (11.50–11.300): a signature identifies the person, their intent and the time, and cannot be copied to another record.</li>
</ul>
<h2>Where a manual USB transfer falls short</h2>
<p>A file copied to a stick and back leaves, at best, a line in a paper log. Nothing proves the bytes that arrived are the bytes that left, which work order they belonged to, or that nobody opened them in between. That is the gap: not the systems, but the handover.</p>
<h2>What a signed transfer record covers — and what it does not</h2>
<div class="table-scroll"><table><thead><tr><th>Expectation</th><th>A signed dispatch and delivery record</th></tr></thead><tbody>
<tr><td>Data arrived exactly as sent</td><td class="ok">Yes — the content hash is signed on both sides</td></tr>
<tr><td>Transfer tied to a work order</td><td class="ok">Yes — the reference is inside the signed record</td></tr>
<tr><td>Tamper evidence after the fact</td><td class="ok">Yes — any edit breaks the signature</td></tr>
<tr><td>Which person sent it</td><td class="warn">No — the signature identifies a device, not a person</td></tr>
<tr><td>Part 11 electronic signature</td><td class="warn">No — use your system's e-signature for approvals</td></tr>
<tr><td>Validated in your environment</td><td class="warn">Your validation, not the vendor's claim</td></tr>
</tbody></table></div>
<h2>Where Kionel fits</h2>
<p>Kionel produces the transfer evidence: a dispatch record signed by the sending device and a delivery receipt signed by the receiving device, both bound to the file's hash and the work order, both verifiable offline years later with a free tool. It does not replace your systems' audit trails or e-signatures, and it is not certified or pre-validated. It closes the gap between two systems that already have their own controls.</p>
<h2>Try it on your own bench</h2>
<p>Kionel is free and open source (AGPL-3.0): it moves files up to 64 MB between two of your devices, end to end, with signed records and reports. Nothing is uploaded.</p>
<p><a class="button" href="/transfer.html">Start free</a> <a class="text-link" href="/limits.html">What Kionel does not protect</a></p><p>If the file has to stay on a USB stick, the same two signed records can be made around it: <a href="/usb-file-transfer-signed-record.html">keep the USB stick, add the proof</a>.</p>
` },
  { slug: "alcoa-plus-file-transfer", lang: "en", guide: true, title: "ALCOA+ when a result file moves off the instrument PC", description: "Applying the ALCOA+ data integrity principles to the moment a result file leaves an instrument workstation: which principles the transfer itself can break and how to keep them.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>ALCOA+ at the moment the file moves</h1>
<p>ALCOA+ is usually discussed for how data is created and stored. But a result that is attributable, original and accurate on the instrument PC can lose all three on the way to the next system — through a renamed copy, a second export, or a stick that visited another computer.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Kionel sells one of the options below; the comparison is meant to be usable even if you choose another.</p>
<h2>The principles the transfer can break</h2>
<div class="table-scroll"><table><thead><tr><th>Principle</th><th>How a transfer breaks it</th><th>What keeps it</th></tr></thead><tbody>
<tr><td><strong>Attributable</strong></td><td>Nobody recorded which device sent it, for which order</td><td>A record naming the sending device and the work order</td></tr>
<tr><td><strong>Contemporaneous</strong></td><td>The log is written later, from memory</td><td>A record created at the moment of sending</td></tr>
<tr><td><strong>Original</strong></td><td>Several copies exist; which one is the source?</td><td>A content hash taken on the source device</td></tr>
<tr><td><strong>Accurate</strong></td><td>The file was altered or truncated in transit</td><td>The receiver checks the hash before accepting</td></tr>
<tr><td><strong>Complete</strong></td><td>One of several files never arrived</td><td>One record per file; a missing receipt is visible</td></tr>
<tr><td><strong>Enduring / Available</strong></td><td>The evidence depends on a vendor's server</td><td>Records that verify offline, without the vendor</td></tr>
</tbody></table></div>
<h2>A simple test for any route</h2>
<p>Pick a result from last month. Can you show, without asking anyone: which device it left, which work order it belonged to, when, and that the file in the LIMS today has the same bytes? If the answer relies on someone's recollection or a handwritten line, the transfer is the weak link, not the instrument.</p>
<h2>Where Kionel fits</h2>
<p>Kionel creates that evidence at the moment of transfer: the sender signs the content hash with the work order, classification and target system; the receiver checks the content against it and signs a delivery receipt. A local hash-chained log makes a deleted entry visible. The records verify offline with a free Apache-2.0 tool, so they stay usable even if Kionel does not.</p>
<p>It does not identify the person at the keyboard, and it is not a substitute for your system's own audit trail and electronic signatures.</p>
<h2>Try it on your own bench</h2>
<p>Kionel is free and open source (AGPL-3.0): it moves files up to 64 MB between two of your devices, end to end, with signed records and reports. Nothing is uploaded.</p>
<p><a class="button" href="/transfer.html">Start free</a> <a class="text-link" href="/limits.html">What Kionel does not protect</a></p><p>If the file has to stay on a USB stick, the same two signed records can be made around it: <a href="/usb-file-transfer-signed-record.html">keep the USB stick, add the proof</a>.</p>
` },
  { slug: "what-is-in-a-qr-code", lang: "en", guide: true, head: '<script type="module" src="/src/qr-inspect-page.ts"></script>' + faqLd(QR_FAQ.en), title: "What is inside a QR code? Check it before you share it", description: "Drop a picture of a QR code and see what it really contains: a Wi-Fi password, a login-code secret, a link with a token, or data that only looks encrypted. Read in your browser, nothing uploaded. And why a QR code is not encryption.", body: `
<p class="eyebrow">FREE TOOL · GUIDE</p><h1>What is inside this QR code?</h1>
<p class="lead">A QR code is text drawn as squares. Anyone who photographs it has the text. Drop a picture of a code to see what it would give away. It is read in this browser tab: nothing is uploaded, and once the page has loaded it works with the network switched off.</p>
<label class="drop" id="qr-drop"><input type="file" id="qr-file" accept="image/*"><span>Drop a picture of a QR code here, or click to choose</span></label>
<p id="qr-status" class="evidence-status" role="status" hidden></p>
<div id="qr-results"></div>
<p><button type="button" class="button secondary" id="qr-clear" hidden>Remove the picture</button></p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover.</p>
<h2>What the tool looks for</h2>
<div class="table-scroll"><table><thead><tr><th>In the code</th><th>What a photo of it gives away</th></tr></thead><tbody>
<tr><td>Wi-Fi sharing code</td><td>The network name and its password, in plain text</td></tr>
<tr><td>Authenticator set-up code</td><td>The secret that generates your one-time login codes, for good</td></tr>
<tr><td>Authenticator export</td><td>The secrets of every account in the export</td></tr>
<tr><td>Link with a password or token</td><td>Whatever that token opens: a camera view, a shared folder, a session</td></tr>
<tr><td>Private key or recovery phrase</td><td>Everything the key protects</td></tr>
<tr><td>A string nobody can read</td><td>Unknown. It may be encrypted, or only scrambled</td></tr>
</tbody></table></div>
<h2>Scrambled is not encrypted</h2>
<p>Many apps put a device ID, a user name and a password into a sharing code and scramble them so the code does not look like a password. The method and its key are inside the app, the same on every phone. Whoever takes the app apart once can read every code it ever made. Encryption is different in one respect only: the key is not in the app and not in the code.</p>
<p>In October 2026 a widely shared post showed an AI model working out the scrambling in a camera app's sharing code and reading the camera's user name and password from it. We have not verified that case. The weakness it describes is old and real, and what is new is the effort: work that took a specialist days now takes a chat window minutes. Scrambling that relied on nobody bothering no longer protects anything.</p>
<p>This tool does not try to undo any scrambling, and it cannot tell scrambled from encrypted by looking; nobody can from the outside. It tells you which of the two it would need to be for the code to be safe to show.</p>
<h2>What to do with a code that carries a secret</h2>
<ul>
<li><strong>Do not post or send screenshots of it.</strong> Chat backups, photo clouds and support tickets keep them for years.</li>
<li><strong>Camera or recorder sharing codes:</strong> change the device password after sharing, give other people their own limited account, and switch off cloud access you do not use.</li>
<li><strong>Wi-Fi:</strong> show the code for a guest network, not the main one.</li>
<li><strong>Authenticator codes:</strong> if a set-up code was exposed, set up two-factor again so the old secret stops working. For a backup that is meant to last, see <a href="/encrypted-paper-backup.html">encrypted paper backup</a>.</li>
</ul>
<h2>Questions people ask</h2>
${faqHtml(QR_FAQ.en)}
<h2>How a code can be shown safely</h2>
<p>A code is safe to show when it contains nothing secret. Kionel's pairing code carries only public keys; the two devices then agree on a key that never appears on any screen, and both show a short comparison code so that a swapped code is noticed. The file itself is encrypted with that key before the first image is drawn. A recording of the screen is then useless without the receiving device. <a href="/how-it-works.html">How it works</a>, and <a href="/limits.html">what it does not protect against</a>.</p>
<div class="actions"><a class="button" href="/transfer.html">Send a file by QR, encrypted</a><a class="button secondary" href="/security.html">Security</a></div>` },
  { slug: "sha256-file-checksum", lang: "en", guide: true, head: '<script type="module" src="/src/hash-tool.ts"></script>', title: "Check a file's SHA-256 on Windows, Mac, Linux or a phone", description: "Get a file's SHA-256 in your browser without uploading it, or with one built-in command on Windows, macOS and Linux — and the five reasons two hashes of the same file differ.", body: `
<p class="eyebrow">FREE TOOL · GUIDE</p><h1>Check a file's SHA-256, here or with one command</h1>
<p class="lead">Drop a file to get its SHA-256. It is calculated in this browser tab: the file is not uploaded, and once the page has loaded it works with the network switched off.</p>
<label class="drop" id="hash-drop"><input type="file" id="hash-file"><span>Drop a file here, or click to choose</span></label>
<div id="hash-output" hidden><dl class="evidence-facts"><dt>File</dt><dd id="hash-name"></dd><dt>Size</dt><dd id="hash-size"></dd><dt>SHA-256</dt><dd id="hash-value"></dd></dl>
<p><button type="button" class="button secondary" id="hash-copy">Copy SHA-256</button> <button type="button" class="button secondary" id="hash-clear">Remove file</button></p></div>
<p><label for="hash-expected">Expected SHA-256, to compare (optional)</label><input id="hash-expected" type="text" autocomplete="off" spellcheck="false" placeholder="Paste the value you were given"></p>
<p id="hash-status" class="evidence-status" role="status" hidden></p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Kionel takes this same value from every file it transfers.</p>
<h2>The same check from the command line</h2>
<div class="table-scroll"><table><thead><tr><th>System</th><th>Command</th><th>Worth knowing</th></tr></thead><tbody>
<tr><td>Windows, Command Prompt</td><td><code>certutil -hashfile "C:\\data\\run_041.csv" SHA256</code></td><td>Built in. On Windows 7 the value is printed with spaces between each pair of characters; the spaces are not part of it.</td></tr>
<tr><td>Windows, PowerShell</td><td><code>Get-FileHash "C:\\data\\run_041.csv"</code></td><td>SHA-256 is the default. Needs PowerShell 4.0, so it is missing on an unupdated Windows 7. Prints capital letters.</td></tr>
<tr><td>macOS</td><td><code>shasum -a 256 ~/Desktop/run_041.csv</code></td><td>Without <code>-a 256</code>, shasum gives SHA-1: a different, 40-character value.</td></tr>
<tr><td>Linux</td><td><code>sha256sum run_041.csv</code></td><td>With a list of expected values, <code>sha256sum -c list.txt</code> checks many files at once.</td></tr>
<tr><td>Android, iPhone</td><td>none built in</td><td>Open this page in the phone's browser and pick the file.</td></tr>
</tbody></table></div>
<h2>Five reasons two hashes of "the same" file differ</h2>
<ol>
<li><strong>Someone opened it and pressed Save.</strong> Excel rewrites a CSV when it saves it: number formats, quotes and line endings can change while every value on screen looks the same. Take the hash before anyone opens the file.</li>
<li><strong>Line endings were converted.</strong> Windows ends a line with two characters, Linux and macOS with one. FTP in ASCII mode, some e-mail gateways and Git's <code>autocrlf</code> setting convert them without saying so.</li>
<li><strong>A different algorithm was used.</strong> SHA-256 is 64 characters, SHA-1 is 40, MD5 is 32. Many "checksum" tools default to one of the shorter ones.</li>
<li><strong>The copy is incomplete.</strong> A transfer that stopped early leaves a shorter file. Compare the sizes first; it is the quickest hint.</li>
<li><strong>Only the way the value is written differs.</strong> Capital or small letters, and the spaces from older certutil, do not change the value. This page ignores both when it compares.</li>
</ol>
<h2>What a matching hash does not tell you</h2>
<p>A match proves two files are identical. It does not say who produced the file, when, or whether the value you compared against was itself replaced. An auditor asking "is this the result that left the instrument PC?" needs the hash tied to a signature and a work order at the moment the file left.</p>
<p>That is what Kionel records. When a file leaves an offline PC through Kionel, the sending PC signs its SHA-256 together with the work order; the receiving device recomputes it on arrival and signs a receipt. The <a href="/verify.html">verify page</a> checks both records later and recomputes the file's SHA-256 against them.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/verify.html">Verify a receipt</a></div>` },
  { slug: "qr-code-capacity-file-transfer", lang: "en", guide: true, title: "How much data fits in a QR code, and how many codes a file needs", description: "Exact QR code capacities by version, how many codes a 10 KB to 5 MB file needs, why screens use the lowest error correction, and what really limits screen-to-camera speed.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>How much data fits in a QR code, and how many a file needs</h1>
<p class="lead">The largest QR code holds 2,953 bytes. A one-megabyte file is therefore a few hundred codes, not one. Below are the exact figures, and what decides how fast a screen can pass them to a camera.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Kionel sends files as sequences of codes; the capacities come from the QR standard (ISO/IEC 18004), the rest from the code the app runs.</p>
<h2>Bytes per code</h2>
<p>A QR code's size is its version, from 1 to 40; each step adds four modules (the small squares) to each side. Each version has four error-correction levels, L, M, Q and H, and the higher ones spend more of the code on repair data. For arbitrary bytes at level L:</p>
<div class="table-scroll"><table><thead><tr><th>Version</th><th>Modules</th><th>Bytes at level L</th></tr></thead><tbody>
<tr><td>10</td><td>57 × 57</td><td>271</td></tr>
<tr><td>15</td><td>77 × 77</td><td>520</td></tr>
<tr><td>20</td><td>97 × 97</td><td>858</td></tr>
<tr><td>25</td><td>117 × 117</td><td>1,273</td></tr>
<tr><td>27</td><td>125 × 125</td><td>1,465</td></tr>
<tr><td>30</td><td>137 × 137</td><td>1,732</td></tr>
<tr><td>35</td><td>157 × 157</td><td>2,306</td></tr>
<tr><td>40</td><td>177 × 177</td><td>2,953</td></tr>
</tbody></table></div>
<p>At version 40, level M holds 2,331 bytes, Q 1,663 and H 1,273.</p>
<h2>Why a screen uses level L</h2>
<p>A printed code on a crate gets scratched and dirty, and level H lets a reader recover it with up to about 30% of it damaged. A code on a monitor is never torn; the risk is a missed or blurred image. So Kionel uses level L, the most data per image, and deals with missed images differently: a fountain code. The sender keeps producing fresh combinations of the file's pieces, and the receiver rebuilds the file from any set slightly larger than the file itself — whichever images it happened to catch. Nothing has to be sent again on request.</p>
<h2>How many codes a file needs</h2>
<p>Kionel puts a 20-byte header on every code (session, position, checksum), so a version-27 code carries 1,445 bytes of the file and a version-40 code 2,933. With 1 KB = 1,024 bytes:</p>
<div class="table-scroll"><table><thead><tr><th>File size</th><th>Version 27 codes</th><th>Version 40 codes</th></tr></thead><tbody>
<tr><td>10 KB</td><td>8</td><td>4</td></tr>
<tr><td>100 KB</td><td>71</td><td>35</td></tr>
<tr><td>1 MB</td><td>726</td><td>358</td></tr>
<tr><td>5 MB</td><td>3,629</td><td>1,788</td></tr>
</tbody></table></div>
<p>These are minimums: the receiver has to catch that many different images. Allow about 10% more for the fountain code.</p>
<h2>Compress first, then encrypt</h2>
<p>Encrypted data looks random and does not compress, so the order matters. Kionel compresses the file before encrypting it and sends whichever version is smaller. Plain-text exports (CSV, TXT, XML) usually shrink a lot. JPEG, PNG, ZIP, XLSX and most PDFs are compressed already and barely change.</p>
<h2>What limits the speed</h2>
<p>Showing codes is easy. Reading them is the bottleneck.</p>
<ul>
<li><strong>Reading live.</strong> The receiving camera decodes images as they arrive. Kionel shows version-27 codes 30 times a second for this; a denser code needs a sharper image, and the camera reads fewer of them.</li>
<li><strong>Recording.</strong> The receiving device films the screen and Kionel reads the video afterwards, frame by frame. Here Kionel shows version-40 codes 20 times a second: most phones record 30 frames a second, and at 60 codes a second most frames catch two codes blended together.</li>
<li><strong>Colour code.</strong> Images that use colour instead of black and white (from the open-source libcimbar project) carry about 2,770 bytes each and are shown 15 times a second, for recording.</li>
</ul>
<p>Actual speed depends on the camera, the screen and the distance. Kionel shows its estimate for your file before you start, and for recording it tells the receiving device how long to film.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/offline-pc-to-phone-file-transfer.html">Offline PC to phone</a></div>` },
  { slug: "excel-csv-changes-lab-data", lang: "en", guide: true, title: "Why a CSV changes when Excel opens it, and how to keep the raw result", description: "Excel drops leading zeros, cuts long IDs to 15 digits, turns gene names and well positions into dates and rewrites the file on save. What changes, how to switch it off, and how to prove the original is untouched.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>Excel changes CSV files. Here is exactly how.</h1>
<p class="lead">Opening an instrument's CSV export in Excel is the most common way a raw result gets altered without anyone deciding to alter it. Nothing looks wrong on screen. The damage is in what Excel guesses when it opens the file, and in what it writes back if someone presses Save.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover.</p>
<h2>What Excel guesses when it opens a CSV</h2>
<div class="table-scroll"><table><thead><tr><th>In the file</th><th>Excel shows</th><th>Why</th></tr></thead><tbody>
<tr><td><code>00123</code> (sample ID)</td><td>123</td><td>It looks like a number, and a number has no leading zeros.</td></tr>
<tr><td><code>1234567890123456789</code> (19-digit barcode)</td><td>1.23457E+18</td><td>Excel keeps 15 significant digits. The rest become zeros: 1234567890123450000.</td></tr>
<tr><td><code>12E3</code> (an ID)</td><td>1.20E+04</td><td>Digits around an E are read as scientific notation, 12 × 10³.</td></tr>
<tr><td><code>SEPT2</code>, <code>MARCH1</code> (genes)</td><td>2-Sep, 1-Mar</td><td>Text that looks like a date becomes a date.</td></tr>
<tr><td><code>1-2</code>, <code>3/4</code> (wells, ratios)</td><td>a date</td><td>The same guess; which date depends on the PC's regional settings.</td></tr>
<tr><td><code>0.80</code></td><td>0.8</td><td>Trailing zeros are formatting, not value. The precision the instrument reported is no longer visible.</td></tr>
</tbody></table></div>
<p>The gene row is not hypothetical. A 2016 study of supplementary files found gene-name errors of this kind in roughly one in five papers that shared gene lists in Excel, and in 2020 the HUGO Gene Nomenclature Committee renamed 27 human genes, SEPT1 to SEPTIN1 and MARCH1 to MARCHF1 among them, so that spreadsheets would stop converting them.</p>
<p>On a PC set to a decimal comma (Turkish, German, French and many other regional settings), a double-clicked CSV is also split on semicolons instead of commas. A comma-separated instrument export then opens as a single column.</p>
<h2>What Save writes back</h2>
<ul>
<li><strong>The guesses become the data.</strong> Lost zeros and digits, and dates in the PC's date format, are written into the file.</li>
<li><strong>The encoding can change.</strong> "CSV (Comma delimited)" saves in the PC's legacy code page, not UTF-8. Characters outside it, such as α or Δ on a Western European PC, become question marks. "CSV UTF-8" is a separate entry in the Save As list.</li>
<li><strong>Separators, quotes and line endings can change.</strong> The values may survive, but the file is no longer the same file, and its <a href="/sha256-file-checksum.html">SHA-256</a> changes.</li>
</ul>
<h2>How to switch the guessing off</h2>
<p>Excel for Microsoft 365 and Excel 2024 have a setting for it. On Windows: <strong>File → Options → Data → Automatic Data Conversion</strong>. On a Mac: <strong>Excel → Preferences → Edit</strong>. There are four switches: leading zeros, 15-digit truncation, the letter E, and letters-and-numbers that look like dates.</p>
<p>Two catches. First, it is per user and per PC: the colleague who opens the file next may still have it on. Second, Microsoft notes that values with a space or a hyphen, such as <code>JAN-1</code>, may still become dates with the switch off. Well positions like <code>1-2</code> are exactly that shape.</p>
<p>In older Excel, and whenever the file matters, import instead of opening: <strong>Data → From Text/CSV</strong>, then <strong>Transform Data</strong>, set identifier columns to Text, and load. The original file on disk is not touched.</p>
<h2>Keep the raw file raw</h2>
<ol>
<li><strong>Take its SHA-256 before anyone opens it.</strong> That value is how you later show the file was not changed.</li>
<li><strong>Open a copy, never the export itself.</strong> Or set the export folder to read-only.</li>
<li><strong>Import with identifiers as text</strong>, as above.</li>
<li><strong>Move the original bytes, not a re-saved file.</strong> If the result leaves the instrument PC, the file that arrives should be the one the instrument wrote, with the hash taken at the source.</li>
</ol>
<p>Kionel does the last step for an offline instrument PC: it moves the file as bytes, signs its SHA-256 with the work order on the sending PC, and checks it again on arrival. To compare sample ID lists without Excel touching the zeros, use the <a href="/sample-reconciliation.html">sample reconciliation tool</a>; it keeps leading zeros and letter case as they are.</p>
<p>To see whether a file has already been through Excel, drop it into the free <a href="/excel-damage-check.html">Excel damage check</a>; with the original as well, it lists every changed cell.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/excel-damage-check.html">Check a CSV for Excel damage</a><a class="button secondary" href="/sha256-file-checksum.html">Check a SHA-256</a></div>` },
  { slug: "excel-csv-veri-bozulmasi", guide: true, title: "Excel CSV dosyasını neden değiştirir? Sıfırlar, tarihler ve Türkçe ayarlar", description: "Excel baştaki sıfırları siler, uzun kimlikleri 15 haneye keser, 1.12 gibi değerleri tarihe çevirir ve kaydedince dosyayı yeniden yazar. Türkçe Excel'e özgü sorunlar ve ham sonucu koruma yolu.", body: `
<p class="eyebrow">REHBER · 2026</p><h1>Excel CSV dosyasını değiştirir. Tam olarak şöyle.</h1>
<p class="lead">Cihazın verdiği CSV'yi Excel'de açmak, ham sonucun kimse karar vermeden değişmesinin en yaygın yoludur. Ekranda her şey doğru görünür. Bozulma, Excel'in açarken yaptığı tahminlerde ve biri Kaydet'e bastığında dosyaya geri yazılanlardadır.</p>
<p>Yazan: Taha Bayar, biyolog; laboratuvar verisinin teslimi üzerine çalışıyor.</p>
<h2>Türkçe Excel'e özgü iki sorun</h2>
<p><strong>Ondalık nokta tarihe dönüşür.</strong> Türkçe bölge ayarında ondalık ayırıcı virgül, tarih ayırıcı noktadır. Noktalı ondalık yazan bir cihazın dosyasında <code>1.12</code> değeri 1 Aralık, <code>12.5</code> değeri 12 Mayıs olur. <code>0.8</code> gibi tarih olamayan değerler ise sayı değil metin olarak kalır ve hesaplamaya girmez. Aynı sütunda üç farklı şey olur ve hiçbiri uyarı vermez.</p>
<p><strong>Dosya tek sütunda açılır.</strong> Türkçe ayarda liste ayırıcı noktalı virgüldür. Çift tıklanan virgüllü CSV bu yüzden tek sütuna yığılır. Excel'de kaydedilen CSV de noktalı virgül ve ondalık virgülle yazılır; virgül bekleyen bir LIMS veya analiz programı onu okuyamaz.</p>
<h2>Her dilde olan tahminler</h2>
<div class="table-scroll"><table><thead><tr><th>Dosyada</th><th>Excel'de</th><th>Neden</th></tr></thead><tbody>
<tr><td><code>00123</code> (numune no)</td><td>123</td><td>Sayıya benzer; sayının baştaki sıfırı olmaz.</td></tr>
<tr><td><code>1234567890123456789</code> (19 haneli barkod)</td><td>1,23457E+18</td><td>Excel 15 anlamlı basamak tutar; gerisi sıfır olur.</td></tr>
<tr><td><code>12E3</code> (bir kimlik)</td><td>1,20E+04</td><td>E harfinin çevresindeki rakamlar bilimsel gösterim sayılır.</td></tr>
<tr><td><code>SEPT2</code>, <code>MARCH1</code> (gen adları)</td><td>tarih</td><td>Tarihe benzeyen metin tarihe çevrilir.</td></tr>
<tr><td><code>0.80</code></td><td>0,8</td><td>Sondaki sıfır biçimdir, değer değil; cihazın bildirdiği hassasiyet görünmez olur.</td></tr>
</tbody></table></div>
<p>Gen adı satırı varsayım değil: 2016'da yayımlanan bir çalışma, Excel'le gen listesi paylaşan makalelerin yaklaşık beşte birinde bu tür hata buldu. 2020'de insan gen adlandırma komitesi (HGNC) 27 geni, örneğin SEPT1'i SEPTIN1 ve MARCH1'i MARCHF1 olarak, bu yüzden yeniden adlandırdı.</p>
<h2>Kaydet'e basınca ne olur</h2>
<ul>
<li><strong>Tahminler veri olur.</strong> Kaybolan sıfırlar ve basamaklar, tarihe dönen değerler dosyaya yazılır.</li>
<li><strong>Karakter kodlaması değişebilir.</strong> "CSV (virgülle ayrılmış)" seçeneği UTF-8 değil, bilgisayarın eski kod sayfasıyla kaydeder. ş, ğ, ı gibi harfler başka bir sistemde bozuk karakter olarak görünebilir. "CSV UTF-8" ayrı bir seçenektir.</li>
<li><strong>Ayırıcılar, tırnaklar ve satır sonları değişebilir.</strong> Değerler aynı kalsa bile dosya artık aynı dosya değildir; <a href="/sha256-file-checksum.html">SHA-256</a> özeti değişir.</li>
</ul>
<h2>Tahmini kapatmak</h2>
<p>Microsoft 365 ve Excel 2024'te bunun ayarı var: Windows'ta <strong>Dosya → Seçenekler → Veri</strong>, otomatik veri dönüştürme bölümü. Dört anahtar: baştaki sıfırlar, 15 haneye kesme, E harfi ve tarihe benzeyen harf-rakam dizileri.</p>
<p>İki dikkat noktası var. Ayar kullanıcıya ve bilgisayara özeldir; dosyayı sonra açan meslektaşta açık olabilir. Microsoft'a göre, anahtar kapalıyken bile boşluk veya tire içeren değerler (<code>JAN-1</code> gibi) tarihe dönebilir; <code>1-2</code> gibi kuyu konumları tam bu biçimdedir. Ondalık nokta sorunu ise bu ayarla değil, içe aktarırken çözülür.</p>
<p>Dosya önemliyse açmak yerine içe aktarın: <strong>Veri → Metinden/CSV'den</strong>, ardından <strong>Verileri Dönüştür</strong> (İngilizce Excel'de Data → From Text/CSV → Transform Data). Kimlik sütunlarını Metin yapın; ondalık nokta kullanan sütunlarda türü yerel ayarla değiştirin (Using Locale) ve İngilizce (ABD) seçin. Diskteki asıl dosyaya dokunulmaz.</p>
<h2>Ham dosyayı ham tutmak</h2>
<ol>
<li><strong>Kimse açmadan SHA-256 özetini alın.</strong> Dosyanın değişmediğini sonradan bu değerle gösterirsiniz.</li>
<li><strong>Dosyanın kendisini değil, kopyasını açın.</strong> Ya da dışa aktarım klasörünü salt okunur yapın.</li>
<li><strong>Kimlikleri metin olarak içe aktarın.</strong></li>
<li><strong>Yeniden kaydedilmiş dosyayı değil, özgün baytları taşıyın.</strong> Sonuç cihaz bilgisayarından çıkıyorsa, varan dosya cihazın yazdığı dosya olmalı; özeti de kaynakta alınmalı.</li>
</ol>
<p>Kionel ağa bağlı olmayan cihaz bilgisayarı için son adımı yapar: dosyayı bayt olarak taşır, SHA-256 özetini iş emriyle birlikte gönderen bilgisayarda imzalar ve varışta yeniden kontrol eder. Numune listelerini Excel sıfırlara dokunmadan karşılaştırmak için <a href="/numune-karsilastirma.html">numune karşılaştırma aracı</a> baştaki sıfırları ve harfleri olduğu gibi korur.</p>
<p>Bir dosyanın Excel'den geçip geçmediğini görmek için ücretsiz <a href="/excel-bozulma-kontrolu.html">Excel hasarı kontrolüne</a> bırakın; özgün dosyayı da eklerseniz değişen her hücreyi listeler.</p>
<div class="actions"><a class="button" href="/transfer.html">Ücretsiz başla</a><a class="button secondary" href="/numune-karsilastirma.html">Numune karşılaştırma</a></div>` },
  { slug: "offline-package", lang: "en", title: "Offline package for PCs that never go online", description: "Kionel as one HTML file: copy it to an isolated PC through your approved route, check its SHA-256, open it in the browser. No installation, no network, no admin rights, and it never updates itself.", body: (() => {
  const latest = offlineReleases[0];
  const release = latest ? `
<div class="table-scroll"><table><tbody>
<tr><th>Version</th><td>${esc(latest.version)}</td></tr>
<tr><th>Released</th><td>${esc(latest.date)}</td></tr>
<tr><th>Size</th><td>${latest.bytes.toLocaleString("en")} bytes</td></tr>
<tr><th>SHA-256</th><td><code>${esc(latest.sha256)}</code></td></tr>
<tr><th>Built from</th><td>commit <code>${esc(latest.commit)}</code></td></tr>
</tbody></table></div>
<div class="actions"><a class="button" href="/download/${esc(latest.file)}" download>Download ${esc(latest.file)}</a><a class="button secondary" href="/download/${esc(latest.file)}.sha256" download>SHA-256 file</a></div>`
    : `<p class="note">The first version is being prepared.</p>`;
  const file = latest ? latest.file : "kionel-offline-1.0.0.html";
  const history = offlineReleases.length > 1 ? `
<h2>Earlier versions</h2>
<p>Kept so that a validated installation can be re-checked or restored.</p>
<div class="table-scroll"><table><thead><tr><th>Version</th><th>Released</th><th>SHA-256</th></tr></thead><tbody>
${offlineReleases.slice(1).map((r) => `<tr><td><a href="/download/${esc(r.file)}" download>${esc(r.version)}</a></td><td>${esc(r.date)}</td><td><code>${esc(r.sha256)}</code></td></tr>`).join("\n")}
</tbody></table></div>` : "";
  return `
<p class="eyebrow">DOWNLOAD</p><h1>Kionel for a PC that never goes online</h1>
<p class="lead">One HTML file. Copy it to the isolated PC through your approved route, open it in the browser, and it runs: no installation, no network, no administrator rights.</p>
${release}
<h2>1. Check the file before it goes anywhere</h2>
<p>Download it on a PC with internet access and compare its SHA-256 with the value above.</p>
<div class="table-scroll"><table><thead><tr><th>System</th><th>Command</th></tr></thead><tbody>
<tr><td>Windows, Command Prompt</td><td><code>certutil -hashfile ${esc(file)} SHA256</code></td></tr>
<tr><td>Windows, PowerShell</td><td><code>Get-FileHash ${esc(file)}</code></td></tr>
<tr><td>macOS</td><td><code>shasum -a 256 ${esc(file)}</code></td></tr>
<tr><td>Linux</td><td><code>sha256sum -c ${esc(file)}.sha256</code></td></tr>
</tbody></table></div>
<p>Or drop it on the <a href="/sha256-file-checksum.html">SHA-256 checker</a> and paste the value above. If it does not match, do not use the file.</p>
<h2>2. Put it on the offline PC</h2>
<ol>
<li>Copy the file through the route your site already approves: a managed USB stick, a transfer kiosk, a software deployment tool.</li>
<li>On the offline PC, open it with <strong>Chrome or Edge 137 or later</strong> (right-click → Open with). Windows 10 and 11 can run these; Windows 7 and 8.1 cannot.</li>
<li>The first line says <em>Offline package ${esc(latest ? latest.version : "1.0.0")}</em>. Every feature is available; there is no licence file to load.</li>
</ol>
<p>Keep the file somewhere users cannot write to, for example a read-only folder, so the version that was checked is the version that runs.</p>
<h2>What the package does</h2>
<p>It is the sending side of Kionel, complete:</p>
<ul>
<li>Sending to a receiving device with a typed code or a receiver card: no camera needed on this PC.</li>
<li>Live QR codes, the dense recording mode, and the colour code, which reads best from a phone video, for larger files.</li>
<li>Signed dispatch records, the seal (proof without transfer), printed reports.</li>
<li>Licence loading from a file or pasted text. Checked on the PC itself; nothing is contacted.</li>
</ul>
<p>A computer with a webcam can use the same file to receive, so both sides of a validated setup run one fixed version. Phones open kionel.com as usual. Trusted timestamps are only in the website version, because the package contacts no service.</p>
<h2>Why it never updates itself</h2>
<p>A validated system is validated at one version. A web page that changes under the user cannot be validated; a file with a fixed hash can. Every new version is a new file with its own name and SHA-256, listed on this page with the commit it was built from, and older versions stay downloadable. What changed is in the <a href="/changelog.html">changelog</a>.</p>
${history}
<div class="actions"><a class="button secondary" href="/get-started.html">Getting started</a><a class="button secondary" href="/limits.html">Limits</a></div>`;
})() },
  { slug: "instrument-results-to-lims-offline", lang: "en", guide: true, title: "Getting results from an offline instrument PC into a LIMS", description: "Five ways to get a result file from an isolated instrument PC into a LIMS or data system: re-typing, a watched network folder, USB, middleware, and an optical route into a watched folder. What each costs and what the auditor sees.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>From an offline instrument PC into the LIMS</h1>
<p class="lead">The LIMS is on the network. The instrument PC is not, on purpose. Somewhere between them a result file has to cross, and the way it crosses decides whether the LIMS holds the instrument's data or a copy someone made of it.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Kionel is one of the routes below; the comparison is meant to be usable whichever you choose.</p>
<h2>Five routes</h2>
<div class="table-scroll"><table><thead><tr><th>Route</th><th>What reaches the LIMS</th><th>What it costs</th></tr></thead><tbody>
<tr><td><strong>Re-typing the results</strong></td><td>Values, not the file</td><td>Transcription errors, and a second person to check every entry.</td></tr>
<tr><td><strong>Instrument PC on the network, watched folder</strong></td><td>The file, automatically</td><td>The PC is no longer isolated: patching, accounts and firewall rules for a machine that was kept off the network for a reason.</td></tr>
<tr><td><strong>USB to a networked PC, then upload</strong></td><td>The file, if nobody opened it on the way</td><td>Removable-media rules, scanning, and a gap in the record between the two PCs.</td></tr>
<tr><td><strong>Vendor middleware or SDMS</strong></td><td>The file and metadata</td><td>A network connection again, plus a product per instrument vendor.</td></tr>
<tr><td><strong>Screen to camera into a watched folder</strong></td><td>The file, byte for byte, with a signed receipt</td><td>A PC with a webcam next to the instrument PC, and a few seconds to minutes per file depending on size.</td></tr>
</tbody></table></div>
<h2>How the last route works with Kionel</h2>
<ol>
<li>The instrument PC runs the <a href="/offline-package.html">offline package</a>: one file, no network. It shows the result file as encrypted codes and signs a dispatch record with the file's SHA-256 and the work order.</li>
<li>A networked PC with a webcam, in Chrome or Edge, reads the codes. In <em>Receive</em>, press <strong>Save received files to a folder</strong> once and pick the folder your LIMS or data system already imports from.</li>
<li>On delivery the file is written into that folder under its own name, with <code>&lt;name&gt;.makbuz.json</code> next to it: the receipt signed by both PCs. An existing file is never overwritten; a second copy becomes <code>name (2).csv</code>.</li>
<li>If your importer matches files by name, set <em>File names in the folder</em>, for example <code>{workorder}_{name}</code> or <code>{date}_{time}_{workorder}</code>. The values come from the signed record, so nobody renames files by hand.</li>
</ol>
<p>The LIMS then imports it exactly as it would from a networked instrument. Kionel has no LIMS connector and needs none: the folder is the interface.</p>
<h2>Three details for whoever sets up the import</h2>
<ul>
<li><strong>Wait until the file is complete.</strong> Chrome first creates the file empty, writes the content into a temporary <code>.crswap</code> file, and swaps it in only when it is complete. A watcher therefore never sees half a result, but it can see an empty file for a moment. Set it to ignore <code>*.crswap</code> and to wait until a file is non-empty and stable, a setting most folder importers have.</li>
<li><strong>Receipts beside the data.</strong> If the parser picks up every file in the folder, exclude <code>*.makbuz.json</code>, or attach it to the sample record as the transfer evidence.</li>
<li><strong>Permission after a restart.</strong> Chrome asks once again for the folder after the browser restarts; the button then reads <em>Allow saving to …</em>. Until it is pressed, files are only offered for download, and the app says so.</li>
</ul>
<h2>What the auditor sees</h2>
<p>For every file: the dispatch record signed on the instrument PC, the receipt signed on the receiving PC, both tied to the same SHA-256 and work order, and a file in the LIMS folder whose SHA-256 matches. Both records can be checked on the <a href="/verify.html">verify page</a> or with the free command-line verifier, without us.</p>
<p>If the file has to stay on a USB stick, the same two signed records can be made around it: <a href="/usb-file-transfer-signed-record.html">keep the USB stick, add the proof</a>.</p>
<div class="actions"><a class="button" href="/offline-package.html">Offline package</a><a class="button secondary" href="/transfer.html">Start free</a><a class="button secondary" href="/excel-csv-changes-lab-data.html">Excel and CSV results</a></div>` },
  { slug: "validation-pack", lang: "en", title: "Validation pack: IQ and OQ protocol for Kionel", description: "A printable IQ/OQ protocol for the Kionel offline package: scope and SHA-256, suggested GAMP 5 category, user requirements with traceability, installation and operational test scripts with blanks for results and signatures.", body: (() => {
  const r = offlineReleases[0] ?? { version: "—", file: "—", sha256: "—", commit: "—", date: "—" };
  const by = Object.fromEntries(VP_REQUIREMENTS.map(([id]) => [id, VP_OQ.filter((t) => t.req.includes(id)).map((t) => t.id)]));
  const blank = '<td class="blank"></td>';
  return `<div class="vp">
<p class="eyebrow">VALIDATION PACK</p><h1>IQ and OQ protocol for the Kionel offline package ${esc(r.version)}</h1>
<p class="lead">Print this page, or save it as PDF, to get a protocol with space for results and signatures. It supports your validation and does not replace it: the intended use, the risk decisions and the approval remain with your quality unit.</p>
<h2>1. Scope</h2>
<div class="table-scroll"><table><tbody>
<tr><th>Product</th><td>Kionel offline package (sending PC; also receiving computer with a webcam)</td></tr>
<tr><th>Version</th><td>${esc(r.version)}, released ${esc(r.date)}</td></tr>
<tr><th>File</th><td><code>${esc(r.file)}</code></td></tr>
<tr><th>SHA-256</th><td><code>${esc(r.sha256)}</code></td></tr>
<tr><th>Built from</th><td>commit <code>${esc(r.commit)}</code></td></tr>
<tr><th>Browser</th><td>Chrome or Edge 137 or later, Windows 10 or 11</td></tr>
<tr><th>Receiving phones</th><td>Use kionel.com, which is updated continuously. For a fixed receiver, use the same offline package on a computer with a webcam. Record the build shown at the bottom of the page in every OQ result.</td></tr>
</tbody></table></div>
<h2>2. Suggested classification and risk</h2>
<p>A standard product used as supplied, with options a user switches on or off but no configuration or code of your own. We suggest assessing it as <strong>GAMP 5 Category 3</strong> (non-configured product). Its job is to move a file from an isolated PC and leave signed evidence of what moved, which is where EU GMP Annex 11 (2011) §5 applies: systems exchanging data with other systems should include appropriate built-in checks for the correct and secure entry and processing of data.</p>
<p>What it does not do is as important for the risk assessment: it does not scan file content for malware, does not identify people (it signs with device keys), and uses device clocks unless trusted timestamps are switched on. The full list is on <a href="/limits.html">kionel.com/limits.html</a>.</p>
<h2>3. User requirements and traceability</h2>
<div class="table-scroll"><table><thead><tr><th>ID</th><th>Requirement</th><th>Verified by</th></tr></thead><tbody>
${VP_REQUIREMENTS.map(([id, text]) => `<tr><td>${id}</td><td>${text}</td><td>${[...(id === "URS-01" || id === "URS-02" ? ["IQ"] : []), ...by[id]].join(", ") || "—"}</td></tr>`).join("\n")}
</tbody></table></div>
<h2>4. Installation qualification (IQ)</h2>
<div class="table-scroll"><table><thead><tr><th>#</th><th>Action</th><th>Expected</th><th>Result</th><th>Initials, date</th></tr></thead><tbody>
${VP_IQ.map(([action, expected], i) => `<tr><td>IQ-${String(i + 1).padStart(2, "0")}</td><td>${action}</td><td>${expected}</td>${blank}${blank}</tr>`).join("\n")}
</tbody></table></div>
<h2>5. Operational qualification (OQ)</h2>
<p>Use a non-production file for each test. Record the build shown at the bottom of each device's page, attach screenshots or printed reports as evidence, and mark each test Pass or Fail.</p>
${[...VP_OQ].sort((a, b) => a.id.localeCompare(b.id)).map((t) => `<section class="vp-test">
<h3>${t.id} · ${t.title}</h3>
<p class="note">Requirements: ${t.req.join(", ")}</p>
<ol>${t.steps.map((step) => `<li>${step}</li>`).join("")}</ol>
<p><strong>Expected:</strong> ${t.expect}</p>
<div class="table-scroll"><table><tbody><tr><th>Actual result</th>${blank}</tr><tr><th>Pass / Fail</th>${blank}</tr><tr><th>Build on each device</th>${blank}</tr><tr><th>Tester, date</th>${blank}</tr></tbody></table></div>
</section>`).join("\n")}
<h2>6. Vendor testing of this version</h2>
<p>Before a version is published, its code passes automated tests: ${VENDOR_TESTS.unit} unit tests, and end-to-end tests that drive the real application in a browser, including the offline package opened from disk. The end-to-end scripts are kept in the source repository under <code>tools/e2e/</code> and can be shown under a confidentiality agreement.</p>
<div class="table-scroll"><table><thead><tr><th>End-to-end suite</th><th>What it checks</th><th>Checks</th></tr></thead><tbody>
${VENDOR_TESTS.e2e.map(([name, what, count]) => `<tr><td>${name}</td><td>${what}</td><td>${count}</td></tr>`).join("\n")}
</tbody></table></div>
<p>Cryptographic protocols are also checked formally with ProVerif; the models are published at <a href="/formal/README.md">kionel.com/formal</a>.</p>
<h2>7. Change control</h2>
<p>A published version is never changed. A new version is a new file with its own name and SHA-256, listed on the <a href="/offline-package.html">download page</a> with the commit it was built from; earlier versions stay downloadable so a validated installation can be re-checked or restored. What changed is in the <a href="/changelog.html">changelog</a>. Assess each new version under your own change control before replacing a validated one.</p>
<h2>8. Approval</h2>
<div class="table-scroll"><table><thead><tr><th>Role</th><th>Name</th><th>Signature</th><th>Date</th></tr></thead><tbody>
<tr><td>Prepared by</td>${blank}${blank}${blank}</tr>
<tr><td>Reviewed by</td>${blank}${blank}${blank}</tr>
<tr><td>Approved by (QA)</td>${blank}${blank}${blank}</tr>
</tbody></table></div>
</div>`;
})() },
  { slug: "screen-recording-qr-codes-not-scanning", lang: "en", guide: true, title: "Why a screen recording of QR codes will not scan, and how to fix it", description: "Messaging apps shrink the video, 4K and 60 fps are often HEVC, codes change faster than the camera, the browser tab is in the background. Five causes with measured examples, and what to do about each.", body: `
<p class="eyebrow">GUIDE · UPDATED 2026</p><h1>Why a screen recording of QR codes will not scan</h1>
<p class="lead">Filming a screen that shows a stream of QR codes, then reading the video later, is a practical way to move a file off a PC with no network and no camera. When it fails, the cause is almost never the codes. It is what happened to the video.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. The examples below come from our own test recordings.</p>
<h2>1. The video was shrunk on the way</h2>
<p>A 1080 × 1920 phone recording of 11 seconds, 29 MB, was sent to a computer through WhatsApp. It arrived as 478 × 850 at about 1.9 Mbit/s, 2.6 MB. A dense QR code of 177 × 177 modules then has fewer than three pixels per module, and nothing reads it reliably. The original file, copied by cable, read without trouble.</p>
<p>Messaging apps and most e-mail and chat services recompress video. Move the original instead: a USB cable (on Windows, the phone appears under This PC, photos in DCIM), Quick Share or AirDrop, or, in WhatsApp, send it as a <em>document</em> rather than as a video.</p>
<h2>2. The format is 4K, 60 fps or HEVC</h2>
<p>Many phones record 4K or 60 fps in HEVC (H.265). A browser can play HEVC only where the computer's hardware decoder supports it, and a file the browser cannot decode delivers no frames at all. Record at 1080p and 30 fps. On an iPhone, <em>Settings → Camera → Formats → Most Compatible</em> records H.264.</p>
<p>Higher resolution does not help by itself: if the code fills a small part of a 4K picture, a reader that scales the frame down loses the detail anyway. Filling the picture with the code does more than adding pixels around it.</p>
<h2>3. The codes change faster than the camera films</h2>
<p>Most phones record 30 frames a second. If the screen shows 60 different codes a second, most video frames catch two codes at once, blended, and neither reads. Showing each code for at least two camera frames avoids this. Kionel's recording mode shows 20 codes a second for that reason, and its colour code 15.</p>
<h2>4. The browser tab went to the background</h2>
<p>Reading a video in a browser relies on the browser handing each frame to the page. Browsers stop doing that for a tab in the background, while the video itself keeps playing. The frames go by unread, and the reading stalls. In one of our tests this happened at 99%, when the tab was switched to check the sending screen. Keep the reading tab in front; Kionel now pauses the reading while the tab is hidden and continues when you come back.</p>
<h2>5. The picture itself</h2>
<ul>
<li><strong>Distance:</strong> 30 to 50 cm from the screen, with the whole code in the picture and no digital zoom.</li>
<li><strong>Glare:</strong> a lamp or window reflected in the screen hides modules; tilt the phone slightly.</li>
<li><strong>Focus:</strong> tap the code on the phone screen before recording to lock focus.</li>
<li><strong>Moiré:</strong> wavy stripes over the screen mean the camera and pixel grids interfere; move a little closer or further.</li>
</ul>
<h2>How long to film</h2>
<p>A file needs a certain number of different codes; <a href="/qr-code-capacity-file-transfer.html">the capacity guide</a> gives the figures. With a fountain code, any codes will do, in any order, so a recording that was too short can be followed by a second one. If only a few codes are read from a long video, filming longer will not help: the picture is the problem, and one of the causes above applies.</p>
<p>Kionel measures this for you: when a recording ends early it says how many more seconds to film, and when the codes are too few to extrapolate from, it says the picture is the issue and, for a shrunk video, that it was shrunk.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/offline-package.html">Offline package</a></div>` },
  { slug: "ekran-kaydi-qr-okunmuyor", guide: true, title: "Ekran kaydındaki QR kodlar neden okunmaz, nasıl düzeltilir", description: "Mesajlaşma uygulaması videoyu küçültür, 4K ve 60 fps çoğu zaman HEVC'dir, kodlar kameradan hızlı değişir, sekme arka planda kalır. Ölçülmüş örneklerle beş neden ve her birinin çözümü.", body: `
<p class="eyebrow">REHBER · 2026</p><h1>Ekran kaydındaki QR kodlar neden okunmaz</h1>
<p class="lead">QR kod akışı gösteren bir ekranı telefonla çekip videoyu sonra okutmak, ağı ve kamerası olmayan bir bilgisayardan dosya çıkarmanın pratik bir yoludur. Okunmadığında sorun neredeyse hiçbir zaman kodlarda değil, videoya yolda olanlardadır.</p>
<p>Yazan: Taha Bayar, biyolog; laboratuvar verisinin teslimi üzerine çalışıyor. Örnekler kendi test kayıtlarımızdan.</p>
<h2>1. Video yolda küçültüldü</h2>
<p>11 saniyelik, 1080 × 1920, 29 MB'lık bir telefon kaydı bilgisayara WhatsApp ile gönderildi. 478 × 850 çözünürlükte, yaklaşık 1,9 Mbit/s ve 2,6 MB olarak ulaştı. 177 × 177 hücrelik yoğun bir QR kodunda hücre başına üç pikselden az kalır; hiçbir okuyucu bunu güvenle çözemez. Aynı videonun kabloyla kopyalanan özgün hâli sorunsuz okundu.</p>
<p>Mesajlaşma uygulamaları ve çoğu e-posta servisi videoyu yeniden sıkıştırır. Özgün dosyayı taşıyın: USB kablosu (Windows'ta telefon Bu Bilgisayar altında görünür, videolar DCIM klasöründedir), Quick Share veya AirDrop; WhatsApp kullanılacaksa video olarak değil <em>belge</em> olarak gönderin.</p>
<h2>2. Biçim 4K, 60 fps ya da HEVC</h2>
<p>Birçok telefon 4K veya 60 fps kaydı HEVC (H.265) biçiminde yapar. Tarayıcı HEVC'yi ancak bilgisayarın donanımı destekliyorsa oynatır; oynatamadığı dosyadan hiç kare alamaz. 1080p ve 30 fps çekin. iPhone'da <em>Ayarlar → Kamera → Biçimler → En Uyumlu</em> seçeneği H.264 kaydeder.</p>
<h2>3. Kodlar kameranın çekebileceğinden hızlı değişiyor</h2>
<p>Telefonların çoğu saniyede 30 kare kaydeder. Ekran saniyede 60 farklı kod gösterirse karelerin çoğu iki kodu üst üste yakalar ve ikisi de okunmaz. Her kod en az iki kamera karesi boyunca ekranda kalmalı. Kionel'in kayıt modu bu yüzden saniyede 20, renkli kodu 15 kod gösterir.</p>
<h2>4. Tarayıcı sekmesi arka plana geçti</h2>
<p>Videoyu tarayıcıda okumak, tarayıcının her kareyi sayfaya vermesine dayanır. Arka plandaki sekmeye tarayıcı kare vermez, ama video oynamaya devam eder; kareler okunmadan geçer ve okuma takılır. Testlerimizden birinde bu, gönderen ekrana bakmak için sekme değiştirildiğinde %99'da oldu. Okuyan sekmeyi önde tutun; Kionel artık sekme gizliyken okumayı duraklatıp geri dönüldüğünde sürdürüyor.</p>
<h2>5. Görüntünün kendisi</h2>
<ul>
<li><strong>Mesafe:</strong> ekrandan 30–50 cm, kodun tamamı kadrajda, dijital yakınlaştırma yok.</li>
<li><strong>Parlama:</strong> ekrana yansıyan lamba ya da pencere hücreleri gizler; telefonu hafifçe eğin.</li>
<li><strong>Odak:</strong> çekmeden önce telefon ekranında koda dokunup odağı sabitleyin.</li>
<li><strong>Moiré:</strong> ekranda dalgalı çizgiler varsa kamera ve piksel ızgaraları çakışıyordur; biraz yaklaşın ya da uzaklaşın.</li>
</ul>
<h2>Ne kadar çekmeli</h2>
<p>Her dosya belli sayıda farklı kod ister. Fountain kod sayesinde hangi kodların hangi sırayla yakalandığı önemli değildir; kısa kalan bir kaydın ardından ikinci bir kayıt eklenebilir. Uzun bir videodan yalnızca birkaç kod okunuyorsa daha uzun çekmek çözmez: sorun görüntüdedir ve yukarıdaki nedenlerden biri geçerlidir. Kionel bunu ölçer ve kayıt kısa kaldığında kaç saniye daha çekileceğini, görüntü yetersizse de bunu söyler.</p>
<div class="actions"><a class="button" href="/transfer.html">Ücretsiz başla</a><a class="button secondary" href="/offline-package.html">Çevrimdışı paket</a></div>` },
  { slug: "cdn-changed-download-sha256", lang: "en", guide: true, title: "Our host changed our downloads: how a SHA-256 check caught it", description: "Cloudflare's free plan added its analytics script to every HTML response, including a downloadable app file, so its SHA-256 stopped matching. Why curl did not show it, how to detect it, and the one header that stops it.", body: `
<p class="eyebrow">ENGINEERING NOTE · 2026</p><h1>Our host changed our downloads. A SHA-256 check caught it.</h1>
<p class="lead">We publish the SHA-256 of every version of our offline package, so a laboratory can check the file before it goes onto an isolated PC. The first time a user checked a browser download, it did not match. Nothing was wrong with our build. The file had been changed on the way.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover.</p>
<h2>What had changed</h2>
<p>The downloaded file was 367 bytes longer than the published one. The difference was one line before the closing body tag: a script tag loading <code>beacon.min.js</code> from <code>static.cloudflareinsights.com</code>, Cloudflare's Web Analytics (real user measurement) beacon. We had never added it. On our free-plan zone, Cloudflare inserts it into HTML responses at the edge, and its dashboard showed the feature as enabled for our hostname although we had not switched it on.</p>
<h2>Why our own check missed it</h2>
<p>We had checked the live site with <code>curl</code> and seen no script. The edge adds it only to requests that look like a browser. With a browser user agent and <code>Accept: text/html</code>, every HTML page carried it, including the downloadable package; with plain curl, none did. Test what your users receive, with a real browser or browser-like headers:</p>
<p><code>curl -A "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0" -H "Accept: text/html" https://example.com/ | grep cloudflareinsights</code></p>
<h2>Why it mattered</h2>
<ul>
<li><strong>The download no longer matched its published hash</strong>, which is exactly what a hash check is for. A user who skipped the check would have installed a file that was not the one we tested.</li>
<li><strong>The file could connect to the internet.</strong> Opened from disk on a connected PC, the injected script loaded from Cloudflare. For software whose promise is that it contacts no service, that is a broken promise.</li>
<li><strong>Our pages were protected, the file was not.</strong> On the website, our Content Security Policy blocked the script from running. A file opened from disk has no server headers, so nothing blocked it.</li>
</ul>
<h2>What stopped it</h2>
<ol>
<li><strong><code>Cache-Control: no-transform</code> on every response.</strong> It tells intermediaries, Cloudflare included, not to modify the body. Since adding it, browser-like requests receive our files byte for byte. It lives in our repository, so a dashboard setting cannot undo it.</li>
<li><strong>A Content Security Policy inside the file itself.</strong> The offline package carries its own policy that allows no outside script or connection. We tested it by injecting the same beacon into a copy: the request was blocked.</li>
<li><strong>The dashboard switch, as a second layer.</strong> In Cloudflare, the setting only appears after the site is added to Web Analytics; then <em>Manage site → Disable</em>.</li>
<li><strong>A release test that downloads like a user.</strong> After every deployment a headless browser downloads the package from the public page and compares its SHA-256 with the published value.</li>
</ol>
<h2>If you distribute files for validated systems</h2>
<p>Publish the SHA-256, and check it the way your users will receive the file, not the way your build server sees it. You can check a file in your browser, without uploading it, with our <a href="/sha256-file-checksum.html">SHA-256 checker</a>. What changed and when is in our <a href="/changelog.html">changelog</a>.</p>
<div class="actions"><a class="button" href="/offline-package.html">Offline package and its hashes</a><a class="button secondary" href="/validation-pack.html">Validation pack</a></div>` },
  { slug: "send-file-pc-to-phone-without-internet", lang: "en", guide: true, title: "Send a file from a PC to a phone without internet, a cable or Bluetooth", description: "Move a file from a computer to a phone using only the screen and the phone's camera: no internet on the PC, no cable, no Bluetooth, no account. Step by step, with real timings and honest limits.", body: `
<p class="eyebrow">HOW TO · FREE</p><h1>From a PC to a phone with no internet, no cable and no Bluetooth</h1>
<p class="lead">The PC shows the file as a stream of codes on its screen; the phone reads them with its camera. Nothing is uploaded, nothing is paired, and the PC does not need a network connection or a camera.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. The steps use Kionel, which is free and open source.</p>
<h2>What you need</h2>
<ul>
<li>The PC with the file, its screen and keyboard. It opens <strong>kionel.com</strong> once, or runs the <a href="/offline-package.html">offline package</a> if it can never go online.</li>
<li>A phone or tablet with a camera and a current browser (Chrome, Edge, Firefox or Safari).</li>
<li>No account, no app to install.</li>
</ul>
<h2>Step by step</h2>
<ol>
<li><strong>On the phone</strong>, open kionel.com/transfer.html, tap <em>Receive</em>, then <em>Sender has no camera — show a code</em>. A 12-character code appears.</li>
<li><strong>On the PC</strong>, open the same page, press <em>Choose file</em> (up to 5 MB in the free edition), type the phone's code under <em>This PC has no camera?</em> and press <em>Send with this code</em>. Accept the flashing-images warning.</li>
<li><strong>Point the phone's camera at the PC screen</strong>, 30 to 50 cm away, with the whole code in view. The bar fills; when it is full, the phone offers the file to download.</li>
</ol>
<h2>How long it takes</h2>
<p>In our tests a 117 KB file arrived in 10 to 24 seconds with the phone reading live. Text files such as CSV shrink before sending, so they go faster than their size suggests; photos and ZIP files do not shrink. The page shows its own estimate for your file before you start.</p>
<h2>Why the code is typed on the PC</h2>
<p>A screen can only show, not listen. The code is how the PC learns whom to encrypt for: the file is locked with a key derived from it, so another phone filming the screen gets nothing it can open.</p>
<h2>Limits, honestly</h2>
<ul>
<li>It suits documents, results and configuration files, not videos or photo albums. For those, a cable is faster when one is allowed.</li>
<li>Kionel sends files up to 64 MB; the faster recording and colour-code modes and signed records are included.</li>
<li>The phone must see the whole code clearly; glare and distance matter more than the phone model.</li>
</ul>
<h2>Other ways, and when they fit</h2>
<div class="table-scroll"><table><thead><tr><th>Way</th><th>Fits when</th></tr></thead><tbody>
<tr><td>USB cable</td><td>The PC allows removable devices and you have the cable.</td></tr>
<tr><td>Bluetooth</td><td>Both have it switched on and pairing is allowed.</td></tr>
<tr><td>E-mail or cloud</td><td>The PC is online.</td></tr>
<tr><td>A single QR code</td><td>It is a few hundred characters of text, not a file.</td></tr>
<tr><td>Screen to camera (above)</td><td>None of the above is possible or allowed.</td></tr>
</tbody></table></div>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/screen-recording-qr-codes-not-scanning.html">If it does not read</a></div>` },
  { slug: "internetsiz-bilgisayardan-telefona-dosya-aktarma", guide: true, title: "İnternetsiz, kablosuz ve Bluetooth'suz bilgisayardan telefona dosya aktarma", description: "Bir dosyayı yalnızca ekran ve telefon kamerasıyla bilgisayardan telefona aktarın: bilgisayarda internet, kablo, Bluetooth ve hesap gerekmez. Adım adım, gerçek sürelerle ve sınırlarıyla.", body: `
<p class="eyebrow">NASIL YAPILIR · ÜCRETSİZ</p><h1>İnternet, kablo ve Bluetooth olmadan bilgisayardan telefona dosya</h1>
<p class="lead">Bilgisayar dosyayı ekranında bir kod akışı olarak gösterir, telefon bu kodları kamerasıyla okur. Hiçbir şey yüklenmez, eşleştirme yapılmaz; bilgisayarın ağa ya da kameraya ihtiyacı yoktur.</p>
<p>Yazan: Taha Bayar, biyolog; laboratuvar verisinin teslimi üzerine çalışıyor. Adımlar Kionel'in ücretsiz kişisel sürümüyle yapılır; uygulamanın arayüzü İngilizcedir, düğme adları aşağıda aynen yazılıdır.</p>
<h2>Gerekenler</h2>
<ul>
<li>Dosyanın bulunduğu bilgisayar, ekranı ve klavyesi. Bir kez <strong>kionel.com</strong>'u açar; hiç internete çıkamıyorsa <a href="/offline-package.html">çevrimdışı paketi</a> kullanır.</li>
<li>Kameralı bir telefon ya da tablet ve güncel bir tarayıcı (Chrome, Edge, Firefox veya Safari).</li>
<li>Hesap açmak ya da uygulama kurmak gerekmez.</li>
</ul>
<h2>Adım adım</h2>
<ol>
<li><strong>Telefonda</strong> kionel.com/transfer.html adresini açın, <em>Receive</em>'e, ardından <em>Sender has no camera — show a code</em>'a dokunun. 12 karakterlik bir kod çıkar.</li>
<li><strong>Bilgisayarda</strong> aynı sayfayı açın, <em>Choose file</em> ile dosyayı seçin (ücretsiz sürümde en fazla 5 MB), telefondaki kodu <em>This PC has no camera?</em> bölümüne yazın ve <em>Send with this code</em>'a basın. Yanıp sönen görüntü uyarısını onaylayın.</li>
<li><strong>Telefonun kamerasını bilgisayar ekranına tutun</strong>: 30–50 cm uzaklıktan, kodun tamamı görünecek şekilde. Çubuk dolunca telefon dosyayı indirmeniz için sunar.</li>
</ol>
<h2>Ne kadar sürer</h2>
<p>Testlerimizde 117 KB'lık bir dosya, telefon canlı okurken 10 ile 24 saniyede geldi. CSV gibi metin dosyaları gönderilmeden önce küçülür, bu yüzden boyutlarının düşündürdüğünden hızlı gider; fotoğraf ve ZIP dosyaları küçülmez. Sayfa başlamadan önce dosyanız için kendi tahminini gösterir.</p>
<h2>Kod neden bilgisayara yazılıyor</h2>
<p>Ekran yalnızca gösterebilir, dinleyemez. Bilgisayar kimin için şifreleyeceğini bu koddan öğrenir: dosya bu koddan türetilen bir anahtarla kilitlenir, ekranı çeken başka bir telefon açabileceği hiçbir şey elde etmez.</p>
<h2>Sınırlar</h2>
<ul>
<li>Belge, sonuç ve ayar dosyaları için uygundur; video ya da fotoğraf arşivi için değil. Onlar için izin varsa kablo daha hızlıdır.</li>
<li>Kionel 64 MB'a kadar dosya gönderir; daha hızlı kayıt ve renkli kod yöntemleri ile imzalı kayıtlar dahildir.</li>
<li>Telefon kodun tamamını net görmelidir; parlama ve mesafe telefon modelinden daha çok etkiler.</li>
</ul>
<h2>Diğer yollar ve ne zaman uygun oldukları</h2>
<div class="table-scroll"><table><thead><tr><th>Yol</th><th>Uygun olduğu durum</th></tr></thead><tbody>
<tr><td>USB kablosu</td><td>Bilgisayar harici cihaza izin veriyor ve kablo elinizde.</td></tr>
<tr><td>Bluetooth</td><td>İkisinde de açık ve eşleştirmeye izin var.</td></tr>
<tr><td>E-posta veya bulut</td><td>Bilgisayar internete bağlı.</td></tr>
<tr><td>Tek bir QR kod</td><td>Aktarılan şey dosya değil, birkaç yüz karakterlik metin.</td></tr>
<tr><td>Ekrandan kameraya (yukarıdaki)</td><td>Yukarıdakilerin hiçbiri mümkün ya da izinli değil.</td></tr>
</tbody></table></div>
<div class="actions"><a class="button" href="/transfer.html">Ücretsiz başla</a><a class="button secondary" href="/ekran-kaydi-qr-okunmuyor.html">Okunmazsa</a></div>` },
  { slug: "excel-damage-check", lang: "en", guide: true, head: '<script type="module" src="/src/excel-check-page.ts"></script>', title: "Check a CSV for Excel damage: genes turned into dates, lost zeros, cut barcodes", description: "Free check, in your browser, nothing uploaded: finds gene names and well positions Excel turned into dates, IDs in scientific notation, digits lost after the 15th, removed leading zeros and garbled characters. Add the original file to see every changed cell.", body: `
<p class="eyebrow">FREE TOOL · NOTHING UPLOADED</p><h1>Check a CSV for Excel damage</h1>
<p class="lead">Drop a CSV that has been through Excel. This page looks for what Excel leaves behind: SEPT2 turned into 2-Sep, a barcode turned into 1.23457E+18, sample 00123 turned into 123. The file is read in this browser tab and never uploaded, so it is safe for unpublished results and patient-adjacent data.</p>
<label class="drop" id="xl-after-drop"><input type="file" id="xl-after-file" accept=".csv,.txt,.tsv,text/csv,text/plain"><span>Drop the CSV to check, or click to choose</span></label>
<button type="button" class="button secondary drop-clear" id="xl-after-clear" hidden>Remove this file</button>
<label class="drop" id="xl-original-drop"><input type="file" id="xl-original-file" accept=".csv,.txt,.tsv,text/csv,text/plain"><span>Optional: drop the original file, before Excel</span></label>
<button type="button" class="button secondary drop-clear" id="xl-original-clear" hidden>Remove the original</button>
<p id="xl-status" class="evidence-status" role="status" hidden></p>
<div id="xl-result" hidden><ul id="xl-summary"></ul>
<div class="table-scroll"><table id="xl-table"></table></div><p id="xl-more" class="note"></p>
<p><button type="button" class="button secondary" id="xl-download">Download the findings (CSV)</button></p></div>
<p>Written by Taha Bayar, a biologist working on laboratory data handover.</p>
<h2>One file, or two</h2>
<p><strong>With one file</strong> the page looks for traces and says what the value probably was. That is a strong hint, not proof: a date in a date column is not damage, and a value Excel changed into another ordinary-looking value leaves no trace.</p>
<p><strong>With the original as well</strong> it compares every cell and names the reason for each difference. If the two files are identical byte for byte, it says so; if every value matches but the bytes differ, the file was re-saved (quotes, line endings or encoding changed), and its <a href="/sha256-file-checksum.html">SHA-256</a> no longer matches.</p>
<h2>What it looks for</h2>
<div class="table-scroll"><table><thead><tr><th>Finding</th><th>Example</th><th>How it is recognised</th></tr></thead><tbody>
<tr><td>Gene name turned into a date</td><td><code>1-Mar</code>, <code>Sep-15</code></td><td>A day and month in the form Excel writes; March, September and December with the numbers the affected genes carry. It suggests the old and the current HGNC name.</td></tr>
<tr><td>Text turned into a date</td><td><code>2-Jan</code>, <code>01.Ara</code></td><td>Well positions and ratios like <code>1-2</code> in English Excel; decimals like <code>1.12</code> in Turkish or German Excel.</td></tr>
<tr><td>Long number in scientific notation</td><td><code>1.23457E+18</code></td><td>Excel's own display for numbers of 12 digits or more. Real measurements such as <code>1.2E-05</code> are left alone.</td></tr>
<tr><td>Digits lost after the 15th</td><td><code>1234567890123450000</code></td><td>Sixteen digits or more, all zeros from the 16th on.</td></tr>
<tr><td>Leading zeros removed</td><td><code>126</code> among <code>00123</code>, <code>00124</code></td><td>A shorter plain number in a column that is mostly zero-padded.</td></tr>
<tr><td>Garbled characters</td><td><code>Ã¼</code> for ü, <code>Âµ</code> for µ</td><td>UTF-8 read as a Western code page. A file that is not UTF-8 at all is reported too.</td></tr>
</tbody></table></div>
<h2>What it cannot see</h2>
<ul>
<li>Precision: <code>0.80</code> saved as <code>0.8</code> is the same number. Only the comparison shows it.</li>
<li>A value turned into another value that looks normal, such as a date column re-written in a different date format.</li>
<li>Formats other than CSV and text. An .xlsx has already been through Excel; export it as CSV UTF-8 first.</li>
</ul>
<p>Why Excel does all this, and how to switch it off, is in <a href="/excel-csv-changes-lab-data.html">Why a CSV changes when Excel opens it</a>. The way to never need this page is to move the instrument's file as bytes and take its SHA-256 at the source; that is what Kionel does for offline instrument PCs.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/excel-csv-changes-lab-data.html">Read the guide</a></div>` },
  { slug: "excel-bozulma-kontrolu", guide: true, head: '<script type="module" src="/src/excel-check-page.ts"></script>', title: "CSV'de Excel hasarı kontrolü: tarihe dönen genler, silinen sıfırlar, kesilen barkodlar", description: "Ücretsiz, tarayıcıda, hiçbir şey yüklenmez: Excel'in tarihe çevirdiği gen adlarını ve ondalıkları, bilimsel gösterime dönen kimlikleri, 15. haneden sonra kaybolan basamakları, silinen baştaki sıfırları ve bozuk karakterleri bulur. Özgün dosyayı da ekleyin, değişen her hücreyi görün.", body: `
<p class="eyebrow">ÜCRETSİZ ARAÇ · HİÇBİR ŞEY YÜKLENMEZ</p><h1>CSV'de Excel hasarı kontrolü</h1>
<p class="lead">Excel'den geçmiş bir CSV'yi bırakın. Bu sayfa Excel'in bıraktığı izleri arar: <code>1.12</code> değerinin 01.Ara olması, barkodun 1,23457E+18 olması, 00123 numunesinin 123 olması. Dosya bu sekmede okunur, hiçbir yere yüklenmez; yayımlanmamış sonuçlar için de güvenlidir.</p>
<label class="drop" id="xl-after-drop"><input type="file" id="xl-after-file" accept=".csv,.txt,.tsv,text/csv,text/plain"><span>Denetlenecek CSV'yi bırakın ya da tıklayıp seçin</span></label>
<button type="button" class="button secondary drop-clear" id="xl-after-clear" hidden>Bu dosyayı kaldır</button>
<label class="drop" id="xl-original-drop"><input type="file" id="xl-original-file" accept=".csv,.txt,.tsv,text/csv,text/plain"><span>İsteğe bağlı: özgün dosyayı, Excel'den önceki halini bırakın</span></label>
<button type="button" class="button secondary drop-clear" id="xl-original-clear" hidden>Özgün dosyayı kaldır</button>
<p id="xl-status" class="evidence-status" role="status" hidden></p>
<div id="xl-result" hidden><ul id="xl-summary"></ul>
<div class="table-scroll"><table id="xl-table"></table></div><p id="xl-more" class="note"></p>
<p><button type="button" class="button secondary" id="xl-download">Bulguları indir (CSV)</button></p></div>
<p>Yazan: Taha Bayar, biyolog; laboratuvar verisinin teslimi üzerine çalışıyor.</p>
<h2>Tek dosya mı, iki dosya mı</h2>
<p><strong>Tek dosyayla</strong> sayfa izleri arar ve değerin muhtemelen ne olduğunu söyler. Bu güçlü bir ipucudur, kanıt değildir: tarih sütunundaki tarih hasar değildir, Excel'in sıradan görünen başka bir değere çevirdiği hücre de iz bırakmaz.</p>
<p><strong>Özgün dosyayı da eklerseniz</strong> her hücreyi karşılaştırır ve her farkın nedenini yazar. İki dosya bayt bayt aynıysa bunu söyler; bütün değerler aynı ama baytlar farklıysa dosya yeniden kaydedilmiştir (tırnak, satır sonu ya da kodlama değişmiştir) ve <a href="/sha256-file-checksum.html">SHA-256</a> özeti artık tutmaz.</p>
<h2>Neleri arar</h2>
<div class="table-scroll"><table><thead><tr><th>Bulgu</th><th>Örnek</th><th>Nasıl anlaşılır</th></tr></thead><tbody>
<tr><td>Tarihe dönmüş ondalık</td><td><code>01.Ara</code>, <code>12.May</code></td><td>Türkçe Excel noktalı ondalığı tarih sayar: <code>1.12</code> 1 Aralık, <code>12.5</code> 12 Mayıs olur. Sayfa özgün değeri yazar.</td></tr>
<tr><td>Tarihe dönmüş gen adı</td><td><code>1-Mar</code>, <code>Sep-15</code></td><td>İngilizce Excel'in yazdığı gün-ay biçimi; etkilenen genlerin taşıdığı numaralarla Mart, Eylül ve Aralık. Eski ve güncel HGNC adını önerir.</td></tr>
<tr><td>Bilimsel gösterime dönmüş uzun sayı</td><td><code>1.23457E+18</code></td><td>Excel'in 12 ve daha uzun haneli sayıları gösterme biçimi. <code>1.2E-05</code> gibi gerçek ölçüm değerlerine dokunulmaz.</td></tr>
<tr><td>15. haneden sonrası kaybolmuş</td><td><code>1234567890123450000</code></td><td>16 ya da daha çok hane, 16. haneden sonrası hep sıfır.</td></tr>
<tr><td>Baştaki sıfırlar silinmiş</td><td><code>00123</code>, <code>00124</code> arasında <code>126</code></td><td>Çoğu sıfırla doldurulmuş bir sütunda daha kısa kalan sayı.</td></tr>
<tr><td>Bozuk karakter</td><td>ü yerine <code>Ã¼</code>, ı yerine <code>Ä±</code></td><td>UTF-8'in eski kod sayfasıyla okunması. Hiç UTF-8 olmayan dosya da ayrıca söylenir.</td></tr>
</tbody></table></div>
<h2>Neyi göremez</h2>
<ul>
<li>Hassasiyet: <code>0.80</code> değerinin <code>0.8</code> olarak kaydedilmesi aynı sayıdır. Bunu yalnız karşılaştırma gösterir.</li>
<li>Normal görünen başka bir değere dönmüş hücre; örneğin tarih sütununun farklı bir tarih biçimiyle yeniden yazılması.</li>
<li>CSV ve metin dışındaki biçimler. .xlsx dosyası zaten Excel'den geçmiştir; önce CSV UTF-8 olarak dışa aktarın.</li>
</ul>
<p>Excel'in bunu neden yaptığı ve nasıl kapatılacağı <a href="/excel-csv-veri-bozulmasi.html">Excel CSV dosyasını neden değiştirir?</a> rehberinde. Bu sayfaya hiç ihtiyaç duymamanın yolu cihazın dosyasını bayt olarak taşımak ve SHA-256'sını kaynakta almaktır; Kionel çevrimdışı cihaz bilgisayarları için bunu yapar.</p>
<div class="actions"><a class="button" href="/transfer.html">Ücretsiz başla</a><a class="button secondary" href="/excel-csv-veri-bozulmasi.html">Rehberi okuyun</a></div>` },
  { slug: "pair-devices-by-sound", lang: "en", guide: true, title: "Pair two devices by sound when the sending PC has no camera", description: "How Kionel pairs a phone with a PC that has a microphone but no camera: the phone plays a six-second pairing sound, the PC hears it, and both screens show a comparison code. The signed delivery receipt comes back by sound too. What travels by sound, what never does, and when it will not work.", body: `
<p class="eyebrow">GUIDE</p><h1>Pair two devices by sound when the sending PC has no camera</h1>
<p class="lead">To send a file securely, the two devices first have to agree on a key. Normally the sending PC scans a code on the receiver's screen. A PC without a camera cannot do that, so until now someone typed a 12-character code. If the PC has a microphone, the receiving device can instead play its pairing offer as sound: about six seconds of tones, and nothing to type.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover.</p>
<h2>How to do it</h2>
<ol>
<li>On the sending PC, open Kionel, choose the file and, under <strong>This PC has no camera?</strong>, press <strong>Listen for the receiver</strong>. The browser asks for the microphone.</li>
<li>On the receiving device, choose <strong>Receive → Sender has no camera — show a code</strong> and press <strong>Pair by sound</strong>. Turn the volume up and hold its speaker near the PC's microphone. The sound repeats until it is heard.</li>
<li>The PC shows a reply code on its screen. Point the receiving device's camera at it.</li>
<li>Both screens now show the same six digits and symbols. Compare them, press <strong>Codes match</strong> on both, and the file is sent as usual.</li>
<li>When the file has arrived, the receiving device plays the signed delivery receipt as sound. On the PC press <strong>Listen for the delivery receipt</strong>; it shows <em>Delivery verified</em> and offers the receipt for download.</li>
</ol>
<p>The sound stops by itself when the reply is read, and after 90 seconds in any case, because a pairing offer is only valid for two minutes.</p>
<h2>What travels by sound, and what never does</h2>
<p>The sound carries the receiver's pairing offer: its public keys, a random number, the time and a signature. It is the same 170-byte record that is otherwise shown as a QR code, and it contains nothing secret. Someone recording the room learns nothing they could use to read the file.</p>
<p>Someone could play a forged offer of their own, louder. Then the two screens would show different comparison codes, which is exactly what the comparison is for. <strong>Do not skip it.</strong></p>
<p>The 12-character transfer code is different: it is a secret, and Kionel never plays it as sound. Sound reaches further than a screen can be seen, through an open door or into a phone in someone's pocket, so a secret has no place in it.</p>
<h2>The file goes by light, the proof comes back by sound</h2>
<p>A delivery receipt is the receiving device's signed statement that it received exactly this file. Normally the receiver shows it as a code and the sending PC scans it. A PC without a camera could not, so the proof stayed on the phone and the PC's own record ended at "sent".</p>
<p>The receipt has only two parts the PC does not already know: the receiver's signature and the moment it signed. The file's fingerprint, its size, both public keys and the dispatch record are already on the PC. So the receiving device plays just 77 bytes, the transfer number, the time and the signature, in about four seconds. The PC puts the receipt back together from what it knows and checks the signature. It is the same signature that the code on the screen would have carried; no new format is involved, and the receipt is checked like any other.</p>
<p>If the receiver got a different file, the signature does not fit the file the PC sent. A receipt recorded from an earlier transfer carries a different transfer number. An imitated sound has no valid signature at all. In each case the PC says what it heard, refuses it and keeps listening.</p>
<p>The sound repeats for a minute and can be played again. If it is never heard, nothing is lost: the file was delivered, and the signed receipt can be exported on the receiving device.</p>
<h2>How the sound works</h2>
<div class="table-scroll"><table><thead><tr><th></th><th></th></tr></thead><tbody>
<tr><td>Frequencies</td><td>64 tones between 1.5 and 5.5 kHz, clearly audible; four tones at a time</td></tr>
<tr><td>Speed</td><td>40 bytes a second; a pairing offer takes about 6 seconds, a delivery receipt about 4</td></tr>
<tr><td>Error correction</td><td>Reed–Solomon: 16 damaged bytes in a frame are repaired</td></tr>
<tr><td>Measured in tests</td><td>Decoded with noise as loud as the signal, with room echo, at one hundredth of the volume, and between devices with different audio sample rates</td></tr>
</tbody></table></div>
<p>The idea is the acoustic modem of the telephone era, and open-source libraries such as ggwave use the same principle for short messages. It is far too slow for files, about a thousand times slower than the screen, which is why the file never uses it: sound carries the two short messages a PC without a camera cannot otherwise receive, the pairing offer and the delivery receipt.</p>
<h2>When it will not work</h2>
<ul>
<li><strong>No microphone.</strong> Many desktop and instrument PCs have none. Type the code shown on the receiver instead; that always works.</li>
<li><strong>Microphone blocked.</strong> If the browser or a site policy refuses the microphone, Kionel says so and the typed code remains.</li>
<li><strong>Clocks more than two minutes apart.</strong> A pairing offer is refused when it looks older than two minutes. An isolated PC whose clock has drifted hears the sound and reports this; correct the clock or type the code.</li>
<li><strong>Headsets in call mode.</strong> Bluetooth headsets often pass only speech frequencies and process the sound; use the PC's own microphone.</li>
</ul>
<h2>Privacy</h2>
<p>The microphone is on only between pressing <em>Listen for the receiver</em> or <em>Listen for the delivery receipt</em> and the moment the sound is heard or you press <em>Stop listening</em>. The audio is decoded in memory on that page. It is not recorded, not stored and not sent anywhere; the <a href="/offline-package.html">offline package</a> does the same without any network at all.</p>
<p>Other ways to send without a camera: a <a href="/offline-pc-to-phone-file-transfer.html">typed code</a>, <a href="/print-file-as-qr-codes.html">printed pages</a>, or a <a href="/serial-data-diode.html">one-way serial cable</a>.</p>
<div class="actions"><a class="button" href="/transfer.html">Open Kionel</a><a class="button secondary" href="/limits.html">Limits</a></div>` },
  { slug: "serial-data-diode", lang: "en", guide: true, title: "A one-way serial cable as a low-cost data diode for file transfer", description: "Move files off an isolated PC over an RS-232 cable with the return wire left out, so nothing can travel back. Wiring, speeds, transfer times, the limits compared with a certified data diode, and how Kionel sends over it from a browser.", body: `
<p class="eyebrow">GUIDE</p><h1>A one-way serial cable as a low-cost data diode</h1>
<p class="lead">A data diode lets data leave a network and makes it physically impossible for anything to come back. Commercial diodes are appliances bought as an IT project. For moving files off one isolated PC, the same physical idea fits in a serial cable: connect the sender's transmit line to the receiver's receive line, and leave the other direction unconnected.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover.</p>
<h2>The wiring</h2>
<p>On a standard 9-pin serial connector (DB9), a PC sends on pin 3 (TXD), receives on pin 2 (RXD), and pin 5 is signal ground. A one-way cable has only two wires:</p>
<div class="table-scroll"><table><thead><tr><th>Sending PC (isolated)</th><th></th><th>Receiving PC</th></tr></thead><tbody>
<tr><td>Pin 3, TXD (transmit)</td><td>→</td><td>Pin 2, RXD (receive)</td></tr>
<tr><td>Pin 5, GND</td><td>—</td><td>Pin 5, GND</td></tr>
<tr><td>Pin 2, RXD</td><td>not connected</td><td>Pin 3, TXD</td></tr>
</tbody></table></div>
<p>Build it from two DB9 screw-terminal adapters and two wires, or open an ordinary null-modem cable and cut every wire except TXD→RXD and ground. With nothing connected to the sending PC's receive pin, there is no electrical path back, whatever software runs on either side. Label the cable with its direction; a reversed cable carries nothing.</p>
<h2>Speeds and transfer times</h2>
<p>Serial speed is set in baud; with 8 data bits, no parity and one stop bit, ten bits carry one byte. Kionel adds about 3% for framing and 10% of spare blocks.</p>
<div class="table-scroll"><table><thead><tr><th>Speed</th><th>About</th><th>1 MB takes</th><th>Where it works</th></tr></thead><tbody>
<tr><td>115,200 baud</td><td>10 KB/s</td><td>about 1 min 45 s</td><td>Every port, including a PC's built-in COM port</td></tr>
<tr><td>230,400 baud</td><td>20 KB/s</td><td>about 50 s</td><td>Most USB serial adapters</td></tr>
<tr><td>460,800 baud</td><td>40 KB/s</td><td>about 25 s</td><td>Most USB serial adapters</td></tr>
<tr><td>921,600 baud</td><td>80 KB/s</td><td>about 13 s</td><td>Adapters based on FTDI, CH340 and similar chips, over a short cable</td></tr>
</tbody></table></div>
<p>Both sides must use the same speed. The RS-232 standard is designed for about 15 m at low speeds; at the higher speeds keep the cable short, or step down a speed if frames are lost. Kionel reports when data arrives but no frames can be read, which is what a speed mismatch looks like.</p>
<h2>USB on both ends: a parts list</h2>
<p>Most PCs no longer have a 9-pin serial port. The same one-way link can be built between two USB ports:</p>
<ul>
<li><strong>Two USB-to-serial adapters</strong> with bare pins (often sold as "USB to TTL"), both for the same voltage, 3.3 V. Common chips are FTDI FT232, Silicon Labs CP2102N and WCH CH340.</li>
<li><strong>Two wires:</strong> the sending adapter's TX pin to the receiving adapter's RX pin, and GND to GND. Leave the sending adapter's RX pin and both power pins unconnected.</li>
</ul>
<p>Each PC sees its adapter as a serial port, and Kionel uses it exactly as above. The one-way property is the missing wire, as with the 9-pin cable; the adapters themselves are ordinary two-way USB devices, so the limits below apply.</p>
<p>The app also offers 1,500,000 and 3,000,000 baud as experimental speeds. They depend on the adapter chip and on short wires, and we have not measured them on hardware yet; if frames are lost, step down. For a supported continuous link, <a href="/contact.html">contact us</a>.</p>
<h2>Sending with Kionel</h2>
<ol>
<li>On the receiving PC, open Kionel in Chrome or Edge, choose <strong>Receive → Sender has no camera — show a code</strong> and <strong>Serial cable</strong>, set the speed and press <strong>Choose the serial port and listen</strong>.</li>
<li>On the isolated PC, open Kionel (the <a href="/offline-package.html">offline package</a> works), choose the file, type the receiver's code, open <strong>Send over a serial cable</strong>, set the same speed and press <strong>Choose the serial port and send</strong>.</li>
<li>The receiver checks the file against the signed dispatch record and signs the delivery receipt. With a <a href="/instrument-results-to-lims-offline.html">folder</a> chosen, the file and receipt are written straight into it.</li>
</ol>
<p>Because nothing comes back, the sender cannot know the receiver finished; after one full pass it stops and offers <em>Send more</em>, which continues the same transfer for a receiver that started late or lost data. The code or a <a href="/how-it-works.html">receiver card</a> is what keeps the content encrypted on the wire; the cable is what keeps the direction one-way.</p>
<h2>Unattended: watch a folder</h2>
<p>For files that appear on their own, such as logs, alarm exports and batch reports, the sending PC can watch a folder instead of a person choosing each file. Every new or changed file is encrypted to the receiving computer's card, signed and sent; the receiving computer, set to <em>Keep listening after each file</em> with a folder chosen, writes each file and its receipt there. A file still being written is left alone until it has not changed for two seconds.</p>
<h2>The other direction: into an isolated PC</h2>
<p>Turn the cable round and the isolated PC becomes the receiver: methods, recipes or reference files go in, and nothing can come out, because its transmit pin is not connected. That is the direction classified and safety networks usually care about. The isolated PC listens with the offline package; the outside computer sends. The delivery receipt is then made on the isolated side and stays there, where it can be printed or sealed.</p>
<h2>Who may send?</h2>
<p>A cable answers this physically: the sender is whatever is wired to the other end. The receiving computer can also answer it itself. After the first delivery, press <strong>Accept only this sender from now on</strong>: the receiver pins the key that signed the file, and from then on refuses anything signed by another key, names that key and saves nothing. A second sending PC can be added from the refusal message. This is key pinning, as in SSH, not certificates: it says which key may send, and a key copied from a compromised PC would still be accepted.</p>
<p>A transfer that is replayed byte for byte carries the same signed dispatch as before. The receiver recognises it from its transfer log and does not deliver it a second time.</p>
<h2>Did everything arrive?</h2>
<p>Nothing comes back over a one-way cable, so the sending PC never learns whether a file arrived. Diode vendors answer this by comparing the logs of both sides by hand. Kionel's records are signed on both sides, so the comparison can be checked: download the signed records on the sending and on the receiving computer and drop both on the <a href="/verify.html#link">verifier</a>. It lists every file the sender signed, with the receiver's verified receipt or without one. The sender's records are a file like any other and can be sent over the cable itself.</p>
<h2>How this differs from a certified data diode</h2>
<ul>
<li><strong>No certification.</strong> Commercial diodes carry evaluations such as Common Criteria and are built so the one-way property survives failures. A home-made cable is only as good as its wiring and its label.</li>
<li><strong>A USB adapter is a USB device.</strong> Where USB ports are locked, use the PC's built-in COM port at 115,200 baud, or have IT allow the specific adapter.</li>
<li><strong>It moves files, it does not bridge networks.</strong> No protocol conversion, no continuous replication between networks. For that, a diode is the right tool.</li>
<li><strong>Content is not scanned.</strong> What leaves the PC is what was on it. Kionel signs and checks the bytes; it does not inspect them.</li>
</ul>
<p>For files leaving an instrument PC a few times a day, those limits are usually acceptable, and each transfer still ends with a dispatch record and a delivery receipt an inspector can check. The <a href="/data-diode-vs-usb-lab.html">comparison of diodes, USB and optical transfer</a> helps with the wider choice.</p>
<div class="actions"><a class="button" href="https://github.com/Apeiron01/kionel">Source on GitHub</a><a class="button secondary" href="/transfer.html">Open Kionel</a></div>` },
  { slug: "print-file-as-qr-codes", lang: "en", guide: true, title: "Print a file as QR codes and scan it back with a phone", description: "Turn any small file into printed pages of encrypted QR codes in your browser, then restore it by pointing a phone camera at the pages in any order, or by opening photos or scans. For PCs with only a printer, and for paper backups. Nothing is installed or uploaded.", body: `
<p class="eyebrow">FREE · IN THE BROWSER</p><h1>Print a file as QR codes, and scan it back</h1>
<p class="lead">Some computers have a printer and nothing else: no network, no USB, no camera. Kionel prints a file as pages of encrypted QR codes; any phone with a browser reads the pages back, in any order, and rebuilds the file byte for byte. The same pages make a paper backup that can be restored years later.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover.</p>
<h2>How to print a file</h2>
<ol>
<li>Open <a href="/transfer.html">Kionel</a> on the computer with the printer (the <a href="/offline-package.html">offline package</a> works without a network) and choose the file.</li>
<li>Open <strong>No camera and no cable? Print the file as pages of codes</strong>, choose a density and press <strong>Print the file as codes</strong>.</li>
<li>Kionel shows a 12-character code. Write it down and keep it apart from the pages: the pages are encrypted and cannot be read without it. If a receiving device already showed you its code, type that one first and it is used instead.</li>
</ol>
<h2>How to read the pages back</h2>
<ol>
<li>On a phone or any computer, open Kionel, choose <strong>Receive → Printed pages</strong> and enter the code. You can also scan first; Kionel asks for the code when it has every code it needs, and a wrong code never throws away what was read.</li>
<li>Point the camera at the pages, one at a time, in any order. Or open photos or scans of the pages.</li>
<li>When enough codes are read, the file is rebuilt and checked against its signed record.</li>
</ol>
<h2>How much fits on a page</h2>
<div class="table-scroll"><table><thead><tr><th>Density</th><th>Codes a page</th><th>File data a page</th><th>Printer</th></tr></thead><tbody>
<tr><td>Standard</td><td>6, each about 6.4 cm</td><td>about 4 KB</td><td>Any laser or inkjet</td></tr>
<tr><td>Dense</td><td>12, each about 4.8 cm</td><td>about 11 KB</td><td>A laser printer at 600 dpi</td></tr>
</tbody></table></div>
<p>Text and CSV files are compressed before printing, often four to ten times, so a 40 KB instrument export usually fits on two or three standard pages. Kionel prints and reads up to 60 pages, and photos or scans of them can be opened too. Beyond that, larger files belong on a <a href="/serial-data-diode.html">serial cable</a> or a screen recording.</p>
<h2>What happens if a code is smudged or a page is torn</h2>
<p>About 30% of the codes are spares. They are not copies: each one mixes a third of the file, so it can stand in for whichever code is lost. In our tests, a 30 KB file still came back in 91% of 300 trials with eight of its 48 codes missing, and a 150 KB file in all of 100 trials with twelve missing. With ordinary random spares the same 30 KB file came back in 3%. If a read stops short, Kionel says how much it has and keeps it; scan the remaining pages.</p>
<h2>How safe the pages are</h2>
<ul>
<li>The file is encrypted with a key derived from the 12-character code (60 bits); every guess costs an attacker 600,000 PBKDF2 rounds.</li>
<li>With the option to print the code on the pages, anyone holding the pages can read the file. Leave it off for anything confidential.</li>
<li>For a backup kept for years, store the code as carefully as the file itself would need.</li>
</ul>
<h2>Compared with other paper backup tools</h2>
<p>Paper backup is not new. <strong>qr-backup</strong> (a Linux command-line tool) fits more on a page at its densest setting, and <strong>paperize</strong> and <strong>papyrus</strong> do the same from Python. Kionel's difference is where it runs: in a browser on the printing PC, and restored by pointing a phone at the pages, with no software to install on either side, plus a signed record of what was printed.</p>
<p>Backing up a password vault, 2FA codes or keys? See <a href="/encrypted-paper-backup.html">encrypted paper backup</a> for what fits and how to keep it safe.</p>
<div class="actions"><a class="button" href="/transfer.html">Print a file</a><a class="button secondary" href="/sha256-file-checksum.html">Check a SHA-256</a></div>` },
  { slug: "dosyayi-qr-kod-olarak-yazdir", guide: true, title: "Dosyayı QR kod olarak yazdırmak ve telefonla geri okumak", description: "Küçük bir dosyayı tarayıcıda şifreli QR kodlu sayfalar olarak yazdırın; telefon kamerasıyla sayfaları istediğiniz sırayla okutarak ya da fotoğraf ve taramalarını açarak dosyayı geri alın. Yalnız yazıcısı olan bilgisayarlar ve kâğıt yedek için. Kurulum ve yükleme yok.", body: `
<p class="eyebrow">ÜCRETSİZ · TARAYICIDA</p><h1>Dosyayı QR kod olarak yazdırın, telefonla geri okuyun</h1>
<p class="lead">Bazı bilgisayarlarda yazıcıdan başka bir şey yoktur: ağ yok, USB yasak, kamera yok. Kionel dosyayı şifreli QR kodlu sayfalar olarak basar; tarayıcısı olan herhangi bir telefon sayfaları istediği sırayla okuyup dosyayı bayt bayt yeniden kurar. Aynı sayfalar yıllar sonra geri okunabilecek bir kâğıt yedektir.</p>
<p>Yazan: Taha Bayar, biyolog; laboratuvar verisinin teslimi üzerine çalışıyor.</p>
<h2>Dosya nasıl yazdırılır</h2>
<ol>
<li>Yazıcılı bilgisayarda <a href="/transfer.html">Kionel</a>'i açın (<a href="/offline-package.html">çevrimdışı paket</a> ağsız çalışır) ve dosyayı seçin.</li>
<li><strong>No camera and no cable? Print the file as pages of codes</strong> bölümünü açın, yoğunluğu seçin ve <strong>Print the file as codes</strong> düğmesine basın.</li>
<li>Kionel 12 karakterlik bir kod gösterir. Kodu yazın ve sayfalardan ayrı saklayın: sayfalar şifrelidir, kod olmadan okunamaz. Alıcı cihaz size önceden bir kod gösterdiyse onu yazın; o kullanılır.</li>
</ol>
<h2>Sayfalar nasıl geri okunur</h2>
<ol>
<li>Telefonda ya da herhangi bir bilgisayarda Kionel'i açın, <strong>Receive → Printed pages</strong> seçin ve kodu yazın. Önce tarayıp kodu sonra da girebilirsiniz: gereken bütün kodlar okununca Kionel kodu sorar; yanlış kod okunanları silmez.</li>
<li>Kamerayı sayfalara tek tek, istediğiniz sırayla tutun. Sayfaların fotoğraflarını ya da taramalarını da açabilirsiniz.</li>
<li>Yeterli kod okununca dosya yeniden kurulur ve imzalı kaydına karşı denetlenir.</li>
</ol>
<h2>Bir sayfaya ne kadar sığar</h2>
<div class="table-scroll"><table><thead><tr><th>Yoğunluk</th><th>Sayfa başına kod</th><th>Sayfa başına veri</th><th>Yazıcı</th></tr></thead><tbody>
<tr><td>Standart</td><td>6, her biri yaklaşık 6,4 cm</td><td>yaklaşık 4 KB</td><td>Her lazer ya da mürekkep yazıcı</td></tr>
<tr><td>Yoğun</td><td>12, her biri yaklaşık 4,8 cm</td><td>yaklaşık 11 KB</td><td>600 dpi lazer yazıcı</td></tr>
</tbody></table></div>
<p>Metin ve CSV dosyaları basılmadan önce sıkıştırılır, çoğu zaman dört ila on kat; 40 KB'lık bir cihaz çıktısı genellikle iki üç standart sayfaya sığar. Kionel 60 sayfaya kadar basar ve okur; sayfaların fotoğraf ve taramaları da açılır. Daha fazlası için daha büyük dosyalar için <a href="/seri-kablo-veri-diyotu.html">seri kablo</a> ya da ekran kaydı uygundur.</p>
<h2>Bir kod lekelenir ya da sayfa yırtılırsa</h2>
<p>Kodların yaklaşık %30'u yedektir. Kopya değildirler: her biri dosyanın üçte birini karıştırır, bu yüzden hangi kod kaybolursa onun yerini tutabilir. Testlerimizde 30 KB'lık bir dosya, 48 kodundan sekizi eksikken 300 denemenin %91'inde geri geldi; 150 KB'lık bir dosya on iki kod eksikken 100 denemenin hepsinde geri geldi. Sıradan rastgele yedeklerle aynı 30 KB'lık dosya %3'te geri geliyordu. Okuma yarım kalırsa Kionel ne kadarının geldiğini söyler ve saklar; kalan sayfaları okutun.</p>
<h2>Sayfalar ne kadar güvenli</h2>
<ul>
<li>Dosya 12 karakterlik koddan (60 bit) türetilen bir anahtarla şifrelenir; saldırganın her tahmini 600.000 PBKDF2 turuna mal olur.</li>
<li>Kodu sayfalara da basma seçeneği açıksa, sayfaları eline geçiren dosyayı okuyabilir. Gizli dosyalarda kapalı bırakın.</li>
<li>Yıllarca saklanacak bir yedekte kodu, dosyanın gerektirdiği kadar özenle saklayın.</li>
</ul>
<h2>Diğer kâğıt yedek araçlarıyla farkı</h2>
<p>Kâğıda yedek yeni değil. <strong>qr-backup</strong> (Linux komut satırı aracı) en yoğun ayarında sayfaya daha çok sığdırır; <strong>paperize</strong> ve <strong>papyrus</strong> aynı işi Python'la yapar. Kionel'in farkı çalıştığı yer: yazdıran bilgisayarda tarayıcıda çalışır, geri okumak için telefonu sayfalara tutmak yeter, iki tarafa da program kurulmaz; neyin basıldığının imzalı kaydı da çıkar.</p>
<p>Parola kasası, 2FA kodları ya da anahtar mı yedekliyorsunuz? Neyin sığdığı ve nasıl güvende tutulacağı <a href="/sifreli-kagit-yedek.html">şifreli kâğıt yedek</a> sayfasında.</p>
<div class="actions"><a class="button" href="/transfer.html">Dosya yazdır</a><a class="button secondary" href="/excel-bozulma-kontrolu.html">Excel hasarı kontrolü</a></div>` },
  { slug: "seri-kablo-veri-diyotu", guide: true, title: "Tek yönlü seri kablo: dosya aktarımı için düşük maliyetli veri diyotu", description: "İzole bir bilgisayardan dosyayı, dönüş teli bağlanmamış bir RS-232 kabloyla çıkarın: hiçbir şey geri dönemez. Bağlantı şeması, hızlar, aktarım süreleri, sertifikalı veri diyotundan farkları ve Kionel'in tarayıcıdan bu hatta nasıl gönderdiği.", body: `
<p class="eyebrow">REHBER · İŞLETME SÜRÜMÜ</p><h1>Tek yönlü seri kablo: düşük maliyetli veri diyotu</h1>
<p class="lead">Veri diyotu verinin bir ağdan çıkmasına izin verir ve geri dönmesini fiziksel olarak imkânsız kılar. Ticari diyotlar bir BT projesiyle alınan cihazlardır. Tek bir izole bilgisayardan dosya çıkarmak için aynı fiziksel fikir bir seri kabloya sığar: gönderenin gönderme hattını alıcının alma hattına bağlayın, öbür yönü boş bırakın.</p>
<p>Yazan: Taha Bayar, biyolog; laboratuvar verisinin teslimi üzerine çalışıyor.</p>
<h2>Bağlantı</h2>
<p>Standart 9 pinli seri konnektörde (DB9) bilgisayar 3. pinden gönderir (TXD), 2. pinden alır (RXD); 5. pin sinyal toprağıdır. Tek yönlü kabloda yalnız iki tel vardır:</p>
<div class="table-scroll"><table><thead><tr><th>Gönderen (izole) bilgisayar</th><th></th><th>Alıcı bilgisayar</th></tr></thead><tbody>
<tr><td>3. pin, TXD (gönderme)</td><td>→</td><td>2. pin, RXD (alma)</td></tr>
<tr><td>5. pin, GND</td><td>—</td><td>5. pin, GND</td></tr>
<tr><td>2. pin, RXD</td><td>bağlı değil</td><td>3. pin, TXD</td></tr>
</tbody></table></div>
<p>İki vidalı DB9 adaptörü ve iki telle kurulur ya da sıradan bir null-modem kablosu açılıp TXD→RXD ve toprak dışındaki bütün teller kesilir. Gönderen bilgisayarın alma pinine hiçbir şey bağlı olmadığı için, iki tarafta hangi yazılım çalışırsa çalışsın geri dönen bir elektrik yolu yoktur. Kabloyu yönüyle etiketleyin; ters takılan kablo hiçbir şey taşımaz.</p>
<h2>Hızlar ve süreler</h2>
<p>Seri hız baud ile ayarlanır; 8 veri biti, eşliksiz ve bir dur bitiyle on bit bir bayt taşır. Kionel çerçeveleme için yaklaşık %3, yedek bloklar için %10 ekler.</p>
<div class="table-scroll"><table><thead><tr><th>Hız</th><th>Yaklaşık</th><th>1 MB</th><th>Nerede çalışır</th></tr></thead><tbody>
<tr><td>115.200 baud</td><td>10 KB/s</td><td>yaklaşık 1 dk 45 sn</td><td>Her port, bilgisayarın kendi COM portu dahil</td></tr>
<tr><td>230.400 baud</td><td>20 KB/s</td><td>yaklaşık 50 sn</td><td>Çoğu USB seri adaptör</td></tr>
<tr><td>460.800 baud</td><td>40 KB/s</td><td>yaklaşık 25 sn</td><td>Çoğu USB seri adaptör</td></tr>
<tr><td>921.600 baud</td><td>80 KB/s</td><td>yaklaşık 13 sn</td><td>FTDI, CH340 ve benzeri yongalı adaptörler, kısa kabloyla</td></tr>
</tbody></table></div>
<p>İki taraf aynı hızı kullanmalı. RS-232 standardı düşük hızlarda yaklaşık 15 metre için tasarlanmıştır; yüksek hızlarda kabloyu kısa tutun ya da çerçeve kaybolursa bir kademe düşürün. Veri geliyor ama çerçeve okunamıyorsa Kionel bunu söyler; hız uyuşmazlığı böyle görünür.</p>
<h2>İki ucu da USB: parça listesi</h2>
<p>Çoğu bilgisayarda artık 9 pinli seri port yok. Aynı tek yönlü bağlantı iki USB portu arasında da kurulur:</p>
<ul>
<li><strong>İki USB-seri dönüştürücü</strong> (çoğu zaman "USB TTL" adıyla satılır), pinleri açıkta ve ikisi de aynı gerilimde, 3,3 V. Yaygın çipler: FTDI FT232, Silicon Labs CP2102N ve WCH CH340.</li>
<li><strong>İki tel:</strong> gönderen dönüştürücünün TX pini alıcınınkinin RX pinine, GND de GND'ye. Gönderen dönüştürücünün RX pini ve iki taraftaki besleme pinleri boş kalır.</li>
</ul>
<p>Her bilgisayar dönüştürücüsünü bir seri port olarak görür ve Kionel onu yukarıdaki gibi kullanır. Tek yönlülük, 9 pinli kabloda olduğu gibi, bağlanmayan teldir; dönüştürücülerin kendisi sıradan iki yönlü USB cihazlarıdır, bu yüzden aşağıdaki sınırlar geçerlidir.</p>
<p>Uygulama 1.500.000 ve 3.000.000 baud hızlarını deneysel olarak sunar. Bunlar dönüştürücünün çipine ve tellerin kısa olmasına bağlıdır; donanımda henüz ölçmedik. Çerçeve kaybı olursa bir hız düşürün. Destekli sürekli bağlantı için <a href="/iletisim.html">bize yazın</a>.</p>
<h2>Kionel ile göndermek</h2>
<ol>
<li>Alıcı bilgisayarda Kionel'i Chrome ya da Edge'de açın, <strong>Receive → Sender has no camera — show a code</strong> ve <strong>Serial cable</strong> seçin, hızı ayarlayın ve <strong>Choose the serial port and listen</strong> düğmesine basın.</li>
<li>İzole bilgisayarda Kionel'i açın (<a href="/offline-package.html">çevrimdışı paket</a> çalışır), dosyayı seçin, alıcının kodunu yazın, <strong>Send over a serial cable</strong> bölümünü açın, aynı hızı seçin ve <strong>Choose the serial port and send</strong> düğmesine basın.</li>
<li>Alıcı dosyayı imzalı sevk kaydına karşı denetler ve teslim makbuzunu imzalar. Klasör seçildiyse dosya ve makbuz doğrudan oraya yazılır.</li>
</ol>
<p>Geri hiçbir şey gelmediği için gönderen alıcının bitirdiğini bilemez; bir tam turdan sonra durur ve <em>Send more</em> önerir: geç başlayan ya da veri kaybeden alıcı için aynı aktarımı sürdürür.</p>
<h2>Gözetimsiz: bir klasörü izlemek</h2>
<p>Kendi kendine oluşan dosyalar (günlükler, alarm dökümleri, parti raporları) için gönderen bilgisayar, her dosyayı bir kişinin seçmesi yerine bir klasörü izleyebilir. Yeni ya da değişen her dosya alıcı bilgisayarın kartına şifrelenir, imzalanır ve gönderilir; <em>Keep listening after each file</em> seçili ve bir klasör seçilmiş alıcı, her dosyayı makbuzuyla oraya yazar. Yazımı süren dosya, iki saniye değişmeden kalana kadar beklenir.</p>
<h2>Ters yön: izole bilgisayara giriş</h2>
<p>Kabloyu ters çevirince izole bilgisayar alıcı olur: metotlar, reçeteler ya da referans dosyaları girer, gönderme pini bağlı olmadığı için hiçbir şey çıkamaz. Gizli ve güvenlik ağlarının genellikle önemsediği yön budur.</p>
<h2>Sertifikalı veri diyotundan farkı</h2>
<ul>
<li><strong>Sertifika yok.</strong> Ticari diyotlar Common Criteria gibi değerlendirmelerden geçer ve tek yönlülük arızada da korunacak biçimde yapılır. Elde yapılmış kablo, bağlantısı ve etiketi kadar iyidir.</li>
<li><strong>USB adaptör bir USB cihazıdır.</strong> USB portlarının kilitli olduğu yerde bilgisayarın kendi COM portunu 115.200 baud ile kullanın ya da BT'den o adaptöre izin isteyin.</li>
<li><strong>Dosya taşır, ağ bağlamaz.</strong> Protokol dönüştürme ya da ağlar arası sürekli kopyalama yoktur; onun için diyot doğru araçtır.</li>
<li><strong>İçerik taranmaz.</strong> Bilgisayardan çıkan, üzerinde olandır. Kionel baytları imzalar ve denetler; içeriğe bakmaz.</li>
</ul>
<div class="actions"><a class="button" href="https://github.com/Apeiron01/kionel">Kaynak kod GitHub'da</a><a class="button secondary" href="/transfer.html">Kionel'i aç</a></div>` },
  { slug: "qr-kodun-icinde-ne-var", guide: true, head: '<script type="module" src="/src/qr-inspect-page.ts"></script>' + faqLd(QR_FAQ.tr), title: "QR kodun içinde ne var? Paylaşmadan önce bakın", description: "QR kodun resmini bırakın, içinde gerçekte ne olduğunu görün: Wi-Fi parolası, giriş kodu sırrı, belirteç taşıyan bağlantı ya da yalnızca şifreli gibi görünen veri. Tarayıcıda okunur, hiçbir şey yüklenmez. QR kod neden şifreleme değildir.", body: `
<p class="eyebrow">ÜCRETSİZ ARAÇ · REHBER</p><h1>Bu QR kodun içinde ne var?</h1>
<p class="lead">QR kod, karelerle çizilmiş bir metindir. Fotoğrafını çeken, metni de almış olur. Kodun resmini bırakın, neyi ele verdiğini görün. Resim bu sekmede okunur: hiçbir şey yüklenmez, sayfa bir kez açıldıktan sonra ağ kapalıyken de çalışır.</p>
<label class="drop" id="qr-drop"><input type="file" id="qr-file" accept="image/*"><span>QR kodun resmini buraya bırakın ya da tıklayıp seçin</span></label>
<p id="qr-status" class="evidence-status" role="status" hidden></p>
<div id="qr-results"></div>
<p><button type="button" class="button secondary" id="qr-clear" hidden>Resmi kaldır</button></p>
<p>Yazan: Taha Bayar, laboratuvar verisinin aktarımı üzerine çalışan bir biyolog.</p>
<h2>Araç neye bakar</h2>
<div class="table-scroll"><table><thead><tr><th>Kodun içinde</th><th>Fotoğrafı neyi ele verir</th></tr></thead><tbody>
<tr><td>Wi-Fi paylaşım kodu</td><td>Ağın adı ve parolası, düz metin olarak</td></tr>
<tr><td>Doğrulayıcı kurulum kodu</td><td>Tek kullanımlık giriş kodlarınızı üreten sır, kalıcı olarak</td></tr>
<tr><td>Doğrulayıcı dışa aktarımı</td><td>İçindeki bütün hesapların sırları</td></tr>
<tr><td>Parola ya da belirteç taşıyan bağlantı</td><td>O belirtecin açtığı şey: kamera görüntüsü, paylaşılan klasör, oturum</td></tr>
<tr><td>Özel anahtar ya da kurtarma cümlesi</td><td>Anahtarın koruduğu her şey</td></tr>
<tr><td>Kimsenin okuyamadığı bir dizi</td><td>Bilinemez. Şifreli de olabilir, yalnızca karıştırılmış da</td></tr>
</tbody></table></div>
<h2>Karıştırmak şifrelemek değildir</h2>
<p>Birçok uygulama paylaşım koduna cihaz kimliğini, kullanıcı adını ve parolayı koyar; kod parolaya benzemesin diye de bunları karıştırır. Yöntem ve anahtarı uygulamanın içindedir, her telefonda aynıdır. Uygulamayı bir kez söken, o uygulamanın ürettiği bütün kodları okur. Şifrelemenin tek farkı şudur: anahtar ne uygulamadadır ne de kodun içinde.</p>
<p>Ekim 2026'da çok paylaşılan bir gönderi, bir yapay zekâ modelinin bir kamera uygulamasının paylaşım kodundaki karıştırmayı çözüp kameranın kullanıcı adını ve parolasını okuduğunu gösterdi. Bu olayı biz doğrulamadık. Anlattığı zayıflık eski ve gerçektir; yeni olan emektir: bir uzmanın günlerini alan iş artık bir sohbet penceresinde dakikalar sürüyor. "Kimse uğraşmaz" diye güvenilen karıştırma artık hiçbir şeyi korumuyor.</p>
<p>Bu araç hiçbir karıştırmayı çözmeye çalışmaz ve karıştırılmış ile şifreliyi bakarak ayıramaz; bunu dışarıdan kimse ayıramaz. Size, kodun gösterilebilir olması için hangisi olması gerektiğini söyler.</p>
<h2>Sır taşıyan kodla ne yapılır</h2>
<ul>
<li><strong>Ekran görüntüsünü paylaşmayın.</strong> Sohbet yedekleri, fotoğraf bulutları ve destek kayıtları bunları yıllarca saklar.</li>
<li><strong>Kamera ya da kayıt cihazı paylaşım kodu:</strong> paylaştıktan sonra cihaz parolasını değiştirin, başkalarına kendi sınırlı hesabını açın, kullanmadığınız bulut erişimini kapatın.</li>
<li><strong>Wi-Fi:</strong> ana ağın değil, misafir ağının kodunu gösterin.</li>
<li><strong>Doğrulayıcı kodları:</strong> kurulum kodu açığa çıktıysa iki adımlı doğrulamayı yeniden kurun; eski sır geçersiz olur. Kalıcı bir yedek için <a href="/sifreli-kagit-yedek.html">şifreli kâğıt yedek</a> rehberine bakın.</li>
</ul>
<h2>Sık sorulanlar</h2>
${faqHtml(QR_FAQ.tr)}
<h2>Bir kod nasıl güvenle gösterilir</h2>
<p>İçinde gizli bir şey olmayan kod güvenle gösterilir. Kionel'in eşleşme kodu yalnızca açık anahtar taşır; iki cihaz sonra hiçbir ekranda görünmeyen bir anahtarda anlaşır ve değiştirilmiş bir kod fark edilsin diye ikisi de kısa bir karşılaştırma kodu gösterir. Dosya, ilk görüntü çizilmeden önce bu anahtarla şifrelenir. Ekranın kaydı, alıcı cihaz olmadan işe yaramaz. <a href="/how-it-works.html">Nasıl çalışır</a> ve <a href="/limits.html">neye karşı korumaz</a> (İngilizce).</p>
<div class="actions"><a class="button" href="/transfer.html">Dosyayı QR ile şifreli gönder</a><a class="button secondary" href="/sha256-dogrulama.html">SHA-256 kontrolü</a></div>` },
  { slug: "usb-ile-dosya-aktarimi-imzali-kayit", guide: true, head: faqLd(USB_FAQ.tr), title: "USB belleği bırakmayın, kanıtı ekleyin: USB ile taşınan dosyalar için imzalı kayıt", description: "Cihaz bilgisayarlarının çoğu sonucu hâlâ USB bellekle veriyor ve bellek kayıt bırakmıyor. Dosyayı çıkmadan önce mühürleyin, varışta denetleyin ve imzalayın: dosyanın taşınma biçimini değiştirmeden iki imzalı kayıt.", body: `
<p class="eyebrow">REHBER · İŞLETME SÜRÜMÜ</p><h1>USB belleği bırakmayın, kanıtı ekleyin</h1>
<p class="lead">Çoğu laboratuvarda cihaz bilgisayarı ağa bağlı değildir ve sonuçlar USB bellekle çıkar. Denetçinin sorduğu şey bellek değildir. Soru şudur: ne çıktı, ne ulaştı ve ikisinin aynı dosya olduğunu nereden biliyorsunuz? Kionel bunu, dosyanın taşınma biçimini değiştirmeden yanıtlar.</p>
<p>Yazan: Taha Bayar, laboratuvar verisinin aktarımı üzerine çalışan bir biyolog.</p>
<h2>Nasıl yapılır</h2>
<ol>
<li><strong>Cihaz bilgisayarında</strong> Kionel'i açın (<a href="/offline-package.html">çevrimdışı paket</a> de olur), dosyayı seçin, iş emrini yazın ve <strong>Seal without transferring</strong> düğmesine basın. Bilgisayar dosyanın SHA-256 özetini, boyutunu, zamanını ve iş emrini içeren bir kaydı imzalar. Kaydı indirin: <code>sonuc.csv.seal.json</code>.</li>
<li><strong>İkisini birlikte taşıyın:</strong> dosyayı ve mühürlü kaydını, bugün nasıl taşıyorsanız öyle; bellekle, paylaşımla ya da elden.</li>
<li><strong>Alan cihazda</strong> <em>Receive</em> sekmesini açın, önce mühürlü kaydı, sonra dosyayı ekleyin. Cihaz dosyayı kayda karşı denetler. Aynıysa teslim makbuzunu imzalar; bir bayt farklıysa bunu söyler ve hiçbir şey imzalamaz.</li>
</ol>
<p>Gönderen cihaz mühürler, alan cihaz imzalar. Mühürlü kayıt birkaç yüz bayttır; belleğe koymak istemezseniz cihaz bilgisayarının ekranında kod olarak gösterip alan cihazın kamerasıyla okutabilirsiniz, dosya yine bellekle gider.</p>
<h2>Sonunda elinizde ne olur</h2>
<ul>
<li><strong>Gönderen cihazın imzaladığı sevk kaydı:</strong> hangi dosya, kaç bayt, ne zaman, hangi iş emri için, hangi operatörün beyanıyla.</li>
<li><strong>Alan cihazın o kaydın üzerine imzaladığı teslim makbuzu:</strong> tam olarak bu dosya buraya ulaştı.</li>
<li><strong>İki tarafta aktarım günlüğü</strong> ve tek sayfalık rapor. <a href="/verify.html#link">Doğrulayıcı</a> iki günlüğü karşılaştırıp mühürlenen her dosyayı makbuzuyla ya da makbuzsuz listeler.</li>
</ul>
<p>Bunlar optik aktarımın ürettiği kayıtların aynısıdır ve aynı ücretsiz <a href="/verify.html">doğrulayıcı</a> ile, çevrimdışı ve bize bağlı olmadan denetlenir. Tek lisans bütün yolları kapsar: ekran, tek yönlü kablo, basılı sayfa ya da bellek.</p>
<h2>Ne yapmaz</h2>
<ul>
<li><strong>Dosyayı bellekte şifrelemez.</strong> Dosya Kionel'in dışında taşınır. Kionel ulaşanın mühürlenenle aynı olduğunu gösterir; yolda gizlemez. İçerik yolda gizli kalmalıysa şifreli bellek ya da <a href="/transfer.html">optik yolu</a> kullanın.</li>
<li><strong>USB portunu denetlemez.</strong> Biri dosyayı mühürlemeden de belleğe kopyalayabilir. Port denetimi kurumun cihaz denetimi yazılımının işidir.</li>
<li><strong>Belleği taramaz.</strong> Bellek çıkarılabilir ortamdır. USB'den kaçınma nedeniniz zararlı yazılımsa kayıt yardımcı olmaz; optik yol ya da <a href="/seri-kablo-veri-diyotu.html">tek yönlü kablo</a> olur.</li>
<li><strong>Kişiyi tanımlamaz.</strong> Kayıtlar hangi anahtarların imzaladığını ve operatörün ne beyan ettiğini gösterir.</li>
</ul>
<h2>Sık sorulanlar</h2>
${faqHtml(USB_FAQ.tr)}
<div class="actions"><a class="button" href="/transfer.html">Kionel'i aç</a><a class="button secondary" href="/sha256-dogrulama.html">SHA-256 kontrolü</a></div>` },
  { slug: "sha256-dogrulama", guide: true, head: '<script type="module" src="/src/hash-tool.ts"></script>', title: "SHA-256 nasıl kontrol edilir? Windows, Mac, Linux ve telefonda", description: "Bir dosyanın SHA-256 özetini tarayıcıda, dosyayı yüklemeden alın; ya da Windows, macOS ve Linux'ta tek bir yerleşik komutla. Aynı dosyanın iki özetinin neden farklı çıktığının beş nedeni.", body: `
<p class="eyebrow">ÜCRETSİZ ARAÇ · REHBER</p><h1>SHA-256 kontrolü: burada ya da tek komutla</h1>
<p class="lead">Dosyayı bırakın, SHA-256 özetini alın. Hesap bu sekmede yapılır: dosya yüklenmez, sayfa bir kez açıldıktan sonra ağ kapalıyken de çalışır.</p>
<label class="drop" id="hash-drop"><input type="file" id="hash-file"><span>Dosyayı buraya bırakın ya da tıklayıp seçin</span></label>
<div id="hash-output" hidden><dl class="evidence-facts"><dt>Dosya</dt><dd id="hash-name"></dd><dt>Boyut</dt><dd id="hash-size"></dd><dt>SHA-256</dt><dd id="hash-value"></dd></dl>
<p><button type="button" class="button secondary" id="hash-copy">SHA-256'yı kopyala</button> <button type="button" class="button secondary" id="hash-clear">Dosyayı kaldır</button></p></div>
<p><label for="hash-expected">Karşılaştırılacak beklenen SHA-256 (isteğe bağlı)</label><input id="hash-expected" type="text" autocomplete="off" spellcheck="false" placeholder="Size verilen değeri yapıştırın"></p>
<p id="hash-status" class="evidence-status" role="status" hidden></p>
<p>Yazan: Taha Bayar, biyolog; laboratuvar verisinin teslimi üzerine çalışıyor. Kionel aktardığı her dosyadan bu değeri alır.</p>
<h2>Aynı kontrol komut satırından</h2>
<div class="table-scroll"><table><thead><tr><th>Sistem</th><th>Komut</th><th>Bilmekte yarar var</th></tr></thead><tbody>
<tr><td>Windows, Komut İstemi</td><td><code>certutil -hashfile "C:\\veri\\olcum_041.csv" SHA256</code></td><td>Yerleşik. Windows 7'de değer her iki karakter arasında boşlukla yazılır; boşluklar değere dahil değildir.</td></tr>
<tr><td>Windows, PowerShell</td><td><code>Get-FileHash "C:\\veri\\olcum_041.csv"</code></td><td>Varsayılan SHA-256'dır. PowerShell 4.0 ister; güncellenmemiş Windows 7'de yoktur. Büyük harf yazar.</td></tr>
<tr><td>macOS</td><td><code>shasum -a 256 ~/Desktop/olcum_041.csv</code></td><td><code>-a 256</code> olmadan SHA-1 verir: farklı, 40 karakterlik bir değer.</td></tr>
<tr><td>Linux</td><td><code>sha256sum olcum_041.csv</code></td><td>Beklenen değerler listesiyle <code>sha256sum -c liste.txt</code> birçok dosyayı birden denetler.</td></tr>
<tr><td>Android, iPhone</td><td>yerleşik yok</td><td>Bu sayfayı telefonun tarayıcısında açıp dosyayı seçin.</td></tr>
</tbody></table></div>
<h2>"Aynı" dosyanın iki özeti neden farklı çıkar</h2>
<ol>
<li><strong>Biri açıp Kaydet'e bastı.</strong> Excel CSV'yi kaydederken yeniden yazar: ekrandaki değerler aynı görünse de sayı biçimleri, tırnaklar ve satır sonları değişebilir. Özeti kimse açmadan alın; değişip değişmediğini <a href="/excel-bozulma-kontrolu.html">Excel hasarı kontrolü</a> gösterir.</li>
<li><strong>Satır sonları dönüştürüldü.</strong> Windows satırı iki karakterle, Linux ve macOS bir karakterle bitirir. ASCII kipindeki FTP, bazı e-posta ağ geçitleri ve Git'in <code>autocrlf</code> ayarı bunu haber vermeden dönüştürür.</li>
<li><strong>Karakter kodlaması değişti.</strong> UTF-8 dosya eski kod sayfasıyla (ya da tersi) kaydedilince ş, ğ, ı, µ gibi karakterlerin baytları değişir.</li>
<li><strong>Başka bir dosyanın özeti alındı.</strong> Aynı adlı iki klasör, "(1)" eklenmiş bir indirme ya da yarım kalmış bir kopya. Boyutu da karşılaştırın.</li>
<li><strong>Başka bir algoritma kullanıldı.</strong> SHA-1 40, MD5 32 karakterdir; SHA-256 64 karakterdir.</li>
</ol>
<div class="actions"><a class="button" href="/transfer.html">Ücretsiz başla</a><a class="button secondary" href="/excel-bozulma-kontrolu.html">Excel hasarı kontrolü</a></div>` },
  { slug: "encrypted-paper-backup", lang: "en", guide: true, title: "Encrypted paper backup of a password vault, 2FA recovery codes or keys", description: "Print a password manager export, 2FA recovery codes, a KeePass database or an SSH key as pages of encrypted QR codes, in your browser, and restore it later by pointing a phone at the pages. The printer only ever sees encrypted codes. Free up to 5 pages.", body: `
<p class="eyebrow">FREE · IN THE BROWSER · NOTHING UPLOADED</p><h1>An encrypted paper backup of your vault, codes or keys</h1>
<p class="lead">A paper backup survives a dead disk, a lost phone and a locked account. The usual advice is to print the export as text, which puts every password on a sheet anyone can read. Kionel prints the file as encrypted QR codes instead, and any phone with a browser turns the pages back into the file.</p>
<p>Written by Taha Bayar, a biologist working on data handover between devices.</p>
<h2>What fits</h2>
<div class="table-scroll"><table><thead><tr><th>What</th><th>Typical size</th><th>Pages</th></tr></thead><tbody>
<tr><td>2FA recovery codes (a text file)</td><td>under 1 KB</td><td>1</td></tr>
<tr><td>SSH or GPG private key</td><td>1–7 KB</td><td>1</td></tr>
<tr><td>KeePass or KeePassXC database (.kdbx)</td><td>tens of KB</td><td>2–5 dense</td></tr>
<tr><td>Password manager export (JSON) of a few hundred entries</td><td>roughly 100–300 KB</td><td>plain JSON compresses well: often 3–5 dense; a password-protected export hardly compresses: 10–25 dense</td></tr>
</tbody></table></div>
<p>Kionel prints and reads up to 60 pages: about 3.8 KB per standard page and 11 KB per dense page, after compression. Plain text shrinks a lot; an already-encrypted file, such as a .kdbx or a password-protected export, hardly shrinks at all. Kionel refuses a file that does not fit before anything prints, and says whether Dense would fit it.</p>
<h2>How to make one</h2>
<ol>
<li><strong>Export the file.</strong> In Bitwarden: <em>Tools → Export vault</em>. For the strongest backup choose <em>.json (Encrypted)</em> with <em>Password protected</em>; it needs more pages because encrypted data does not compress. A plain <em>.json</em> export fits in far fewer pages and is then protected by Kionel's code alone. In KeePassXC there is nothing to export: the .kdbx database is already encrypted, so print that file. For 2FA recovery codes, save them in a text file.</li>
<li><strong>Print it with Kionel.</strong> Open <a href="/transfer.html">Kionel</a>, choose the file, pick <em>Print on paper</em>, choose Dense if it helps it fit, and print. The offline package works on a computer you keep off the network.</li>
<li><strong>Keep the code apart from the pages.</strong> Kionel shows a 12-character code. Without it the pages cannot be read. Store it where you would keep a spare key, not in the same envelope.</li>
<li><strong>Delete the unencrypted export</strong> from the computer, including the Downloads folder and the recycle bin.</li>
<li><strong>Test the restore once.</strong> On your phone: <em>Receive → Printed pages</em>, enter the code, point the camera at the pages. A backup you have never restored is a hope, not a backup.</li>
</ol>
<h2>Why two layers of encryption</h2>
<p>The code protects the pages with a key derived from 12 characters (60 bits), and every guess costs 600,000 rounds of PBKDF2. That stops someone who finds the envelope. For secrets that must stay safe for decades against a well-funded attacker, print an export that is already password-protected, as above: the paper then holds a file that is encrypted twice, and the inner password never leaves your head.</p>
<h2>What the printer sees</h2>
<p>Only the encrypted codes. Office and network printers often keep recent jobs in memory or on a disk, and a print spooler can leave a copy on the computer. With Kionel that copy is the same unreadable codes as the paper, unless you choose to print the code on the pages.</p>
<h2>Compared with other paper backup tools</h2>
<div class="table-scroll"><table><thead><tr><th>Tool</th><th>Runs on</th><th>Restore with</th><th>Notes</th></tr></thead><tbody>
<tr><td><strong>paperkey</strong></td><td>command line</td><td>typing or OCR, then GnuPG</td><td>Made for GPG secret keys only; prints the key as text, very compact.</td></tr>
<tr><td><strong>qr-backup</strong></td><td>Linux command line</td><td>a webcam or scanner and its tools</td><td>Fits more per page at its densest setting; optional password.</td></tr>
<tr><td><strong>PaperCrypt</strong></td><td>command line</td><td>its own tool</td><td>Printable encrypted documents with instructions on the page.</td></tr>
<tr><td><strong>Kionel</strong></td><td>any browser, including a phone</td><td>any phone camera, pages in any order</td><td>Nothing to install; spare codes chosen so a smudged or torn code does not lose the file.</td></tr>
</tbody></table></div>
<h2>Keep it readable</h2>
<ul>
<li>Print on a laser printer if you can; inkjet ink can run if the paper gets wet.</li>
<li>Store the pages flat and dry, away from sunlight. A plastic sleeve helps.</li>
<li>Print a new set when the file changes, and destroy the old one. Old pages still open with their old code.</li>
</ul>
<div class="actions"><a class="button" href="/transfer.html">Print a backup</a><a class="button secondary" href="/print-file-as-qr-codes.html">How printing works</a></div>` },
  { slug: "sifreli-kagit-yedek", guide: true, title: "Parola kasası, 2FA kurtarma kodları ve anahtarlar için şifreli kâğıt yedek", description: "Parola yöneticisi dışa aktarımını, 2FA kurtarma kodlarını, KeePass veritabanını ya da SSH anahtarını tarayıcıda şifreli QR kodlu sayfalar olarak yazdırın; sonra telefonu sayfalara tutarak geri alın. Yazıcı yalnız şifreli kodları görür. 5 sayfaya kadar ücretsiz.", body: `
<p class="eyebrow">ÜCRETSİZ · TARAYICIDA · HİÇBİR ŞEY YÜKLENMEZ</p><h1>Kasanız, kodlarınız ya da anahtarlarınız için şifreli kâğıt yedek</h1>
<p class="lead">Kâğıt yedek; bozulan diske, kaybolan telefona ve kilitlenen hesaba dayanır. Yaygın öneri dışa aktarımı düz metin olarak basmaktır; bu, bütün parolaları herkesin okuyabileceği bir kâğıda koyar. Kionel dosyayı şifreli QR kodlar olarak basar; tarayıcısı olan herhangi bir telefon sayfaları yeniden dosyaya çevirir.</p>
<p>Yazan: Taha Bayar, biyolog; cihazlar arası veri teslimi üzerine çalışıyor.</p>
<h2>Neler sığar</h2>
<div class="table-scroll"><table><thead><tr><th>Ne</th><th>Tipik boyut</th><th>Sayfa</th></tr></thead><tbody>
<tr><td>2FA kurtarma kodları (metin dosyası)</td><td>1 KB'tan az</td><td>1</td></tr>
<tr><td>SSH ya da GPG gizli anahtarı</td><td>1–7 KB</td><td>1</td></tr>
<tr><td>KeePass ya da KeePassXC veritabanı (.kdbx)</td><td>onlarca KB</td><td>2–5 yoğun</td></tr>
<tr><td>Birkaç yüz kayıtlık parola yöneticisi dışa aktarımı (JSON)</td><td>kabaca 100–300 KB</td><td>düz JSON iyi sıkışır: çoğu zaman 3–5 yoğun; parola korumalı dışa aktarım neredeyse sıkışmaz: 10–25 yoğun</td></tr>
</tbody></table></div>
<p>Ücretsiz kişisel sürüm 5 sayfaya kadar basar ve okur: sıkıştırmadan sonra standart sayfalarda yaklaşık 19 KB, yoğun sayfalarda 57 KB. Düz metin çok küçülür; .kdbx ya da parola korumalı dışa aktarım gibi zaten şifreli bir dosya neredeyse hiç küçülmez. Sığmayan dosyayı Kionel daha hiçbir şey basılmadan söyler ve Yoğun'un sığdırıp sığdırmayacağını belirtir.</p>
<h2>Nasıl yapılır</h2>
<ol>
<li><strong>Dosyayı dışa aktarın.</strong> Bitwarden'da: <em>Tools → Export vault</em>. En güçlü yedek için <em>.json (Encrypted)</em> ve <em>Password protected</em> seçin; şifreli veri sıkışmadığı için daha çok sayfa tutar. Düz <em>.json</em> çok daha az sayfaya sığar ve o zaman yalnız Kionel'in koduyla korunur. KeePassXC'de dışa aktarmaya gerek yok: .kdbx veritabanı zaten şifrelidir, o dosyayı basın. 2FA kurtarma kodlarını bir metin dosyasına kaydedin.</li>
<li><strong>Kionel ile yazdırın.</strong> <a href="/transfer.html">Kionel</a>'i açın, dosyayı seçin, <em>Print on paper</em> seçin, sığması için gerekirse Yoğun'u seçin ve yazdırın. Ağa bağlamadığınız bir bilgisayarda çevrimdışı paket de çalışır.</li>
<li><strong>Kodu sayfalardan ayrı saklayın.</strong> Kionel 12 karakterlik bir kod gösterir. Kod olmadan sayfalar okunamaz. Kodu yedek anahtar saklar gibi saklayın, aynı zarfa koymayın.</li>
<li><strong>Şifresiz dışa aktarımı silin</strong>: bilgisayardan, İndirilenler klasöründen ve geri dönüşüm kutusundan.</li>
<li><strong>Geri yüklemeyi bir kez deneyin.</strong> Telefonda: <em>Receive → Printed pages</em>, kodu girin, kamerayı sayfalara tutun. Hiç geri yüklenmemiş bir yedek, yedek değil umuttur.</li>
</ol>
<h2>Neden iki kat şifreleme</h2>
<p>Kod, sayfaları 12 karakterden (60 bit) türetilen bir anahtarla korur ve her tahmin 600.000 tur PBKDF2'ye mal olur. Bu, zarfı bulan birini durdurur. Onlarca yıl, güçlü kaynaklı bir saldırgana karşı güvende kalması gereken sırlar için, yukarıdaki gibi zaten parola korumalı bir dışa aktarımı basın: kâğıtta iki kez şifrelenmiş bir dosya olur ve içteki parola yalnız sizin aklınızda kalır.</p>
<h2>Yazıcı neyi görür</h2>
<p>Yalnız şifreli kodları. Ofis ve ağ yazıcıları son işleri çoğu zaman bellekte ya da diskte tutar; yazdırma kuyruğu bilgisayarda bir kopya bırakabilir. Kionel'de o kopya da kâğıttaki okunamayan kodların aynısıdır; kodu sayfalara basmayı seçmediğiniz sürece.</p>
<h2>Diğer kâğıt yedek araçlarıyla karşılaştırma</h2>
<div class="table-scroll"><table><thead><tr><th>Araç</th><th>Çalıştığı yer</th><th>Geri yükleme</th><th>Not</th></tr></thead><tbody>
<tr><td><strong>paperkey</strong></td><td>komut satırı</td><td>elle yazma ya da OCR, sonra GnuPG</td><td>Yalnız GPG gizli anahtarları için; anahtarı metin olarak, çok küçük basar.</td></tr>
<tr><td><strong>qr-backup</strong></td><td>Linux komut satırı</td><td>web kamerası ya da tarayıcı ve kendi araçları</td><td>En yoğun ayarında sayfaya daha çok sığdırır; isteğe bağlı parola.</td></tr>
<tr><td><strong>PaperCrypt</strong></td><td>komut satırı</td><td>kendi aracı</td><td>Sayfada talimatlı, yazdırılabilir şifreli belgeler.</td></tr>
<tr><td><strong>Kionel</strong></td><td>her tarayıcı, telefon dahil</td><td>herhangi bir telefon kamerası, sayfalar sırasız</td><td>Kurulum yok; yedek kodlar lekelenen ya da yırtılan kodun dosyayı kaybettirmeyeceği şekilde seçilir.</td></tr>
</tbody></table></div>
<h2>Okunur kalsın</h2>
<ul>
<li>Mümkünse lazer yazıcıyla basın; mürekkep kâğıt ıslanırsa akabilir.</li>
<li>Sayfaları düz, kuru ve güneşten uzak saklayın; plastik bir dosya işe yarar.</li>
<li>Dosya değişince yeni bir takım basın, eskisini imha edin. Eski sayfalar eski koduyla hâlâ açılır.</li>
</ul>
<div class="actions"><a class="button" href="/transfer.html">Yedek yazdır</a><a class="button secondary" href="/dosyayi-qr-kod-olarak-yazdir.html">Yazdırma nasıl çalışır</a></div>` },
  { slug: "medical-device-data-offline", lang: "en", guide: true, title: "Getting data off an isolated clinical device workstation without USB or the hospital network", description: "Move exports from a clinical or diagnostic workstation that must stay off the hospital network, without USB sticks and without a cloud service in between: screen to camera, printed pages or a one-way cable, with a signed record of each file.", body: `
<p class="eyebrow">GUIDE · HEALTHCARE</p><h1>Data off an isolated clinical workstation, without USB or the network</h1>
<p class="lead">Many clinical and diagnostic devices come with a workstation that runs an operating system the vendor no longer updates. Connecting it to the hospital network lowers the whole network to its level; a USB stick carries patient data through an uncontrolled medium. Most teams end up with one of the two anyway.</p>
<p>Written by Taha Bayar, a biologist working on data handover between isolated systems.</p>
<h2>Three routes that keep the workstation isolated</h2>
<ul>
<li><strong>Screen to camera.</strong> The workstation shows the file as encrypted codes; a phone or tablet reads them. Nothing is plugged in. Suits exports of kilobytes to a few megabytes.</li>
<li><strong>Printed pages.</strong> If the workstation has a printer but no camera, the file is printed as encrypted codes and read later by any camera. The printer queue only ever holds the codes.</li>
<li><strong>A one-way serial cable.</strong> For a fixed pairing with the PC that feeds the record system: a cable with only the transmit line connected, so nothing can travel back. Up to about 80 KB/s. <a href="/serial-data-diode.html">Wiring and limits</a>.</li>
</ul>
<h2>What stays true on every route</h2>
<ul>
<li><strong>No third party sees the data.</strong> The file goes from one device to the other; Kionel's servers never receive it, so the transfer adds no processor to your data-protection records.</li>
<li><strong>Each file has a signed record.</strong> The sending device signs the file's SHA-256 with the reference you enter (an order or accession number, for example), and the receiving device signs its delivery. Anyone can check both offline.</li>
<li><strong>The workstation needs only a browser.</strong> The offline package is a single HTML file with a published SHA-256, for a PC that never goes online.</li>
</ul>
<h2>Where it does not fit</h2>
<ul>
<li><strong>Kionel is not a medical device.</strong> It is not for diagnosis, treatment or clinical decisions, and it must not be the only channel for anything urgent.</li>
<li><strong>It needs a browser on the workstation.</strong> Embedded devices without one are out of reach; so are workstations whose browser is older than Chrome or Edge 137.</li>
<li><strong>It does not scan file content</strong>, and it has not had an independent security audit yet. The <a href="/limits.html">limits page</a> lists the rest.</li>
</ul>
<div class="actions"><a class="button" href="https://github.com/Apeiron01/kionel">Source on GitHub</a><a class="button secondary" href="/transfer.html">Try it free</a></div>` },
  { slug: "digital-evidence-chain-of-custody-offline", lang: "en", guide: true, title: "Chain of custody for digital files handed over without a network", description: "Hand over a file collected in the field or on an isolated machine with a record both sides sign at the moment of transfer: the file's SHA-256, the case reference, the operator and, if you need it, an independent RFC 3161 timestamp. What such a record proves, and what it does not.", body: `
<p class="eyebrow">GUIDE · EVIDENCE</p><h1>Chain of custody for a file handed over offline</h1>
<p class="lead">The weakest link in a chain of custody is often the handover itself: a file copied from one machine to another, recorded afterwards on a form by the person who handed it over. The form says what that person remembers. It does not show that the receiver got exactly those bytes.</p>
<p>Written by Taha Bayar, a biologist working on data handover between isolated systems.</p>
<h2>A record made at the moment of transfer</h2>
<ol>
<li><strong>The sending device signs a dispatch record</strong>: the file's SHA-256 and size, the case or exhibit reference, the classification and the operator's declared name or ID.</li>
<li><strong>The receiving device checks the file against it</strong> and signs a delivery receipt that contains the dispatch record.</li>
<li><strong>Optionally, the receipt gets an RFC 3161 timestamp</strong> from DigiCert, so it provably existed at that time and not only by the devices' own clocks. Only the receipt's fingerprint is sent for this, never the file.</li>
<li><strong>A local audit chain</strong> links each receipt to the previous one on that device, so a removed or inserted entry shows.</li>
</ol>
<p>The handover itself needs no network: screen to camera, printed pages or a one-way serial cable. Verification needs none either; a free, Apache-2.0 verifier checks the records without Kionel.</p>
<h2>When only the proof should leave</h2>
<p>Sometimes the file must stay where it is and only evidence of it should leave. Sealing makes a signed record of the file's SHA-256, time, reference and operator on the isolated machine and shows it as one code, which can also be printed on paper. Anyone can later check a copy of the file against it.</p>
<h2>What the records do not prove</h2>
<ul>
<li><strong>Keys, not people.</strong> A signature shows which device key signed. Tying a key to a person is your organisation's identity process; the operator field is what the person typed.</li>
<li><strong>Device clocks can be set back.</strong> Without a trusted timestamp, the times are what the two devices said.</li>
<li><strong>Nothing about how the file was collected.</strong> The records start at the handover; acquisition and imaging have their own standards, such as ISO/IEC 27037.</li>
<li><strong>Admissibility is a legal question</strong> for your jurisdiction, not something a tool can promise.</li>
</ul>
<div class="actions"><a class="button" href="https://github.com/Apeiron01/kionel">Source on GitHub</a><a class="button secondary" href="/verify.html">Verify a record</a></div>` },
  { slug: "offline-root-ca-ceremony-file-transfer", lang: "en", guide: true, title: "Moving CSRs, certificates and CRLs to and from an offline root CA without USB", description: "An offline root CA still needs files carried in and out: certificate signing requests in, certificates and CRLs out. Do it by screen, printed pages or a one-way serial cable, with a signed record of each file's SHA-256 bound to the ceremony, instead of a USB stick.", body: `
<p class="eyebrow">GUIDE · PKI</p><h1>Files in and out of an offline root CA, without a USB stick</h1>
<p class="lead">An offline root CA is switched on a few times a year to sign a subordinate CA certificate or a new CRL. Everything around it is scripted, witnessed and logged, except the USB stick that carries the request in and the certificate out: the one piece of hardware that crosses the air gap in both directions.</p>
<p>Written by Taha Bayar, who builds Kionel.</p>
<h2>What moves, and how big it is</h2>
<div class="table-scroll"><table><thead><tr><th>File</th><th>Direction</th><th>Typical size</th><th>Route that fits</th></tr></thead><tbody>
<tr><td>Subordinate CA request (CSR)</td><td>in</td><td>1–2 KB</td><td>A one-way serial cable into the CA, or a camera on the CA machine</td></tr>
<tr><td>Signed subordinate CA certificate</td><td>out</td><td>1–3 KB</td><td>Screen to a phone or laptop camera, or a printed page</td></tr>
<tr><td>CRL</td><td>out</td><td>from under 1 KB</td><td>Screen, printed page or serial cable</td></tr>
<tr><td>Ceremony log or transcript</td><td>out</td><td>tens of KB</td><td>Screen or serial cable</td></tr>
</tbody></table></div>
<p>At these sizes one or two codes carry the file: the transfer takes seconds. Printed pages double as the paper copy many ceremony procedures keep anyway.</p>
<h2>Direction matters</h2>
<ul>
<li><strong>Out of the CA</strong> needs only a screen on the CA machine: it shows the file as encrypted codes and a device outside reads them. Nothing touches the CA.</li>
<li><strong>Into the CA</strong> needs either a camera on the CA machine or a <a href="/serial-data-diode.html">serial cable wired one way into it</a>: transmit and ground from the outside PC to the CA's receive pin, and nothing back. A CSR then goes in and nothing can come out on that cable.</li>
</ul>
<h2>Evidence for the ceremony record</h2>
<p>Each file carries a dispatch record signed by the sending device (the file's SHA-256, size, time, the ceremony reference and the operator's declared name) and a delivery receipt signed by the receiving device. A reviewer can check later that the certificate that left the CA is byte for byte the one that was installed, with the free, Apache-2.0 verifier. A receipt can also carry an RFC 3161 timestamp once the receiving device is online.</p>
<h2>What it does not replace</h2>
<ul>
<li><strong>The ceremony itself.</strong> Witnesses, scripts, HSM quorum and video stay as they are; Kionel's records add a file-level trail to them.</li>
<li><strong>The HSM.</strong> Kionel's own signing keys are browser keys the device cannot export, not HSM keys. They sign the transfer records, never your CA's certificates.</li>
<li><strong>A browser on the CA machine.</strong> It needs Chrome, Edge or Firefox recent enough (serial needs Chrome or Edge); the <a href="/offline-package.html">offline package</a> is one HTML file with a published SHA-256 you can check before it goes in.</li>
</ul>
<div class="actions"><a class="button" href="/transfer.html">Try it free</a><a class="button secondary" href="/serial-data-diode.html">One-way serial cable</a></div>` },
  { slug: "leave-passwords-to-family", lang: "en", guide: true, title: "How to leave your passwords to your family, on paper, safely", description: "A plan for passing on access to your accounts if something happens to you: an encrypted paper backup of your password vault kept in one place, and its code kept in another. How it compares with emergency access in password managers, Apple Legacy Contact and Google Inactive Account Manager.", body: `
<p class="eyebrow">GUIDE · DIGITAL LEGACY</p><h1>Leaving your passwords to your family, on paper</h1>
<p class="lead">If something happens to you, the people you leave behind will need your email, your bank logins and the photos in your cloud account. Writing every password on a sheet is dangerous while you are alive; leaving nothing locks them out. An encrypted paper backup with its code kept apart sits between the two.</p>
<p>Written by Taha Bayar, who builds Kionel.</p>
<h2>The plan in four steps</h2>
<ol>
<li><strong>Export your password vault</strong> from your password manager, or write the important logins and recovery codes in a text file.</li>
<li><strong>Print it as encrypted codes</strong> with <a href="/encrypted-paper-backup.html">Kionel's paper backup</a>. Nothing is uploaded; the printer only sees codes.</li>
<li><strong>Keep the pages and the code in different places</strong>: for example the pages in your document folder at home, and the 12-character code with your will or with the person who will handle your affairs. Neither is useful alone.</li>
<li><strong>Write one line of instructions</strong> next to the code: "Open kionel.com on a phone, Receive → Printed pages, enter this code, point the camera at the pages." Then delete the unencrypted export.</li>
</ol>
<h2>What the big services already offer</h2>
<div class="table-scroll"><table><thead><tr><th>Option</th><th>What it does</th><th>Worth knowing</th></tr></thead><tbody>
<tr><td>Emergency access in password managers (for example Bitwarden)</td><td>A trusted person can request access to your vault after a waiting period you set</td><td>Needs the service, your account and theirs to exist when it is needed; often a paid plan.</td></tr>
<tr><td>Apple Legacy Contact</td><td>A chosen person can access your iCloud data after your death with an access key and a death certificate</td><td>Covers Apple's services only.</td></tr>
<tr><td>Google Inactive Account Manager</td><td>Shares chosen Google data with people you name if the account stays inactive</td><td>Covers Google's services only.</td></tr>
<tr><td>An encrypted paper backup</td><td>Your family opens the backup with the code</td><td>Works with no account and no company involved; you must reprint it when things change.</td></tr>
</tbody></table></div>
<p>They combine well: legacy features for the big accounts, and the paper backup for everything else, including the password manager itself.</p>
<h2>Keep it current</h2>
<ul>
<li>Reprint once a year, or after changing important passwords, and destroy the old pages.</li>
<li>Test the restore once yourself, so you know the instructions work.</li>
<li>For the strongest protection, print a password-protected export and leave that password with the code: the paper then holds a file encrypted twice.</li>
</ul>
<div class="actions"><a class="button" href="/transfer.html">Print a backup</a><a class="button secondary" href="/encrypted-paper-backup.html">Encrypted paper backup</a></div>` },
  { slug: "sifreleri-aileye-birakmak", guide: true, title: "Şifrelerinizi ailenize kâğıt üzerinde, güvenle nasıl bırakırsınız", description: "Başınıza bir şey gelirse hesaplarınıza erişimi aktarmanın bir planı: parola kasanızın şifreli kâğıt yedeği bir yerde, kodu başka bir yerde. Parola yöneticilerinin acil erişimi, Apple Eski Kişi ve Google Etkin Olmayan Hesap Yöneticisi ile karşılaştırma.", body: `
<p class="eyebrow">REHBER · DİJİTAL MİRAS</p><h1>Şifrelerinizi ailenize kâğıt üzerinde bırakmak</h1>
<p class="lead">Başınıza bir şey gelirse geride kalanların e-postanıza, banka girişlerinize ve buluttaki fotoğraflarınıza ihtiyacı olur. Her şifreyi bir kâğıda yazmak siz hayattayken tehlikelidir; hiçbir şey bırakmamak ise onları dışarıda bırakır. Kodu ayrı saklanan şifreli bir kâğıt yedek ikisinin arasında durur.</p>
<p>Yazan: Kionel'i geliştiren Taha Bayar.</p>
<h2>Dört adımda plan</h2>
<ol>
<li><strong>Parola kasanızı dışa aktarın</strong> ya da önemli girişleri ve kurtarma kodlarını bir metin dosyasına yazın.</li>
<li><strong>Şifreli kodlar olarak yazdırın</strong>: <a href="/sifreli-kagit-yedek.html">Kionel'in kâğıt yedeği</a> ile. Hiçbir şey yüklenmez; yazıcı yalnız kodları görür.</li>
<li><strong>Sayfaları ve kodu farklı yerlerde saklayın</strong>: örneğin sayfalar evdeki belge dosyanızda, 12 karakterlik kod vasiyetinizle ya da işlerinizi yürütecek kişide. Hiçbiri tek başına işe yaramaz.</li>
<li><strong>Kodun yanına tek satır talimat yazın</strong>: "Telefonda kionel.com'u açın, Receive → Printed pages, bu kodu girin, kamerayı sayfalara tutun." Sonra şifresiz dışa aktarımı silin.</li>
</ol>
<h2>Büyük hizmetlerin sunduğu</h2>
<div class="table-scroll"><table><thead><tr><th>Seçenek</th><th>Ne yapar</th><th>Bilmekte yarar var</th></tr></thead><tbody>
<tr><td>Parola yöneticilerinde acil erişim (örneğin Bitwarden)</td><td>Güvendiğiniz kişi, belirlediğiniz bekleme süresinden sonra kasanıza erişim isteyebilir</td><td>Gerektiğinde hizmetin, sizin ve onun hesabının var olmasını ister; çoğu zaman ücretli plandadır.</td></tr>
<tr><td>Apple Eski Kişi (Legacy Contact)</td><td>Seçtiğiniz kişi, ölümünüzden sonra erişim anahtarı ve ölüm belgesiyle iCloud verinize erişebilir</td><td>Yalnız Apple hizmetlerini kapsar.</td></tr>
<tr><td>Google Etkin Olmayan Hesap Yöneticisi</td><td>Hesap belirli bir süre kullanılmazsa seçtiğiniz Google verilerini adlandırdığınız kişilerle paylaşır</td><td>Yalnız Google hizmetlerini kapsar.</td></tr>
<tr><td>Şifreli kâğıt yedek</td><td>Aileniz yedeği kodla açar</td><td>Hesap ve şirket gerektirmez; bir şey değişince yeniden basmanız gerekir.</td></tr>
</tbody></table></div>
<p>Birlikte iyi çalışırlar: büyük hesaplar için miras özellikleri, parola yöneticisinin kendisi dahil geri kalan her şey için kâğıt yedek.</p>
<h2>Güncel tutun</h2>
<ul>
<li>Yılda bir kez ya da önemli şifreleri değiştirince yeniden basın, eski sayfaları imha edin.</li>
<li>Geri yüklemeyi bir kez kendiniz deneyin; talimatın çalıştığını bilin.</li>
<li>En güçlü koruma için parola korumalı bir dışa aktarım basın ve o parolayı kodla birlikte bırakın: kâğıtta iki kez şifrelenmiş bir dosya olur.</li>
</ul>
<div class="actions"><a class="button" href="/transfer.html">Yedek yazdır</a><a class="button secondary" href="/sifreli-kagit-yedek.html">Şifreli kâğıt yedek</a></div>` },
  { slug: "sichere-datenuebertragung-offline", lang: "de", title: "Dateien von Offline-PCs übertragen – ohne USB-Stick, mit signiertem Nachweis", description: "Kionel überträgt Dateien von isolierten Mess- und Anlagenrechnern per Bildschirm und Kamera, als gedruckte Seiten oder über ein serielles Einwegkabel – verschlüsselt und mit einem Nachweis, den beide Seiten signieren. Im Browser, ohne Installation.", body: `
<p class="eyebrow">LABOR UND INDUSTRIE</p><h1>Raus aus dem Offline-PC. Ohne USB-Stick, mit Nachweis.</h1>
<p class="lead">Messrechner im Labor und Bedienstationen in der Anlage bleiben aus gutem Grund vom Netz getrennt. Ihre Ergebnisse, Protokolle und Berichte verlassen sie trotzdem, meist auf einem USB-Stick, und niemand hält fest, welche Datei ging und ob sie unverändert ankam.</p>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<h2>Drei Wege, keiner braucht Netz oder Wechseldatenträger</h2>
<ul>
<li><strong>Bildschirm zur Kamera.</strong> Der Offline-PC zeigt die Datei als verschlüsselte Codes, ein Smartphone oder ein Rechner mit Kamera liest sie. Für Dateien von einigen Kilobyte bis wenigen Megabyte.</li>
<li><strong>Gedruckte Seiten.</strong> Hat der PC nur einen Drucker, wird die Datei als Seiten mit verschlüsselten Codes gedruckt und später mit einer beliebigen Kamera gelesen, in beliebiger Reihenfolge. <a href="/datei-als-qr-code-drucken.html">So funktioniert es</a>.</li>
<li><strong>Serielles Einwegkabel.</strong> Nur Sende- und Masseleitung verbunden: physisch kann nichts zurück. Bis etwa 80 KB/s, auch unbeaufsichtigt aus einem überwachten Ordner. <a href="/serielle-datendiode.html">Verdrahtung und Grenzen</a>.</li>
</ul>
<h2>Was im Audit sichtbar ist</h2>
<p>Das sendende Gerät signiert einen Versanddatensatz: SHA-256 und Größe der Datei, Zeit, Auftrags- oder Probennummer, Einstufung und den angegebenen Namen der bedienenden Person. Das empfangende Gerät prüft die Datei dagegen und signiert eine Empfangsbestätigung. Auf Wunsch trägt die Bestätigung einen RFC-3161-Zeitstempel von DigiCert. Beide Datensätze lassen sich offline mit einem kostenlosen Prüfprogramm unter Apache-2.0-Lizenz kontrollieren, ohne uns.</p>
<h2>Für wen</h2>
<ul>
<li><strong>Labore unter GMP und GLP:</strong> Ergebnisdateien vom Messrechner ins LIMS, mit Nachweis je Datei. <a href="/messdaten-offline-pc-lims.html">Vom Offline-PC ins LIMS</a> · <a href="/annex-11-dateitransfer.html">Annex 11 und Dateitransfer</a></li>
<li><strong>Industrie und OT:</strong> Protokolle, Alarmexporte und Rezepturen aus isolierten Zonen. <a href="/ot-dateitransfer-ohne-usb.html">OT: Dateien ohne USB-Stick</a></li>
<li><strong>Alle, die ihre Daten schützen:</strong> <a href="/verschluesseltes-papier-backup.html">verschlüsseltes Papier-Backup</a> eines Passworttresors oder von 2FA-Codes.</li>
</ul>
<h2>Was Kionel nicht ist</h2>
<ul>
<li>Kein Virenscanner: Der Inhalt der Datei wird nicht geprüft.</li>
<li>Noch ohne unabhängiges Sicherheitsaudit; die Protokolle sind in ProVerif modelliert und maschinell geprüft.</li>
<li>Das serielle Kabel ist eine Einwegverbindung durch Verdrahtung, keine zertifizierte Datendiode.</li>
</ul>
<h2>Kostenlos testen</h2>
<p>Kionel ist kostenlos und quelloffen (AGPL-3.0): Dateien bis 64 MB, signierte Datensätze, Berichte und das serielle Kabel sind enthalten. Mehr auf Englisch auf der <a href="/pilot.html">Open-Source-Seite</a>.</p>
<div class="actions"><a class="button" href="/transfer.html">Kostenlos testen</a><a class="button secondary" href="/contact.html">Kontakt</a></div>` },
  { slug: "messdaten-offline-pc-lims", lang: "de", guide: true, title: "Messdaten vom Offline-PC ins LIMS – ohne USB-Stick und ohne Netzanbindung", description: "Wege, eine Ergebnisdatei von einem isolierten Messrechner ins LIMS zu bringen: Abtippen, Netzordner, USB-Stick, Middleware, Bildschirm-zu-Kamera oder serielles Einwegkabel in einen überwachten Ordner. Was jeder Weg kostet und was im Audit sichtbar ist.", body: `
<p class="eyebrow">LEITFADEN · LABOR</p><h1>Vom Offline-Messrechner ins LIMS</h1>
<p class="lead">Das LIMS ist im Netz. Der Messrechner absichtlich nicht. Dazwischen muss eine Ergebnisdatei hinüber, und wie sie hinüberkommt, entscheidet, ob das LIMS die Daten des Geräts enthält oder eine Kopie, die jemand angefertigt hat.</p>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<h2>Die üblichen Wege</h2>
<div class="table-scroll"><table><thead><tr><th>Weg</th><th>Was im LIMS ankommt</th><th>Was er kostet</th></tr></thead><tbody>
<tr><td><strong>Ergebnisse abtippen</strong></td><td>Werte, nicht die Datei</td><td>Übertragungsfehler und eine zweite Person, die jeden Eintrag prüft.</td></tr>
<tr><td><strong>Messrechner ins Netz, überwachter Ordner</strong></td><td>Die Datei, automatisch</td><td>Der Rechner ist nicht mehr isoliert: Patches, Konten und Firewall-Regeln für eine Maschine, die aus gutem Grund offline war.</td></tr>
<tr><td><strong>USB-Stick zu einem vernetzten PC</strong></td><td>Die Datei, wenn sie unterwegs niemand geöffnet hat</td><td>Regeln für Wechseldatenträger, Scans und eine Lücke im Nachweis zwischen den beiden Rechnern.</td></tr>
<tr><td><strong>Middleware oder SDMS des Herstellers</strong></td><td>Datei und Metadaten</td><td>Wieder eine Netzverbindung, dazu ein Produkt je Gerätehersteller.</td></tr>
<tr><td><strong>Bildschirm zur Kamera, in einen überwachten Ordner</strong></td><td>Die Datei, Byte für Byte, mit signierter Bestätigung</td><td>Ein PC mit Webcam neben dem Messrechner; Sekunden bis Minuten je Datei, je nach Größe.</td></tr>
<tr><td><strong>Serielles Einwegkabel, in einen überwachten Ordner</strong></td><td>Die Datei, Byte für Byte, mit signierter Bestätigung, auch unbeaufsichtigt</td><td>Ein Kabel mit nur Sende- und Masseleitung; bis etwa 80 KB/s.</td></tr>
</tbody></table></div>
<h2>So läuft es mit Kionel</h2>
<ol>
<li>Auf dem Messrechner läuft das <a href="/offline-package.html">Offline-Paket</a>: eine einzige HTML-Datei mit veröffentlichtem SHA-256, ohne Netz. Es zeigt die Datei als verschlüsselte Codes oder sendet sie über das Kabel und signiert einen Versanddatensatz mit SHA-256 und Auftragsnummer.</li>
<li>Ein vernetzter PC in Chrome oder Edge empfängt. Unter <em>Receive</em> einmal <strong>Save received files to a folder</strong> wählen und den Ordner angeben, aus dem Ihr LIMS bereits importiert.</li>
<li>Bei der Zustellung landet die Datei in diesem Ordner, daneben <code>&lt;name&gt;.makbuz.json</code>: die von beiden Rechnern signierte Bestätigung. Nichts wird überschrieben; eine zweite Kopie heißt <code>name (2).csv</code>.</li>
<li>Ordnet Ihr Import Dateien nach Namen zu, setzen Sie <em>File names in the folder</em>, etwa <code>{workorder}_{name}</code>. Die Werte stammen aus dem signierten Datensatz; niemand benennt von Hand um.</li>
</ol>
<p>Für Dateien, die laufend entstehen, kann der Messrechner einen Ordner überwachen und jede neue Datei unbeaufsichtigt über das Kabel senden; der Empfänger hört weiter und legt jede Datei mit Bestätigung ab. Kionel hat keinen LIMS-Konnektor und braucht keinen: Der Ordner ist die Schnittstelle.</p>
<h2>Drei Hinweise für die Einrichtung des Imports</h2>
<ul>
<li><strong>Warten, bis die Datei vollständig ist.</strong> Chrome legt die Datei zuerst leer an, schreibt in eine temporäre <code>.crswap</code>-Datei und tauscht erst am Ende. Den Import <code>*.crswap</code> ignorieren und warten lassen, bis eine Datei nicht leer und stabil ist.</li>
<li><strong>Bestätigungen neben den Daten.</strong> Liest der Parser jede Datei im Ordner, <code>*.makbuz.json</code> ausschließen oder als Transfernachweis an die Probe hängen.</li>
<li><strong>Berechtigung nach einem Neustart.</strong> Nach einem Browser-Neustart fragt Chrome einmal erneut nach dem Ordner; bis dahin werden Dateien nur zum Herunterladen angeboten, und die Anwendung sagt das.</li>
</ul>
<h2>Was das Audit sieht</h2>
<p>Für jede Datei: den auf dem Messrechner signierten Versanddatensatz, die auf dem Empfangsrechner signierte Bestätigung, beide mit demselben SHA-256 und derselben Auftragsnummer, und eine Datei im LIMS-Ordner mit passendem SHA-256. Wie das zu den Anforderungen von <a href="/annex-11-dateitransfer.html">EU-GMP Annex 11</a> passt, steht dort.</p>
<div class="actions"><a class="button" href="/transfer.html">Kostenlos testen</a><a class="button secondary" href="/excel-csv-fehler-pruefen.html">CSV auf Excel-Schäden prüfen</a></div>` },
  { slug: "annex-11-dateitransfer", lang: "de", guide: true, title: "EU-GMP Annex 11 und die Datei, die das System wechselt", description: "Welche Abschnitte von EU-GMP Anhang 11 (computergestützte Systeme) eine Dateiübergabe zwischen Laborsystemen berühren – Datenaustausch, Datenspeicherung, Audit Trail, periodische Überprüfung – und welche Nachweise ein signierter Transferdatensatz liefern kann und welche nicht.", body: `
<p class="eyebrow">LEITFADEN · GMP</p><h1>Annex 11 und die Datei, die das System wechselt</h1>
<p class="lead">Die meiste Aufmerksamkeit bei Annex 11 gilt den Systemen selbst: CDS, LIMS, ELN. Der Moment zwischen ihnen bekommt weniger: die Datei, die auf einem System exportiert und auf einem anderen importiert wird. Genau dort beginnen viele Feststellungen zu lückenhaften Audit Trails.</p>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<p><em>Dies ist keine Rechts- oder Regulierungsberatung. Wie ein Werkzeug validiert und eingesetzt wird, entscheidet Ihre Qualitätseinheit nach Ihren Verfahren.</em></p>
<h2>Welche Abschnitte eine Dateiübergabe berührt</h2>
<div class="table-scroll"><table><thead><tr><th>Anhang 11</th><th>Worum es geht</th><th>Was ein signierter Transferdatensatz beiträgt</th></tr></thead><tbody>
<tr><td><strong>5 Daten</strong></td><td>Systeme, die Daten elektronisch austauschen, sollen geeignete eingebaute Prüfungen auf korrekte und sichere Eingabe und Verarbeitung haben.</td><td>Der SHA-256 der Datei wird auf dem sendenden Gerät signiert und auf dem empfangenden geprüft; eine veränderte Datei wird nicht zugestellt.</td></tr>
<tr><td><strong>7 Datenspeicherung</strong></td><td>Daten sollen gegen Beschädigung geschützt und auf Lesbarkeit und Richtigkeit geprüft werden.</td><td>Die Bestätigung liegt neben der Datei; wer die Datei später prüft, vergleicht ihren SHA-256 mit dem signierten Wert.</td></tr>
<tr><td><strong>9 Audit Trail</strong></td><td>Risikobasiert ein systemgenerierter Nachweis GMP-relevanter Änderungen und Löschungen.</td><td>Ein lokales, hashverkettetes Protokoll je Gerät: Ein entfernter oder eingefügter Eintrag wird sichtbar.</td></tr>
<tr><td><strong>11 Periodische Überprüfung</strong></td><td>Systeme regelmäßig bewerten.</td><td>Ein Transferprotokoll je Gerät mit CSV-Export und druckbarem Bericht für die periodische Durchsicht.</td></tr>
<tr><td><strong>12 Sicherheit</strong></td><td>Wer Daten eingibt oder ändert, soll mit Datum und Uhrzeit erfasst werden.</td><td>Der angegebene Name der bedienenden Person steht signiert im Datensatz; das ist eine Angabe, keine Anmeldung.</td></tr>
</tbody></table></div>
<h2>Was ein Transferdatensatz nicht leistet</h2>
<ul>
<li><strong>Er ersetzt nicht die Validierung.</strong> Ein <a href="/validation-pack.html">IQ/OQ-Protokoll mit Rückverfolgbarkeit</a> (Englisch) erleichtert sie; die Entscheidungen bleiben bei Ihnen.</li>
<li><strong>Schlüssel, nicht Personen.</strong> Eine Signatur zeigt, welcher Geräteschlüssel signiert hat. Die Zuordnung zu einer Person leistet Ihr Identitätsprozess.</li>
<li><strong>Gerätezeiten sind Gerätezeiten.</strong> Für eine unabhängige Zeit kann die Bestätigung einen RFC-3161-Zeitstempel tragen.</li>
<li><strong>Kein Ersatz für die Audit Trails von CDS und LIMS.</strong> Er schließt die Lücke dazwischen.</li>
</ul>
<div class="actions"><a class="button" href="/messdaten-offline-pc-lims.html">Vom Offline-PC ins LIMS</a><a class="button secondary" href="/transfer.html">Kostenlos testen</a></div>` },
  { slug: "ot-dateitransfer-ohne-usb", lang: "de", guide: true, title: "Protokolle, Rezepturen und Berichte aus einer isolierten Anlage – ohne USB-Stick", description: "Wie kleine Dateien eine isolierte OT-Zone verlassen, ohne USB-Stick und ohne Netzanbindung: per Bildschirm und Kamera oder über ein serielles Einwegkabel, auch unbeaufsichtigt aus einem überwachten Ordner, mit signiertem Nachweis je Datei. Und wo das nicht passt.", body: `
<p class="eyebrow">LEITFADEN · INDUSTRIE</p><h1>Aus dem Anlagennetz, ohne USB-Stick</h1>
<p class="lead">Bedienstationen, Engineering-Workstations und Historian-Clients bleiben vom Büronetz getrennt. Ihre Protokolle, Chargenberichte, Alarmexporte und Rezepturen müssen trotzdem hinaus, und in vielen Werken gehen sie auf einem USB-Stick: dem Weg, den die meisten Sicherheitsprogramme schließen wollen.</p>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<h2>Was Kionel in der Anlage tut</h2>
<ul>
<li><strong>Kein Datenträger, kein Netz, kein Agent.</strong> Die Station zeigt die Datei im Browser als Codes, ein Smartphone liest sie. Nichts wird eingesteckt oder installiert.</li>
<li><strong>Nachweisbare Integrität.</strong> Die Datei wird für das empfangende Gerät verschlüsselt, ihr SHA-256 mit dem Änderungsticket signiert, und der Empfänger signiert, dass sie unverändert ankam.</li>
<li><strong>Nur der Nachweis.</strong> Wo die Daten die Zone gar nicht verlassen dürfen, versiegelt die Station eine Datei: Nur ein kleiner signierter Datensatz mit Hash, Zeit und Ticket geht hinaus.</li>
</ul>
<h2>Unbeaufsichtigt: ein Ordner, der sich selbst sendet</h2>
<p>Für Protokolle, die den ganzen Tag entstehen, soll niemand an der Station stehen. Die Station überwacht einen Ordner und sendet jede neue oder geänderte Datei über ein <a href="/serielle-datendiode.html">serielles Einwegkabel</a>: verschlüsselt für die Karte des Empfangsrechners, mit dem Ticket signiert und auf der anderen Seite mit Bestätigung in einen Ordner geschrieben, den ein Historian oder SIEM abholt. Ohne Rückleitung erreicht nichts die Station.</p>
<p>Es ist eine Dateiverbindung, keine Netzbrücke: Dateien statt Protokolle, bis etwa 80 KB/s, und weil nichts zurückkommt, wird eine Datei, die bei ausgeschaltetem Empfänger gesendet wurde, nicht von selbst wiederholt. Das Protokoll der sendenden Station zeigt, was ging.</p>
<h2>Die Richtung zählt</h2>
<div class="table-scroll"><table><thead><tr><th>Richtung</th><th>Passt</th><th>Warum</th></tr></thead><tbody>
<tr><td><strong>Aus der Anlage</strong> (Protokolle, Berichte, Alarmexporte)</td><td class="ok">Gut</td><td>Die Station braucht nur einen Bildschirm oder das Kabel.</td></tr>
<tr><td><strong>In die Anlage</strong> (Rezepturen, Referenzdateien)</td><td class="warn">Mit Kamera am Ziel oder umgedrehtem Kabel</td><td>Ein umgekehrt verdrahtetes Einwegkabel bringt Dateien hinein, und nichts kann hinaus.</td></tr>
<tr><td><strong>Große Dateien</strong> (Historian-Archive, Images)</td><td class="warn">Falsches Werkzeug</td><td>Zehntel Megabyte pro Sekunde reichen dafür nicht. Dafür gibt es Datendioden oder kontrollierte Netzübergänge.</td></tr>
</tbody></table></div>
<p>Hardware-Datendioden kosten je Verbindung von einigen Tausend bis weit über 100.000 US-Dollar. Kionel wird je Standort lizenziert; kontinuierliche Verbindungen je Link, <a href="/contact.html">sprechen Sie uns an</a>. Kionel prüft keine Dateiinhalte auf Schadsoftware und hatte noch kein unabhängiges Sicherheitsaudit.</p>
<div class="actions"><a class="button" href="/serielle-datendiode.html">Serielles Einwegkabel</a><a class="button secondary" href="/transfer.html">Kostenlos testen</a></div>` },
  { slug: "serielle-datendiode", lang: "de", guide: true, title: "Ein serielles Einwegkabel als günstige Datendiode für Dateien", description: "Dateien von einem isolierten PC über ein RS-232-Kabel ohne Rückleitung übertragen, sodass physisch nichts zurückkommt: Verdrahtung, Geschwindigkeiten, Übertragungszeiten, Unterschiede zu einer zertifizierten Datendiode und wie Kionel aus dem Browser darüber sendet.", body: `
<p class="eyebrow">LEITFADEN · BUSINESS-EDITION</p><h1>Ein serielles Einwegkabel als günstige Datendiode</h1>
<p class="lead">Eine Datendiode lässt Daten aus einem Netz heraus und macht es physisch unmöglich, dass etwas zurückkommt. Für Dateien von einem einzelnen isolierten PC passt dieselbe physikalische Idee in ein serielles Kabel: Die Sendeleitung des Senders geht an die Empfangsleitung des Empfängers, die andere Richtung bleibt unverbunden.</p>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<h2>Die Verdrahtung</h2>
<p>Am 9-poligen seriellen Stecker (DB9) sendet ein PC auf Pin 3 (TXD), empfängt auf Pin 2 (RXD), Pin 5 ist Signalmasse. Ein Einwegkabel hat nur zwei Adern:</p>
<div class="table-scroll"><table><thead><tr><th>Sender (isoliert)</th><th></th><th>Empfänger</th></tr></thead><tbody>
<tr><td>Pin 3, TXD (senden)</td><td>→</td><td>Pin 2, RXD (empfangen)</td></tr>
<tr><td>Pin 5, GND</td><td>—</td><td>Pin 5, GND</td></tr>
<tr><td>Pin 2, RXD</td><td>nicht verbunden</td><td>Pin 3, TXD</td></tr>
</tbody></table></div>
<p>Mit zwei DB9-Schraubadaptern und zwei Adern gebaut, oder aus einem Nullmodemkabel, bei dem alle Adern außer TXD→RXD und Masse getrennt werden. Kabel mit der Richtung beschriften; falsch herum überträgt es nichts.</p>
<h2>Geschwindigkeiten</h2>
<div class="table-scroll"><table><thead><tr><th>Baudrate</th><th>Etwa</th><th>1 MB dauert</th><th>Wo es funktioniert</th></tr></thead><tbody>
<tr><td>115.200</td><td>10 KB/s</td><td>etwa 1 min 45 s</td><td>Jede Schnittstelle, auch der eingebaute COM-Port</td></tr>
<tr><td>230.400</td><td>20 KB/s</td><td>etwa 50 s</td><td>Die meisten USB-Seriell-Adapter</td></tr>
<tr><td>460.800</td><td>40 KB/s</td><td>etwa 25 s</td><td>Die meisten USB-Seriell-Adapter</td></tr>
<tr><td>921.600</td><td>80 KB/s</td><td>etwa 13 s</td><td>Adapter mit FTDI-, CH340- und ähnlichen Chips, kurzes Kabel</td></tr>
</tbody></table></div>
<h2>Senden mit Kionel</h2>
<ol>
<li>Auf dem Empfangsrechner Kionel in Chrome oder Edge öffnen, <strong>Receive → Sender has no camera — show a code</strong> und <strong>Serial cable</strong> wählen, Baudrate einstellen, <strong>Choose the serial port and listen</strong>.</li>
<li>Auf dem isolierten PC Kionel öffnen (das <a href="/offline-package.html">Offline-Paket</a> genügt), Datei wählen, Code des Empfängers eingeben, <strong>Send over a serial cable</strong> öffnen, gleiche Baudrate, <strong>Choose the serial port and send</strong>.</li>
<li>Der Empfänger prüft die Datei gegen den signierten Versanddatensatz und signiert die Bestätigung.</li>
</ol>
<p>Unbeaufsichtigt überwacht der Sender stattdessen einen Ordner und sendet jede neue oder geänderte Datei; der Empfänger mit <em>Keep listening after each file</em> legt jede Datei mit Bestätigung ab. Umgedreht wird der isolierte PC zum Empfänger: Rezepturen gehen hinein, und nichts kann hinaus.</p>
<h2>Unterschied zu einer zertifizierten Datendiode</h2>
<ul>
<li><strong>Keine Zertifizierung.</strong> Kommerzielle Dioden sind z. B. nach Common Criteria bewertet. Ein selbstgebautes Kabel ist so gut wie seine Verdrahtung und seine Beschriftung.</li>
<li><strong>Ein USB-Adapter ist ein USB-Gerät.</strong> Wo USB gesperrt ist, den eingebauten COM-Port mit 115.200 Baud nutzen oder den Adapter freigeben lassen.</li>
<li><strong>Dateien, keine Netzbrücke</strong>, und der Inhalt wird nicht geprüft.</li>
</ul>
<div class="actions"><a class="button" href="https://github.com/Apeiron01/kionel">Quellcode auf GitHub</a><a class="button secondary" href="/transfer.html">Kionel öffnen</a></div>` },
  { slug: "excel-csv-fehler-pruefen", lang: "de", guide: true, head: '<script type="module" src="/src/excel-check-page.ts"></script>', title: "CSV auf Excel-Schäden prüfen: Datumsfehler, verlorene Nullen, gekürzte Barcodes", description: "Kostenlos, im Browser, ohne Upload: findet, was Excel in einer CSV hinterlässt – Dezimalzahlen und Gensymbole als Datum (1.12 wird 01. Dez), wissenschaftliche Schreibweise, Stellen nach der 15., entfernte führende Nullen, verstümmelte Umlaute. Mit der Originaldatei jede geänderte Zelle.", body: `
<p class="eyebrow">KOSTENLOSES WERKZEUG · KEIN UPLOAD</p><h1>CSV auf Excel-Schäden prüfen</h1>
<p class="lead">Legen Sie eine CSV ab, die durch Excel gegangen ist. Die Seite sucht, was Excel hinterlässt: 1.12 wird in deutschem Excel zu 01. Dez, ein Barcode zu 1,23457E+18, Probe 00123 zu 123. Die Datei wird in diesem Browser-Tab gelesen und nie hochgeladen.</p>
<label class="drop" id="xl-after-drop"><input type="file" id="xl-after-file" accept=".csv,.txt,.tsv,text/csv,text/plain"><span>CSV zum Prüfen hier ablegen oder klicken</span></label>
<button type="button" class="button secondary drop-clear" id="xl-after-clear" hidden>Diese Datei entfernen</button>
<label class="drop" id="xl-original-drop"><input type="file" id="xl-original-file" accept=".csv,.txt,.tsv,text/csv,text/plain"><span>Optional: die Originaldatei vor Excel ablegen</span></label>
<button type="button" class="button secondary drop-clear" id="xl-original-clear" hidden>Original entfernen</button>
<p id="xl-status" class="evidence-status" role="status" hidden></p>
<div id="xl-result" hidden><ul id="xl-summary"></ul>
<div class="table-scroll"><table id="xl-table"></table></div><p id="xl-more" class="note"></p>
<p><button type="button" class="button secondary" id="xl-download">Befunde herunterladen (CSV)</button></p></div>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<h2>Was deutsches Excel besonders macht</h2>
<ul>
<li><strong>Dezimalpunkt wird Datum.</strong> Mit deutschen Ländereinstellungen ist das Dezimaltrennzeichen ein Komma. Ein Gerät, das 1.12 oder 12.5 mit Punkt schreibt, liefert in Excel den 1. Dezember und den 12. Mai; 0.8 bleibt Text und rechnet nicht mit.</li>
<li><strong>Alles in einer Spalte.</strong> Das Listentrennzeichen ist das Semikolon; eine per Doppelklick geöffnete CSV mit Kommas landet in einer Spalte. Beim Speichern schreibt Excel Semikolons und Dezimalkommas, die ein Programm, das Kommas erwartet, nicht liest.</li>
<li><strong>Umlaute.</strong> „CSV (Trennzeichen-getrennt)“ speichert in der alten Codepage, nicht in UTF-8; in einem anderen System erscheint ü dann als Ã¼. „CSV UTF-8“ ist ein eigener Eintrag.</li>
</ul>
<h2>Was die Prüfung findet</h2>
<div class="table-scroll"><table><thead><tr><th>Befund</th><th>Beispiel</th><th>Woran er erkannt wird</th></tr></thead><tbody>
<tr><td>Dezimalzahl als Datum</td><td><code>01. Dez</code>, <code>12.Mai</code></td><td>Tag und deutscher Monatsname; die Seite nennt den wahrscheinlichen Ursprungswert.</td></tr>
<tr><td>Gensymbol als Datum</td><td><code>1-Mar</code>, <code>Sep-15</code></td><td>Englisches Excel macht aus MARCH1 und SEPT15 Daten; vorgeschlagen werden alter und heutiger HGNC-Name.</td></tr>
<tr><td>Lange Zahl in wissenschaftlicher Schreibweise</td><td><code>1,23457E+18</code></td><td>Excels Anzeige für Zahlen ab 12 Stellen; echte Messwerte wie <code>1,2E-05</code> bleiben unberührt.</td></tr>
<tr><td>Stellen nach der 15. verloren</td><td><code>1234567890123450000</code></td><td>16 oder mehr Stellen, ab der 16. nur Nullen.</td></tr>
<tr><td>Führende Nullen entfernt</td><td><code>126</code> zwischen <code>00123</code>, <code>00124</code></td><td>Eine kürzere Zahl in einer sonst mit Nullen aufgefüllten Spalte.</td></tr>
<tr><td>Verstümmelte Zeichen</td><td><code>Ã¼</code> statt ü</td><td>UTF-8, als westliche Codepage gelesen.</td></tr>
</tbody></table></div>
<p>Ohne Original sind die Befunde wahrscheinlich, nicht sicher. Mit Original wird jede Zelle verglichen; sind beide Dateien Byte für Byte gleich, sagt die Seite das. Wer eine Ergebnisdatei gar nicht erst durch Excel schicken will: <a href="/messdaten-offline-pc-lims.html">die Datei als Bytes übertragen</a> und den <a href="/sha256-pruefen.html">SHA-256</a> an der Quelle nehmen.</p>
<div class="actions"><a class="button" href="/transfer.html">Kionel öffnen</a><a class="button secondary" href="/sha256-pruefen.html">SHA-256 prüfen</a></div>` },
  { slug: "datei-als-qr-code-drucken", lang: "de", guide: true, title: "Eine Datei als QR-Codes drucken und mit dem Handy zurücklesen", description: "Eine kleine Datei im Browser als Seiten mit verschlüsselten QR-Codes drucken und später mit einer beliebigen Handykamera in beliebiger Reihenfolge zurücklesen, oder aus Fotos und Scans. Für PCs mit nur einem Drucker und als Papier-Backup. Keine Installation, kein Upload.", body: `
<p class="eyebrow">KOSTENLOS · IM BROWSER</p><h1>Eine Datei als QR-Codes drucken und zurücklesen</h1>
<p class="lead">Manche Rechner haben einen Drucker und sonst nichts: kein Netz, kein USB, keine Kamera. Kionel druckt eine Datei als Seiten mit verschlüsselten QR-Codes; jedes Handy mit Browser liest die Seiten in beliebiger Reihenfolge und baut die Datei Byte für Byte wieder auf.</p>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<h2>Drucken</h2>
<ol>
<li><a href="/transfer.html">Kionel</a> auf dem Rechner mit Drucker öffnen (das <a href="/offline-package.html">Offline-Paket</a> läuft ohne Netz), <strong>Print on paper</strong> wählen, Datei wählen, Dichte wählen und <strong>Print the file as codes</strong> drücken.</li>
<li>Kionel zeigt einen 12-stelligen Code in großer Schrift. Notieren und getrennt von den Seiten aufbewahren: Ohne ihn sind die Seiten nicht lesbar.</li>
</ol>
<h2>Zurücklesen</h2>
<ol>
<li>Auf dem Handy Kionel öffnen, <strong>Receive → Printed pages</strong>, Code eingeben. Man kann auch zuerst scannen: Sind alle nötigen Codes gelesen, fragt Kionel nach dem Code, und ein falscher Code verwirft nichts.</li>
<li>Kamera auf die Seiten richten, eine nach der anderen, in beliebiger Reihenfolge.</li>
</ol>
<h2>Wie viel auf eine Seite passt</h2>
<div class="table-scroll"><table><thead><tr><th>Dichte</th><th>Codes je Seite</th><th>Daten je Seite</th><th>Drucker</th></tr></thead><tbody>
<tr><td>Standard</td><td>6, je etwa 6,4 cm</td><td>etwa 4 KB</td><td>Jeder Laser- oder Tintenstrahldrucker</td></tr>
<tr><td>Dicht</td><td>12, je etwa 4,8 cm</td><td>etwa 11 KB</td><td>Laserdrucker mit 600 dpi</td></tr>
</tbody></table></div>
<p>Text und CSV werden vorher komprimiert. Kionel druckt und liest bis zu 60 Seiten und öffnet auch Fotos und Scans der Seiten.</p>
<h2>Wenn ein Code verschmiert oder eine Seite eingerissen ist</h2>
<p>Etwa 30 % der Codes sind Reserve. Sie sind keine Kopien: Jeder mischt ein Drittel der Datei und kann für jeden verlorenen Code einspringen. In unseren Tests kam eine 30-KB-Datei mit 8 von 48 fehlenden Codes in 91 % von 300 Versuchen zurück, eine 150-KB-Datei mit 12 fehlenden Codes in allen 100 Versuchen. Mit gewöhnlichen zufälligen Reservecodes waren es bei der 30-KB-Datei 3 %.</p>
<div class="actions"><a class="button" href="/transfer.html">Datei drucken</a><a class="button secondary" href="/verschluesseltes-papier-backup.html">Verschlüsseltes Papier-Backup</a></div>` },
  { slug: "verschluesseltes-papier-backup", lang: "de", guide: true, title: "Verschlüsseltes Papier-Backup von Passworttresor, 2FA-Wiederherstellungscodes oder Schlüsseln", description: "Einen Passwortmanager-Export, 2FA-Wiederherstellungscodes, eine KeePass-Datenbank oder einen SSH-Schlüssel im Browser als Seiten verschlüsselter QR-Codes drucken und später mit dem Handy wiederherstellen. Der Drucker sieht nur verschlüsselte Codes. Kostenlos bis 5 Seiten.", body: `
<p class="eyebrow">KOSTENLOS · IM BROWSER · KEIN UPLOAD</p><h1>Ein verschlüsseltes Papier-Backup Ihres Tresors, Ihrer Codes oder Schlüssel</h1>
<p class="lead">Ein Papier-Backup übersteht eine defekte Festplatte, ein verlorenes Handy und ein gesperrtes Konto. Der übliche Rat, den Export als Text zu drucken, legt jedes Passwort auf ein Blatt, das jeder lesen kann. Kionel druckt die Datei stattdessen als verschlüsselte QR-Codes.</p>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<h2>So geht es</h2>
<ol>
<li><strong>Datei exportieren.</strong> In Bitwarden: <em>Tools → Export vault</em>; am stärksten ist <em>.json (Encrypted)</em> mit <em>Password protected</em>, das braucht aber mehr Seiten, weil verschlüsselte Daten sich nicht komprimieren lassen. In KeePassXC die .kdbx-Datenbank selbst drucken: Sie ist bereits verschlüsselt. 2FA-Codes als Textdatei speichern.</li>
<li><strong>Mit Kionel drucken</strong>: <a href="/transfer.html">Kionel</a> öffnen, Datei wählen, <em>Print on paper</em>, bei Bedarf Dicht wählen.</li>
<li><strong>Code getrennt von den Seiten aufbewahren.</strong> Ohne den 12-stelligen Code sind die Seiten nicht lesbar.</li>
<li><strong>Den unverschlüsselten Export löschen</strong>, auch aus Downloads und Papierkorb.</li>
<li><strong>Die Wiederherstellung einmal testen</strong>: Handy, <em>Receive → Printed pages</em>, Code eingeben, Kamera auf die Seiten.</li>
</ol>
<h2>Warum zwei Schichten Verschlüsselung</h2>
<p>Der Code schützt die Seiten mit einem Schlüssel aus 12 Zeichen (60 Bit); jeder Rateversuch kostet 600.000 PBKDF2-Runden. Das hält jemanden auf, der den Umschlag findet. Für Geheimnisse, die jahrzehntelang gegen einen gut ausgestatteten Angreifer halten sollen, einen bereits passwortgeschützten Export drucken: Das Papier enthält dann eine doppelt verschlüsselte Datei.</p>
<h2>Was der Drucker sieht</h2>
<p>Nur die verschlüsselten Codes. Büro- und Netzwerkdrucker speichern Aufträge oft; mit Kionel ist diese Kopie genauso unlesbar wie das Papier, solange Sie den Code nicht mitdrucken.</p>
<div class="actions"><a class="button" href="/transfer.html">Backup drucken</a><a class="button secondary" href="/datei-als-qr-code-drucken.html">So funktioniert das Drucken</a></div>` },
  { slug: "sha256-pruefen", lang: "de", guide: true, head: '<script type="module" src="/src/hash-tool.ts"></script>', title: "SHA-256 prüfen – im Browser oder mit einem Befehl unter Windows, Mac und Linux", description: "Den SHA-256 einer Datei im Browser berechnen, ohne Upload, oder mit einem eingebauten Befehl unter Windows, macOS und Linux. Und fünf Gründe, warum zwei Hashwerte „derselben“ Datei abweichen.", body: `
<p class="eyebrow">KOSTENLOSES WERKZEUG · LEITFADEN</p><h1>SHA-256 prüfen: hier oder mit einem Befehl</h1>
<p class="lead">Datei ablegen, SHA-256 erhalten. Berechnet wird in diesem Browser-Tab: Die Datei wird nicht hochgeladen, und nach dem ersten Laden funktioniert die Seite auch ohne Netz.</p>
<label class="drop" id="hash-drop"><input type="file" id="hash-file"><span>Datei hier ablegen oder klicken</span></label>
<div id="hash-output" hidden><dl class="evidence-facts"><dt>Datei</dt><dd id="hash-name"></dd><dt>Größe</dt><dd id="hash-size"></dd><dt>SHA-256</dt><dd id="hash-value"></dd></dl>
<p><button type="button" class="button secondary" id="hash-copy">SHA-256 kopieren</button> <button type="button" class="button secondary" id="hash-clear">Datei entfernen</button></p></div>
<p><label for="hash-expected">Erwarteter SHA-256 zum Vergleich (optional)</label><input id="hash-expected" type="text" autocomplete="off" spellcheck="false" placeholder="Den erhaltenen Wert einfügen"></p>
<p id="hash-status" class="evidence-status" role="status" hidden></p>
<p>Von Taha Bayar, Biologe, der an der Datenübergabe zwischen isolierten Systemen arbeitet.</p>
<h2>Derselbe Test auf der Kommandozeile</h2>
<div class="table-scroll"><table><thead><tr><th>System</th><th>Befehl</th><th>Gut zu wissen</th></tr></thead><tbody>
<tr><td>Windows, Eingabeaufforderung</td><td><code>certutil -hashfile "C:\\daten\\messung_041.csv" SHA256</code></td><td>Eingebaut. Unter Windows 7 mit Leerzeichen zwischen den Zeichenpaaren; sie gehören nicht zum Wert.</td></tr>
<tr><td>Windows, PowerShell</td><td><code>Get-FileHash "C:\\daten\\messung_041.csv"</code></td><td>SHA-256 ist Standard; gibt Großbuchstaben aus.</td></tr>
<tr><td>macOS</td><td><code>shasum -a 256 ~/Desktop/messung_041.csv</code></td><td>Ohne <code>-a 256</code> kommt SHA-1: ein anderer, 40-stelliger Wert.</td></tr>
<tr><td>Linux</td><td><code>sha256sum messung_041.csv</code></td><td>Mit einer Liste erwarteter Werte prüft <code>sha256sum -c liste.txt</code> viele Dateien.</td></tr>
</tbody></table></div>
<h2>Fünf Gründe für abweichende Hashwerte</h2>
<ol>
<li><strong>Jemand hat die Datei geöffnet und gespeichert.</strong> Excel schreibt eine CSV beim Speichern neu. Ob das passiert ist, zeigt die <a href="/excel-csv-fehler-pruefen.html">Excel-Prüfung</a>.</li>
<li><strong>Zeilenenden wurden umgewandelt</strong> (Windows zwei Zeichen, Linux und macOS eines), etwa durch FTP im ASCII-Modus oder Git mit <code>autocrlf</code>.</li>
<li><strong>Die Kodierung hat sich geändert</strong>: UTF-8 als alte Codepage gespeichert ändert die Bytes von ä, ö, ü, µ.</li>
<li><strong>Es wurde eine andere Datei gehasht</strong>: gleicher Name, anderer Ordner, „(1)“ im Download, abgebrochene Kopie. Größe vergleichen.</li>
<li><strong>Ein anderer Algorithmus</strong>: SHA-1 hat 40, MD5 32, SHA-256 64 Zeichen.</li>
</ol>
<div class="actions"><a class="button" href="/transfer.html">Kionel öffnen</a><a class="button secondary" href="/excel-csv-fehler-pruefen.html">Excel-Prüfung</a></div>` },
  { slug: "impressum", lang: "de", title: "Impressum und Anbieterkennzeichnung", description: "Anbieter von kionel.com: Taha Bayar, Einzelunternehmen, Ankara, Türkei. Kontakt und verantwortliche Person. Legal notice in English.", body: `
<p class="eyebrow">IMPRESSUM</p><h1>Impressum</h1>
<h2>Anbieter</h2>
<p>${esc(config.sellerName ?? "Taha Bayar")} (Einzelunternehmen)<br>${esc(config.sellerAddress ?? "")}<br>Türkei</p>
<p>Kionel ist ein Produkt von <a href="https://luminadigitale.com" rel="noopener">Lumina Digitale</a>, dem Einzelunternehmen von ${esc(config.sellerName ?? "Taha Bayar")}.</p>
<h2>Kontakt</h2>
<p>E-Mail: <a href="mailto:${esc(config.supportEmail ?? "legal@luminadigitale.com")}">${esc(config.supportEmail ?? "legal@luminadigitale.com")}</a><br>Kontaktformular: <a href="/contact.html">kionel.com/contact.html</a></p>
<h2>Verantwortlich für den Inhalt</h2>
<p>${esc(config.sellerName ?? "Taha Bayar")}, Anschrift wie oben.</p>
<h2>Vertragsbedingungen und Datenschutz</h2>
<p>Die <a href="/terms.html">Nutzungsbedingungen</a> und die <a href="/privacy.html">Datenschutzerklärung</a> liegen derzeit auf Englisch vor.</p>
<h2 lang="en">Legal notice (English)</h2>
<p lang="en">kionel.com is operated by ${esc(config.sellerName ?? "Taha Bayar")} (sole proprietorship), ${esc(config.sellerAddress ?? "")}, Türkiye. Kionel is a product of Lumina Digitale, the sole proprietorship of ${esc(config.sellerName ?? "Taha Bayar")}. Email: ${esc(config.supportEmail ?? "legal@luminadigitale.com")}. Responsible for content: ${esc(config.sellerName ?? "Taha Bayar")}.</p>` },
  { slug: "research", lang: "en", head: '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "ScholarlyArticle", "headline": "Verifiable one-way file transfer across air gaps with screens, paper and serial cables", "author": {"@type": "Person", "name": "Taha Bayar", "sameAs": ["https://orcid.org/0009-0009-6247-4985"], "affiliation": {"@type": "Organization", "name": "Lumina Digitale"}}, "datePublished": "2026-09-30", "publisher": {"@type": "Organization", "name": "Zenodo"}, "identifier": "https://doi.org/10.5281/zenodo.23064776", "sameAs": "https://doi.org/10.5281/zenodo.23064776", "license": "https://creativecommons.org/licenses/by/4.0/", "isAccessibleForFree": true, "keywords": "air gap, data diode, fountain codes, QR code, paper backup, audit trail, ProVerif"}</script>', title: "Research: verifiable one-way file transfer across air gaps (preprint)", description: "Our preprint on moving files off isolated PCs by screen, printed pages and one-way serial cables with signed records: formal analysis in ProVerif, erasure coding for printed pages, live camera reading and field observations. Open access, DOI 10.5281/zenodo.23064776.", body: `
<p class="eyebrow">RESEARCH · OPEN ACCESS</p><h1>Verifiable one-way file transfer across air gaps</h1>
<p class="lead">A preprint describing how Kionel works and what we measured: the protocols, their formal analysis, the coding that lets printed pages survive lost codes, and the limits.</p>
<p><strong>Taha Bayar</strong>, Lumina Digitale · <a href="https://orcid.org/0009-0009-6247-4985">ORCID 0009-0009-6247-4985</a><br>Preprint, 30 September 2026 · Zenodo · CC BY 4.0<br>DOI: <a href="https://doi.org/10.5281/zenodo.23064776">10.5281/zenodo.23064776</a></p>
<div class="actions"><a class="button" href="https://doi.org/10.5281/zenodo.23064776">Read the preprint (PDF)</a><a class="button secondary" href="/formal/README.md">Formal models</a></div>
<h2>What it covers</h2>
<ul>
<li><strong>Formal analysis.</strong> The two-way handshake and the two one-way modes are modelled in ProVerif; secrecy, authentication and receipt soundness hold under stated assumptions, and variants that drop an assumption produce the expected attacks.</li>
<li><strong>Printed pages.</strong> Spare codes chosen so that each covers a third of the file, plus Gaussian elimination when the decoder stalls: a 30 KB file with 8 of its 48 codes missing came back in 91% of 300 trials, against 3% with ordinary spares.</li>
<li><strong>Live camera reading.</strong> Decoding only the region around the last code cut a 200 KB transfer from 35 to 27 seconds on a processor slowed to phone speed.</li>
<li><strong>Limits.</strong> Phone figures come from one device and synthetic benchmarks; there has been no independent security audit.</li>
</ul>
<h2>How to cite</h2>
<p><code>Bayar, T. (2026). Verifiable one-way file transfer across air gaps with screens, paper and serial cables. Preprint. Zenodo. https://doi.org/10.5281/zenodo.23064776</code></p>` },
  { slug: "qr-file-transfer-benchmark", lang: "en", guide: true, title: "How fast is file transfer by QR code? A test anyone can repeat", description: "A repeatable test for screen-to-camera file transfer: one file, one screen, one phone, a stopwatch and a SHA-256. Our own measurements, the figures other projects report for themselves, and which of them nobody has measured independently.", body: `
<p class="eyebrow">GUIDE · MEASUREMENT</p><h1>How fast is file transfer by QR code?</h1>
<p class="lead">Every tool that moves files from a screen to a camera publishes a speed. Almost all of those numbers come from the tool's own author, on the author's own devices, and some are calculated, not measured. This page describes a test anyone can repeat, lists what we have measured ourselves, and keeps the two kinds of number apart.</p>
<p>Written by Taha Bayar, a biologist working on laboratory data handover. Figures for other projects are taken from their public pages in October 2026.</p>
<h2>The test</h2>
<ol>
<li><strong>The file.</strong> 1 MB of random bytes, so that compression cannot help: <code>head -c 1048576 /dev/urandom > test.bin</code>, or in PowerShell <code>$b = New-Object byte[] 1048576; (New-Object Security.Cryptography.RNGCryptoServiceProvider).GetBytes($b); [IO.File]::WriteAllBytes((Join-Path $PWD "test.bin"), $b)</code>. Note its <a href="/sha256-file-checksum.html">SHA-256</a>.</li>
<li><strong>The screen.</strong> An ordinary office monitor at its usual brightness. Write down its size and resolution. A phone showing codes to another phone is a different, easier test; say which one you ran.</li>
<li><strong>The phone.</strong> Held in the hand, at the distance where the code fills most of the picture. Write down the model.</li>
<li><strong>The clock.</strong> Start when the first code appears, stop when the receiving side shows the complete file.</li>
<li><strong>The check.</strong> The run counts only if the SHA-256 of the received file equals the one you noted.</li>
<li><strong>Three runs.</strong> Report all three, not the best one.</li>
</ol>
<p>The result is kilobytes per second of file delivered, not codes per second and not the capacity of one code times the frame rate.</p>
<h2>What we have measured</h2>
<div class="table-scroll"><table><thead><tr><th>Tool and mode</th><th>Devices</th><th>File</th><th>Result</th></tr></thead><tbody>
<tr><td>Kionel, live reading</td><td>24-inch monitor to Redmi Note 13 Pro</td><td>105 KB</td><td>13 s and 16 s (about 7 KB/s)</td></tr>
<tr><td>Kionel, live reading</td><td>PC monitor to an Android phone</td><td>117 KB</td><td>10 s to 24 s</td></tr>
<tr><td>Kionel, from a screen recording</td><td>same</td><td>117 KB</td><td>7 s of recording, then decoding on the phone</td></tr>
<tr><td>Kionel, colour code, phone filming a monitor</td><td>24-inch monitor to Redmi Note 13 Pro</td><td>105 KB</td><td class="warn">Failed: none of 429 images could be read</td></tr>
</tbody></table></div>
<p>These are small files and few runs. They are here because they were measured, including the one that failed. The 1 MB test above has not been run on these devices yet.</p>
<h2>What other projects report for themselves</h2>
<div class="table-scroll"><table><thead><tr><th>Project</th><th>Reported</th><th>Conditions given by the project</th><th>Measured by us</th></tr></thead><tbody>
<tr><td>libcimbar</td><td>about 100 KB/s (850 kbit/s)</td><td>Colour code, monitor to phone</td><td>Not on a phone. Its decoder is what Kionel's colour mode uses, and that failed in the test above</td></tr>
<tr><td>Decimen Optical Transfer</td><td>50 to 186 KB/s</td><td>Phone to phone at close range; "a few KB/s" from a laptop at a distance, 20 to 25 KB/s after tuning</td><td>No</td></tr>
<tr><td>GlassBridge</td><td>59 to 340 KiB/s</td><td>The project calls these channel budgets before loss, not phone results</td><td>No</td></tr>
<tr><td>AirgapLink</td><td>about 28 KB/s</td><td>Calculated; the project says no physical test has passed yet</td><td>No</td></tr>
</tbody></table></div>
<p>The pattern is worth noticing: the high numbers are phone to phone, close up, where the code fills the camera's picture. From a desk monitor to a hand-held phone, the one project that says so reports a few kilobytes a second, which is where our own measurements are too.</p>
<h2>Why the monitor case is slower</h2>
<ul>
<li><strong>The code is smaller in the picture.</strong> A phone held at arm's length from a monitor sees each square of the code as only a few camera pixels.</li>
<li><strong>Two codes in one picture.</strong> A camera taking 30 pictures a second of a screen that changes 30 times a second catches many pictures halfway between two codes.</li>
<li><strong>The phone has to decode while it films.</strong> Reading a dense code took the phone we measured about 0.15 seconds, so a single decoder tries only a few pictures each second. Kionel now decodes several pictures at once.</li>
</ul>
<h2>Send us a measurement</h2>
<p>If you run the test with any tool, including ours, <a href="/contact.html">send us</a> the tool and version, the screen, the phone, the three times and whether the SHA-256 matched. We will add it to this page with your name or without, as you prefer, and we will add results that are worse for Kionel as readily as better ones.</p>
<p>Speed is not what Kionel is for: the <a href="/open-source-qr-file-transfer-vs-kionel.html">comparison with open-source tools</a> says when a free tool is the better choice, and the <a href="/transfer-speed-calculator.html">speed calculator</a> estimates a transfer before you start it.</p>
<div class="actions"><a class="button" href="/transfer.html">Try it free</a><a class="button secondary" href="/research.html">Research</a></div>` },
  { slug: "transfer-speed-calculator", lang: "en", guide: true, head: '<script type="module" src="/src/speed-page.ts"></script>', title: "How long does a screen-to-camera file transfer take? Speed calculator", description: "Estimate how long a file takes to move from a PC screen to a phone camera: live reading, screen recording and colour code, for text and already-compressed files. The same formulas the app uses, with their assumptions.", body: `
<p class="eyebrow">CALCULATOR</p><h1>How long will my file take?</h1>
<p class="lead">Type the size of your file. The estimate uses the same formulas the Kionel app shows before a transfer starts, so the number here is the number you will see there.</p>
<div class="calc">
<p><label for="calc-size">File size</label><br><input id="calc-size" type="number" min="1" step="any" value="500"> <select id="calc-unit" aria-label="Unit"><option value="1024" selected>KB</option><option value="1048576">MB</option></select></p>
<p><label for="calc-type">Type of file</label><br><select id="calc-type"><option value="text">Text: CSV, TXT, XML, JSON, instrument logs</option><option value="packed">Already compressed: PDF, images, ZIP, XLSX</option></select></p>
<div id="calc-result" class="table-scroll" aria-live="polite"><p class="note">The estimate appears here.</p></div>
</div>
<h2>Common sizes</h2>
<div id="calc-table" class="table-scroll"><p class="note">The table is calculated in your browser.</p></div>
<h2>What the estimate assumes</h2>
<ul>
<li><strong>These are estimates, not device measurements.</strong> Camera, screen, distance and light change the result; the app measures the real rate while it runs.</li>
<li><strong>Text shrinks before sending.</strong> The estimate assumes a text file shrinks four times; CSV and instrument logs often shrink more. PDF, images and ZIP files are already compressed and do not shrink.</li>
<li><strong>Live reading</strong> shows 30 codes a second, but a phone decodes far fewer from a live picture. The estimate assumes about 7 a second, set from our one measurement below, and a quarter of those missed. That is why recording is usually faster for anything over a few hundred kilobytes.</li>
<li><strong>Recording</strong> shows 20 dense codes a second and assumes the video yields readable codes from 60% of them.</li>
<li><strong>The colour code</strong> carries slightly less per image than the densest QR code and shows 15 a second, so on paper it is not faster. Its strength is that far more of its images are read from a real, slightly blurred phone video; the estimate still assumes 60% to stay cautious.</li>
<li>Every estimate includes about 10% extra for the fountain code, a safety margin, and a few seconds to start.</li>
</ul>
<h2>What we have measured</h2>
<p>On one phone, a 117 KB file arrived in 10 to 24 seconds read live, and in about 7 seconds of screen recording. We publish device measurements as we collect them; until then, the calculator is the honest answer.</p>
<p>If your file is larger than a few megabytes, a screen is the wrong tool unless there is no other permitted route: see <a href="/qr-code-capacity-file-transfer.html">how many codes a file needs</a>.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="https://github.com/Apeiron01/kionel">Source on GitHub</a></div>` },
  { slug: "site-policy", lang: "en", title: "Site policy: allowed file types, sizes and work-order format", description: "A Kionel site policy lets a quality or IT unit decide which files may leave a PC and how a transfer must be labelled: allowed extensions, a size limit, the work-order format and the classifications. What it checks, how to write one, and its limits.", body: `
<p class="eyebrow">FEATURE</p><h1>Site policy</h1>
<p class="lead">A small file written by your quality or IT unit. Loaded once in each browser that sends, it refuses files and transfers that do not match your rules, before anything is shown on screen.</p>
<h2>What it checks</h2>
<ul>
<li><strong>File types.</strong> Only the extensions you list may be chosen. With several files selected, one file outside the list stops the whole selection.</li>
<li><strong>Size.</strong> No single file above the limit.</li>
<li><strong>Work order.</strong> The reference must match your format exactly, for example WO- and six digits.</li>
<li><strong>Classification.</strong> Only the classifications you allow.</li>
<li><strong>Operator.</strong> Optionally, nothing is sent without the operator's name or ID.</li>
</ul>
<p>Each refusal names the rule and the policy, so the operator knows what to change. The <a href="/transfer.html">transfer log</a> records which policy was active for every transfer, so a reviewer can see transfers made without it.</p>
<h2>An example</h2>
<pre><code>{
  "kind": "kionel-policy",
  "version": 1,
  "name": "QC laboratory",
  "revision": "2026-10",
  "allowedExtensions": ["csv", "txt", "pdf"],
  "maxBytes": 10485760,
  "referencePattern": "WO-\\\\d{6}",
  "referenceHint": "WO- followed by six digits, e.g. WO-004213",
  "classifications": ["confidential", "restricted"]
}</code></pre>
<p><a class="text-link" href="/examples/kionel-site-policy.json" download>Download this example</a>, change it, and load it with <em>Load site policy</em> under the licence on the transfer page.</p>
<h2>Fields</h2>
<div class="table-scroll"><table><thead><tr><th>Field</th><th>Meaning</th></tr></thead><tbody>
<tr><td><code>kind</code>, <code>version</code></td><td>Always <code>"kionel-policy"</code> and <code>1</code>.</td></tr>
<tr><td><code>name</code>, <code>revision</code></td><td>How the policy is shown and recorded in the log. Change the revision when you change the rules.</td></tr>
<tr><td><code>allowedExtensions</code></td><td>Extensions in lower case, without the dot. Leave it out to allow any type.</td></tr>
<tr><td><code>maxBytes</code></td><td>Largest file in bytes; 10485760 is 10 MB. The edition's own limit still applies.</td></tr>
<tr><td><code>referencePattern</code></td><td>A regular expression the whole work order must match. In JSON a backslash is written twice.</td></tr>
<tr><td><code>referenceHint</code></td><td>The format in words, shown when a work order is refused.</td></tr>
<tr><td><code>classifications</code></td><td>Any of <code>internal</code>, <code>confidential</code>, <code>restricted</code>.</td></tr>
<tr><td><code>requireOperator</code></td><td><code>true</code> to refuse a transfer without the operator's name or ID. The name is signed into the record as declared; it is not a login.</td></tr>
</tbody></table></div>
<p>A policy with a misspelt field is refused when it is loaded, with the field named, so a typing error cannot silently switch a rule off.</p>
<h2>What it is not</h2>
<p>It is a guard against mistakes, not access control: someone at the PC can remove it from the browser, with a confirmation. That is why the log records it. For the offline package, load it once on each PC, the same way as the licence.</p>
<div class="actions"><a class="button" href="https://github.com/Apeiron01/kionel">Source on GitHub</a><a class="button secondary" href="/validation-pack.html">Validation pack</a></div>` },
  { slug: "verify", lang: "en", title: "Verify a Kionel receipt or dispatch record", description: "Check a Kionel delivery receipt or dispatch record in your browser, offline and without uploading anything. Add the original file to confirm it is the one that was transferred.", head: '<script type="module" src="/src/verify-page.ts"></script>', body: `
<p class="eyebrow">Verifier</p><h1>Verify a receipt, without us.</h1>
<p class="lead">Drop a delivery receipt (<code>.makbuz.json</code>) or a dispatch record (<code>.sevk.json</code>). Everything is checked in this browser tab: nothing is uploaded, and it works with the network switched off.</p>
<ol class="flow verify-steps">
<li><span>01</span><strong>Record</strong><small>The receipt or dispatch JSON</small></li>
<li><span>02</span><strong>File</strong><small>Optional: the file that was transferred</small></li>
<li><span>03</span><strong>Result</strong><small>Each check, in plain words</small></li>
</ol>
<label class="drop" id="record-drop"><input type="file" id="record-file" accept=".json,application/json"><span>1 · Drop the receipt or dispatch record here, or click to choose</span></label>
<label class="drop" id="content-drop"><input type="file" id="content-file"><span>2 · Optional: drop the original file to check it is the one that was transferred</span></label>
<div id="verify-result" aria-live="polite"><p class="note">The result appears here as soon as a record is added.</p></div>
<p><button id="verify-print" class="button" type="button" hidden>Print report / save as PDF</button></p>
<h2 id="link">Check a one-way link: did everything arrive?</h2>
<p>On a one-way link, such as a serial cable with the return wire left out or a data diode, the sending side cannot be told that a file arrived; that is what one-way means. The usual answer is to compare the logs of both sides by hand. With Kionel both logs are signed, so the comparison can be checked instead of trusted.</p>
<p>On each side open the transfer log and press <strong>Download signed records (JSON)</strong> for the same period. The sender's records are a file like any other and can travel over the link itself. Drop both here:</p>
<label class="drop" id="link-sent-drop"><input type="file" id="link-sent-file" accept=".json,application/json"><span>A · Drop the sender's signed records here, or click to choose</span></label>
<label class="drop" id="link-received-drop"><input type="file" id="link-received-file" accept=".json,application/json"><span>B · Drop the receiver's signed records here, or click to choose</span></label>
<p id="link-status" class="evidence-status" role="status" hidden></p>
<div id="link-result" aria-live="polite"></div>
<p>For every file the sender signed, the result is one of three: the receiver signed a receipt for exactly that dispatch and both signatures verify; there is no receipt; or one of the two records does not verify. It shows that the receiving device signed for the file, not that anyone has read it, and a file sent before the sender's period started is not in the list.</p>
<h2>What this checks</h2>
<ul>
<li><strong>Delivery signature</strong> — the receiving device signed this exact receipt; any edit breaks it.</li>
<li><strong>Dispatch signature</strong> — the sending device signed the file's SHA-256 together with the work order, classification and target system.</li>
<li><strong>File content</strong> — if you add the file, its size and SHA-256 must match what both devices signed.</li>
</ul>
<p>It does not prove which person operated the devices, and the times are device clock times, not trusted timestamps. The same check runs from the free command-line verifier, licensed under Apache-2.0, so a record stays checkable even if Kionel is gone.</p>
<div class="actions"><a class="button secondary" href="/security.html">Security model</a><a class="button secondary" href="/transfer.html">Make a transfer</a></div>` },
  { slug: "get-started", lang: "en", title: "Getting started: your first transfer, step by step", description: "What you need, how to run your first transfer between two devices, and what to keep afterwards. No account, no licence file, nothing to install.", body: `
<p class="eyebrow">GETTING STARTED</p><h1>Your first transfer, step by step.</h1>
<p>Written for someone who has never used Kionel and does not want to read a manual. Nothing here needs an IT department, an installation or a network change. If a step does not match what you see, stop and <a href="/contact.html">tell us</a> — that is a fault in these instructions, not in you.</p>

<h2>1. What you need</h2>
<ul>
<li><strong>Two devices.</strong> The one holding the file (the isolated instrument PC, a laptop) and one with a working camera (a laptop, a tablet, a phone, a document camera).</li>
<li><strong>A current browser</strong> on each: Chrome or Edge 137 or later, Firefox 130 or later, or Safari 17 or later. Kionel signs and encrypts with cryptography built into these versions. Windows 7 and 8.1 cannot run them, so Kionel does not run there; Windows 10 and 11 can. The app checks this when it opens and tells you if the browser is too old.</li>
<li><strong>They must see each other.</strong> The camera of one has to see the screen of the other. No cable, no network, no Bluetooth.</li>
</ul>
<p>The devices do not need to be online for the transfer itself. A PC that can never go online uses the <a href="/offline-package.html">offline package</a>: one file, copied once, checked by its SHA-256.</p>

<h2>2. Your first transfer</h2>
<p>Do this once with a harmless test file before you use it for real work.</p>
<ol>
<li><strong>On the receiving device:</strong> open kionel.com, press <strong>Receive</strong>. A square code appears on its screen.</li>
<li><strong>On the sending device:</strong> press <strong>Send</strong>, then <strong>Choose file</strong> and pick your file. Fill in the work order or sample ID if your workflow uses one — it is signed together with the file.</li>
<li>Point the sending device's camera at the receiving screen so the square code is inside the picture. It reads it by itself; there is no button.</li>
<li>The sending device now shows its own code. Turn it so the <strong>receiving</strong> device's camera can see it.</li>
<li><strong>Both screens now show six digits and five small symbols.</strong> Check with your own eyes that they are identical. This is the step that stops anyone sitting in the middle. If they differ, stop and start again.</li>
<li>Press <strong>Codes match</strong> on both devices.</li>
<li>The sending screen fills with changing codes; keep the receiving camera pointed at it. The progress bar moves. A long transfer can be paused and resumed.</li>
<li>When it finishes, the receiving device offers your file and a <strong>delivery receipt</strong>. The sending device offers a <strong>dispatch record</strong>.</li>
</ol>

<h3>If the sending PC has no camera</h3>
<p>Most instrument PCs have none. They can still send; the keyboard replaces the camera.</p>
<ol>
<li><strong>On the phone or tablet:</strong> press <strong>Receive → Show a code</strong>. A 12-character code appears, like <code>7K3Q-M9XD-4PAB</code>.</li>
<li><strong>On the PC:</strong> choose the file, fill in the work order, type the code into <em>Code shown on the receiver</em> and press <strong>Send with this code</strong>.</li>
<li>Point the phone's camera at the PC screen until it shows the file. The code works once; the next transfer gets a new one.</li>
</ol>
<p><strong>The two devices do not have to be there at the same time.</strong> Film the sending screen with the phone's camera app, and open the video later — on the same or another phone — under <em>Receive → Open a recording</em>, typing the code that was used. The recording is encrypted: without that code it cannot be opened.</p>
<p><strong>Faster for larger files:</strong> on the PC press <em>Phone records the screen — faster</em> before sending. On the phone press <em>Record the screen now</em>, film the PC screen at 60 fps if your camera app offers it, stop, and Kionel reads the recording. If it ends too early, record again — what was collected is kept.</p>
<p>Sending to the same device every day? Create a <strong>receiver card</strong> once on the phone (<em>Receive → Receiver card</em>) and load it on the PC; then no code is needed. The card belongs to that phone's browser: if the phone's browser data is cleared, or the phone is replaced, create a new card and load it on the PC again. If a PC is lost, press <em>Retire this device's card key</em> on the phone and every old card stops working.</p>

<h2>3. What to keep afterwards</h2>
<p>The file itself goes wherever your files normally go. The two small JSON records are the point of the product: they are the proof that this file, with this hash, went from this device to that one, signed by both.</p>
<p>Store them the way you store any other quality record — next to the result, in the folder or system your procedure names. They are small and they never expire.</p>
<p>For a reviewer or inspector who does not read JSON, press <strong>Print report / save as PDF</strong>: one page with the file, its SHA-256, the work order and each signature check. Anyone can repeat the check at <a href="/verify.html">kionel.com/verify.html</a> — the record is checked in their browser and nothing is uploaded.</p>
<p>Years later, anyone can check them without us: the offline verifier is enough. We publish that verifier under a permissive licence precisely so that this stays true if Kionel disappears.</p>

<h2>When something looks wrong</h2>
<div class="table-scroll"><table><thead><tr><th>What you see</th><th>What it means</th></tr></thead><tbody>
<tr><td>"No camera was found on this device"</td><td>Normal on an instrument PC. Use a code from the receiver instead (see "If the sending PC has no camera").</td></tr>
<tr><td>"Camera access was refused"</td><td>Allow the camera for kionel.com (icon in the address bar), then reload.</td></tr>
<tr><td>"The code has 12 characters…" or "the code does not open this transfer"</td><td>The code was mistyped. Check it on the phone and press Send again; the phone keeps listening.</td></tr>
<tr><td>"sealed for a different receiver card"</td><td>The PC holds an old card, or the phone's card key was retired. Create a new card on the phone and load it on the PC.</td></tr>
<tr><td>"runs an older version of Kionel"</td><td>One device has an old copy of the page. Reload the page on both devices.</td></tr>
<tr><td>"This file needs about N minutes of steady camera time"</td><td>Optical transfer suits files up to about 1 MB. Text and CSV are compressed automatically; for PDFs and images, set Screen to "monitor — 4 codes" and QR version 40 with the phone close.</td></tr>
<tr><td>Everything is gone after a clean-up</td><td>The browser's data was cleared. Create a new receiver card if you used one.</td></tr>
<tr><td>The codes on the two screens differ</td><td>Stop. Close both sides and start again. Do not continue.</td></tr>
<tr><td>Reading is slow or stalls</td><td>More light, less glare, hold steadier, move closer. On a phone, pick the rear camera. Very dense codes need a sharper view; choose a lower QR version.</td></tr>
</tbody></table></div>

<h2>Still stuck</h2>
<p>Write to us through the <a href="/contact.html">contact form</a> with what you saw on screen. Do not send us your file or your data — we do not need it and we do not want it.</p>
<p><a class="button" href="/index.html">Open the transfer page</a> <a class="text-link" href="/limits.html">What Kionel does not do →</a></p>` },
  { slug: "file-transfer-audit-trail", lang: "en", guide: true, title: "An audit trail for file transfers between lab systems", description: "What an inspector expects to see when a file moves between laboratory systems, why USB transfers usually fail that test, and the practical options for producing a record.", body: `
<p class="eyebrow">Guide · Updated 2026</p><h1>What an auditor wants to see when a file moves</h1>
<p class="lead">Regulated laboratories are expected to keep an audit trail for data and for second-person review. Most of that expectation is met inside the instrument software and the LIMS. The gap is the space between them: the moment a file is carried from one system to another.</p>
<p class="note">Written by Taha Bayar, a biologist working on laboratory data handover. Kionel sells one of the options below. The checklist works whichever route you choose.</p>

<h2>The question, in one line</h2>
<p><strong>Who moved which file, when, and can you show that what arrived is what left?</strong> Everything below is a way of answering that sentence, or failing to.</p>

<h2>What a transfer record should contain</h2>
<div class="table-scroll"><table><thead><tr><th>Element</th><th>Why an inspector asks for it</th></tr></thead><tbody>
<tr><td>Identity of the file</td><td>A name is not enough; two files can share a name. A content hash identifies the bytes.</td></tr>
<tr><td>Who released it</td><td>An account, a key or a signature — something that ties the action to a person or a controlled credential.</td></tr>
<tr><td>Who received it</td><td>A one-sided record is a claim, not a handover.</td></tr>
<tr><td>When</td><td>A time that both sides agree on, and whose source is stated. A device clock is a device clock.</td></tr>
<tr><td>Integrity on arrival</td><td>Evidence that the received copy matches the released one, not just that a copy appeared.</td></tr>
<tr><td>Where it is kept</td><td>A record that lives only on the instrument PC disappears with the instrument PC.</td></tr>
</tbody></table></div>

<h2>Why the usual routes struggle</h2>
<ul>
<li><strong>USB stick.</strong> The transfer itself leaves nothing behind. Sites compensate with a paper logbook, which records intent rather than the event, and which nobody can tie to a specific file.</li>
<li><strong>Shared folder or network drive.</strong> Better, if the file system keeps access logs and someone retains them. Often the log is overwritten, or shows a service account rather than a person.</li>
<li><strong>Email.</strong> Produces a trail of sorts, but usually outside the quality system, and frequently outside policy for laboratory data.</li>
<li><strong>Printing and re-keying.</strong> Creates a clean paper record and a transcription risk; needs its own second-person check.</li>
<li><strong>Data diode.</strong> Strong for continuous flows between networks. Whether an individual handover is recorded depends on what you put on each end.</li>
</ul>
<p>None of these is wrong. The point is that the record is a separate thing from the movement, and if nobody designed it, it does not exist.</p>

<h2>A practical checklist</h2>
<ol class="steps-flow">
<li><h3>Name the step</h3><p>Write down exactly which handover you are talking about: from which system, to which system, how often, which file types.</p></li>
<li><h3>Decide what proves it</h3><p>Hash, sender, receiver, time, integrity result. Decide before choosing a tool, or the tool decides for you.</p></li>
<li><h3>Decide where the proof lives</h3><p>In the LIMS? Next to the result? In a quality folder? A record nobody can find is not a record.</p></li>
<li><h3>Decide who checks it</h3><p>Second-person review applies to the handover too, not only to the result.</p></li>
<li><h3>Test the failure case</h3><p>Corrupt a file on purpose and confirm your process notices. A control that has never failed has never been tested.</p></li>
</ol>

<h2>Where Kionel fits</h2>
<p>Kionel produces that record as part of the movement instead of beside it: the sender signs a dispatch record over the content hash, the receiver verifies the content and signs a delivery record. Both verify offline, with a tool that stays free under Apache-2.0, so the evidence outlives the supplier.</p>
<p>It is for small files and it needs a site that permits screens and cameras. It does not scan file content, and it does not replace your validation work. The <a href="/limits.html">limits page</a> is the full list.</p>
<p>If the file has to stay on a USB stick, the same two signed records can be made around it: <a href="/usb-file-transfer-signed-record.html">keep the USB stick, add the proof</a>.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/how-it-works.html">How the evidence is built</a></div>` },
  { slug: "second-person-review-offline", lang: "en", guide: true, title: "Second-person review on an offline workstation", description: "How to record who produced, reviewed and released a result when the workstation has no network, and what makes such a record hold up.", body: `
<p class="eyebrow">Guide · Updated 2026</p><h1>Second-person review when the workstation is offline</h1>
<p class="lead">On a networked system, review is a workflow state in the software. On an isolated instrument PC it is often a person leaning over a colleague's shoulder, and afterwards a signature on a printout that is filed somewhere else. The check happened; the evidence is thin.</p>
<p class="note">Written by Taha Bayar, a biologist working on laboratory data handover.</p>

<h2>What makes a review record hold up</h2>
<ul>
<li><strong>It names the exact object.</strong> "Batch 41 reviewed" is weaker than a record bound to the hash of the result file.</li>
<li><strong>It distinguishes roles.</strong> Produced, reviewed, released are different acts by different people. One signature at the end loses that.</li>
<li><strong>It keeps the order.</strong> A review that happened after release is not a review. If the record cannot show order, it cannot show that.</li>
<li><strong>It survives the workstation.</strong> Evidence stored only on the instrument PC dies with the disk, the rebuild or the retirement of the instrument.</li>
<li><strong>It can be checked later without the tool that made it.</strong> Otherwise you have swapped one dependency for another.</li>
</ul>

<h2>The common patterns, and what each costs</h2>
<div class="table-scroll"><table><thead><tr><th>Pattern</th><th>What it gives</th><th>What it costs</th></tr></thead><tbody>
<tr><td>Paper signature on a printout</td><td>Familiar, accepted, works offline</td><td>Not bound to the file bytes; storage and retrieval are manual</td></tr>
<tr><td>Instrument software user accounts</td><td>Inside the validated system, often has an audit trail</td><td>Only covers what that software does; shared logins are common on old systems</td></tr>
<tr><td>Review recorded in the LIMS after transfer</td><td>Central, searchable</td><td>Records the LIMS entry, not the handover; the gap stays unproven</td></tr>
<tr><td>Signed approval chain travelling with the file</td><td>Bound to the content, ordered, portable</td><td>Needs key management and a habit change</td></tr>
</tbody></table></div>

<h2>How Kionel records it</h2>
<p>Approvals are signed links, each one over the previous: produced, then reviewed, then released. Because each link covers the one before it, the <em>order</em> is provable and removing a link breaks the chain rather than silently shortening it. The approvals travel with the file, so the evidence arrives where the result arrives.</p>
<p>The honest boundary: a signature proves that a key signed, not that a person did. Tying keys to people is your identity process and, where it matters, hardware-backed device identity. We say the same thing on the <a href="/security.html">security page</a>.</p>
<div class="actions"><a class="button" href="/transfer.html">Start free</a><a class="button secondary" href="/file-transfer-audit-trail.html">Audit trail for transfers</a></div>` },
  { slug: "numune-karsilastirma", title: "Excel numune listesi karşılaştırma: eksik ve tekrar eden kayıtlar", description: "Beklenen ve teslim alınan numune listelerini tarayıcıda karşılaştırın. Eksik, fazla ve yinelenen kimlikleri bulun; veriler sunucuya yüklenmez.", body: `<p class="eyebrow">ÜCRETSİZ ARAÇ</p><h1>İki numune listesinin farkını bulun.</h1>${tool(false)}` },
  { slug: "sample-reconciliation", lang: "en", title: "Sample manifest reconciliation: compare expected and received IDs", description: "Compare sample ID lists locally in your browser. Find missing, unexpected and duplicate IDs without uploading laboratory data.", body: `<p class="eyebrow">FREE TOOL</p><h1>Reconcile expected and received sample IDs.</h1>${tool(true)}` },
  { slug: "pilot", lang: "en", title: "Kionel is open source", description: "Kionel is free and open source under AGPL-3.0, with an Apache-2.0 verifier. A commercial licence is available for closed-source products that embed it.", body: `
<p class="eyebrow">OPEN SOURCE</p><h1>Kionel is free and open source.</h1>
<p class="lead">Every feature is included for personal and organisational use: signed dispatch and delivery records, reports, the local audit chain, the fast recording mode, printed pages, the one-way serial cable, receiver cards and site policies. Nothing to buy, no licence file to load.</p>
<p><a class="button" href="https://github.com/Apeiron01/kionel">Source code on GitHub</a> <a class="button secondary" href="/transfer.html">Open Kionel</a></p>
<h2>Licences</h2>
<div class="table-scroll"><table><thead><tr><th>Part</th><th>Licence</th><th>What it means</th></tr></thead><tbody>
<tr><td>Kionel application, protocol and site</td><td>AGPL-3.0</td><td>Use, study, change and share it. If you distribute a changed version, or run one as a network service, you publish its source under the same licence.</td></tr>
<tr><td>Record verifiers (<code>@kionel/crypto</code> and the verify tools)</td><td>Apache-2.0</td><td>Permissive, so an auditor can check a record years later without us and without AGPL obligations.</td></tr>
<tr><td>Commercial licence</td><td>By agreement</td><td>For a closed-source product or service that embeds Kionel and cannot meet the AGPL's obligations. Integration help and support can be part of it.</td></tr>
</tbody></table></div>
<h2>Commercial licence and support</h2>
<p>Kionel is developed by Taha Bayar at Lumina Digitale. If you want to build Kionel into a product without publishing your source, need help fitting it to an instrument workflow, or want a supported continuous serial link, <a href="/contact.html">write to us</a> with a short description of the workflow. We answer by email.</p>
<h2>What stays true</h2>
<ul><li>File content never reaches our server; the transfer happens between your two devices.</li>
<li>Records you already have stay verifiable forever with the Apache-2.0 verifier, with or without us.</li>
<li>Kionel has not had an independent security audit yet. The <a href="/security.html">security page</a> lists the current status and the <a href="/limits.html">limits page</a> what it does not do.</li></ul>` },
];
/**
 * Marka işareti: iki yüzey arasından geçen üç optik kare.
 *
 * Kalkan ve asma kilit bilinçli olarak kullanılmadı — her güvenlik şirketinin
 * işareti odur ve ürünü anlatmaz. Bu işaret ürünün kendisini anlatıyor:
 * cihazdan cihaza, ışıkla.
 */
const mark = (size = 30) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32" role="img" aria-label="Kionel">` +
  `<rect x="1.5" y="5.5" width="5" height="21" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
  `<rect x="25.5" y="5.5" width="5" height="21" rx="1.5" fill="none" stroke="currentColor" stroke-width="2"/>` +
  `<rect x="10" y="13" width="3.4" height="3.4" fill="currentColor" opacity=".45"/>` +
  `<rect x="14.3" y="13" width="3.4" height="3.4" fill="currentColor" opacity=".75"/>` +
  `<rect x="18.6" y="13" width="3.4" height="3.4" fill="currentColor"/>` +
  `<rect x="10" y="18.4" width="3.4" height="3.4" fill="currentColor"/>` +
  `<rect x="14.3" y="18.4" width="3.4" height="3.4" fill="currentColor" opacity=".45"/>` +
  `<rect x="18.6" y="18.4" width="3.4" height="3.4" fill="currentColor" opacity=".75"/></svg>`;

const luminaLink = '<a class="lumina" href="https://luminadigitale.com" rel="noopener noreferrer" target="_blank" ' +
  'title="Lumina Digitale"><svg width="17" height="22" viewBox="169 81 472 633" aria-hidden="true" focusable="false"><path d="M 354.835938 660.777344 C 289.34375 660.777344 249.777344 588.34375 285.164062 533.238281 L 515.683594 174.285156 C 521.925781 164.5625 525.242188 153.253906 525.242188 141.703125 C 525.242188 108.402344 498.25 81.40625 464.949219 81.40625 L 248.09375 81.40625 C 204.429688 81.40625 169.035156 116.804688 169.035156 160.46875 L 169.035156 635.011719 C 169.035156 678.675781 204.429688 714.074219 248.09375 714.074219 L 561.679688 714.074219 C 605.324219 714.074219 640.710938 678.710938 640.742188 635.070312 L 640.839844 494.191406 C 640.878906 441.875 572.644531 421.824219 544.371094 465.84375 L 453.925781 606.652344 C 432.261719 640.382812 394.925781 660.777344 354.835938 660.777344 Z" fill="currentColor"/></svg>Lumina Digitale</a>';

/** Ayak: ürün / teknik / hukuk. Tek satırlık altbilgi kurumsal alıcıya eksik görünüyordu. */
// Rehberler için Article verisi. JSON-LD çalıştırılan bir betik değildir;
// CSP'nin script-src kuralı ona uygulanmaz.
const siteOrigin = String(config.siteUrl ?? "https://kionel.com/").replace(/\/$/, "");
const articleLd = (p) => `<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org", "@type": "Article", headline: p.title, description: p.description,
  url: `${siteOrigin}/${p.slug}.html`, inLanguage: p.lang ?? "tr", datePublished: "2026-09-23",
  author: { "@type": "Person", name: "Taha Bayar", jobTitle: "Biologist", sameAs: ["https://orcid.org/0009-0009-6247-4985", "https://apeiron01.github.io/"] },
  publisher: { "@type": "Organization", name: "Kionel", url: siteOrigin },
}).replace(/</g, "\\u003c")}</script>`;

// İngilizce–Türkçe eş sayfalar birbirini gösterir: arama doğru dildekini sunar, ikisi yarışmaz.
const LANGUAGE_PAIRS = {
  "excel-csv-changes-lab-data": "excel-csv-veri-bozulmasi",
  "screen-recording-qr-codes-not-scanning": "ekran-kaydi-qr-okunmuyor",
  "send-file-pc-to-phone-without-internet": "internetsiz-bilgisayardan-telefona-dosya-aktarma",
  "sample-reconciliation": "numune-karsilastirma",
  "excel-damage-check": "excel-bozulma-kontrolu",
  "print-file-as-qr-codes": "dosyayi-qr-kod-olarak-yazdir",
  "encrypted-paper-backup": "sifreli-kagit-yedek",
  "leave-passwords-to-family": "sifreleri-aileye-birakmak",
  "serial-data-diode": "seri-kablo-veri-diyotu",
  "sha256-file-checksum": "sha256-dogrulama",
  "what-is-in-a-qr-code": "qr-kodun-icinde-ne-var",
  "usb-file-transfer-signed-record": "usb-ile-dosya-aktarimi-imzali-kayit",
  "contact": "iletisim",
};
// İngilizce–Almanca eşler (Almanya, Avusturya, İsviçre: ilaç, kimya, endüstriyel otomasyon).
const GERMAN_PAIRS = {
  "index": "sichere-datenuebertragung-offline",
  "instrument-results-to-lims-offline": "messdaten-offline-pc-lims",
  "ot-air-gapped-file-transfer": "ot-dateitransfer-ohne-usb",
  "serial-data-diode": "serielle-datendiode",
  "excel-damage-check": "excel-csv-fehler-pruefen",
  "print-file-as-qr-codes": "datei-als-qr-code-drucken",
  "encrypted-paper-backup": "verschluesseltes-papier-backup",
  "sha256-file-checksum": "sha256-pruefen",
  "21-cfr-part-11-file-transfer": "annex-11-dateitransfer",
};
// Aynı içeriğin dil sürümleri birbirini gösterir: arama doğru dildekini sunar, sürümler yarışmaz.
const groupOf = new Map();
for (const en of new Set([...Object.keys(LANGUAGE_PAIRS), ...Object.keys(GERMAN_PAIRS)])) {
  const group = { en, ...(LANGUAGE_PAIRS[en] ? { tr: LANGUAGE_PAIRS[en] } : {}), ...(GERMAN_PAIRS[en] ? { de: GERMAN_PAIRS[en] } : {}) };
  for (const slug of Object.values(group)) groupOf.set(slug, group);
}
const hreflang = (p) => {
  const group = groupOf.get(p.slug);
  if (!group) return "";
  const url = (slug) => `${siteOrigin}/${slug}.html`;
  return Object.entries(group).map(([lang, slug]) => `<link rel="alternate" hreflang="${lang}" href="${url(slug)}">`).join("") +
    `<link rel="alternate" hreflang="x-default" href="${url(group.en)}">`;
};

// Ürün verisi: yalnız doğrulanabilir alanlar (fiyat yazılmaz; ücretsiz sürüm 0).
{
  const index = pages.find((page) => page.slug === "index");
  const software = {
    "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Kionel",
    applicationCategory: "BusinessApplication", operatingSystem: "Windows, macOS, Linux, Android, iOS (in the browser)",
    url: `${siteOrigin}/`, downloadUrl: `${siteOrigin}/offline-package.html`,
    ...(offlineReleases[0] ? { softwareVersion: offlineReleases[0].version } : {}),
    description: "Encrypted screen-to-camera file transfer from offline PCs, with signed dispatch and delivery records.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", name: "Open source (AGPL-3.0)" },
    publisher: { "@type": "Organization", name: "Kionel", url: `${siteOrigin}/` },
  };
  index.head = (index.head ?? "") + `<script type="application/ld+json">${JSON.stringify(software).replace(/</g, "\\u003c")}</script>`;
}

// Rehberler: sayfa listesinden üretilir, yeni rehber kendiliğinden eklenir.
{
  const item = (page) => `<li><a href="/${page.slug}.html">${esc(page.title)}</a><br><span class="note">${esc(page.description)}</span></li>`;
  const english = pages.filter((page) => page.guide && page.lang === "en");
  const turkish = pages.filter((page) => page.guide && (page.lang ?? "tr") === "tr");
  const german = pages.filter((page) => page.guide && page.lang === "de");
  pages.push({ slug: "guides", lang: "en", title: "Guides: moving files off offline PCs, and proving it", description: "Practical guides on moving files off isolated and offline computers, keeping raw results intact, audit trails, and what regulators expect.", body: `
<p class="eyebrow">GUIDES</p><h1>Guides</h1>
<p class="lead">Practical answers, written from tests we ran ourselves. Each one says where Kionel fits and where it does not.</p>
<ul class="guide-list">
${english.map(item).join("\n")}
</ul>
<h2>Türkçe rehberler</h2>
<ul class="guide-list">
${turkish.map(item).join("\n")}
</ul>
<h2 lang="de">Leitfäden auf Deutsch</h2>
<ul class="guide-list" lang="de">
${german.map(item).join("\n")}
</ul>` });
}

// Resmî modeller siteden indirilebilir: sonucu okuyan, kendisi de çalıştırabilsin.
{
  const from = join(root, "formal");
  const to = join(root, "apps/web/public/formal");
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) copyFileSync(join(from, name), join(to, name));
}

const footerEn = (seller) => `<div class="footer-grid">
<div><a class="brand" href="/index.html">${mark(26)}<span><b>Kionel</b></span></a>
<p class="note">Verifiable file handover for isolated laboratory systems.</p></div>
<div><h2>Product</h2><a href="/how-it-works.html">How it works</a><a href="/transfer.html">Open Kionel</a><a href="/sample-reconciliation.html">Sample reconciliation</a><a href="/excel-damage-check.html">Excel damage check</a><a href="/what-is-in-a-qr-code.html">What is in a QR code</a><a href="/verify.html">Verify a receipt</a><a href="/pilot.html">Open source</a></div>
<div><h2>Technical</h2><a href="/offline-package.html">Offline package</a><a href="/validation-pack.html">Validation pack (IQ/OQ)</a><a href="/security.html">Security</a><a href="/limits.html">Limits</a><a href="/research.html">Research (preprint)</a><a href="/get-started.html">Getting started</a><a href="/changelog.html">Changelog</a></div><div><h2>Industries</h2><a href="/index.html">Laboratories</a><a href="/ot-air-gapped-file-transfer.html">OT and manufacturing</a><a href="/iec-62443-file-transfer.html">IEC 62443 and file transfer</a></div><div><h2>Guides</h2><a href="/air-gapped-instrument-data-transfer.html">Moving data off an instrument PC</a><a href="/file-transfer-audit-trail.html">Audit trail for transfers</a><a href="/second-person-review-offline.html">Second-person review offline</a><a href="/offline-pc-to-phone-file-transfer.html">Offline PC to phone</a><a href="/data-diode-vs-usb-lab.html">Data diode vs USB</a><a href="/21-cfr-part-11-file-transfer.html">Part 11 and file transfers</a><a href="/alcoa-plus-file-transfer.html">ALCOA+ in transfers</a><a href="/open-source-qr-file-transfer-vs-kionel.html">Free QR tools vs Kionel</a><a href="/sha256-file-checksum.html">Check a SHA-256</a><a href="/qr-code-capacity-file-transfer.html">QR code capacity</a><a href="/transfer-speed-calculator.html">Speed calculator</a><a href="/excel-csv-changes-lab-data.html">Excel and CSV results</a><a href="/instrument-results-to-lims-offline.html">Offline PC to LIMS</a><a href="/screen-recording-qr-codes-not-scanning.html">Recording will not scan</a><a href="/cdn-changed-download-sha256.html">When a host changes a download</a></div>
<div><h2>Legal</h2><a href="/impressum.html">Impressum</a><a href="/terms.html">Terms</a><a href="/privacy.html">Privacy</a><a href="/.well-known/security.txt">Security disclosure</a><a href="/contact.html">Contact</a></div>
</div><div class="footer-base"><p>© 2026 Kionel · ${esc(seller)}</p>${luminaLink}</div>`;

const footerDe = (seller) => `<div class="footer-grid">
<div><a class="brand" href="/sichere-datenuebertragung-offline.html">${mark(26)}<span><b>Kionel</b></span></a>
<p class="note">Nachweisbare Dateiübergabe für isolierte Labor- und Anlagensysteme.</p></div>
<div><h2>Leitfäden</h2><a href="/messdaten-offline-pc-lims.html">Vom Offline-PC ins LIMS</a><a href="/annex-11-dateitransfer.html">Annex 11 und Dateitransfer</a><a href="/ot-dateitransfer-ohne-usb.html">OT: Dateien ohne USB-Stick</a><a href="/serielle-datendiode.html">Serielle Datendiode</a><a href="/datei-als-qr-code-drucken.html">Datei als QR-Code drucken</a><a href="/verschluesseltes-papier-backup.html">Verschlüsseltes Papier-Backup</a></div>
<div><h2>Kostenlose Werkzeuge</h2><a href="/excel-csv-fehler-pruefen.html">Excel-Schäden in CSV prüfen</a><a href="/sha256-pruefen.html">SHA-256 prüfen</a><a href="/transfer.html">Kionel öffnen</a></div>
<div><h2>Rechtliches</h2><a href="/impressum.html">Impressum</a><a href="/pilot.html">Open Source und Lizenz (EN)</a><a href="/security.html">Sicherheit</a><a href="/limits.html">Grenzen</a><a href="/terms.html">Nutzungsbedingungen</a><a href="/privacy.html">Datenschutz</a><a href="/contact.html">Kontakt</a></div>
</div><div class="footer-base"><p>© 2026 Kionel · ${esc(seller)}</p><a href="/index.html">English site</a>${luminaLink}</div>`;

const footerTr = (seller) => `<div class="footer-base"><p>© 2026 Kionel · ${esc(seller)}</p>` +
  '<a href="/policies.html">Koşullar ve gizlilik</a><a href="/impressum.html">Künye (Impressum)</a><a href="/index.html">English site</a>' + luminaLink + '</div>';

for (const p of pages) {
  const lang = p.lang ?? "tr";
  const en = lang === "en";
  const de = lang === "de";
  const seller = config.sellerName ?? "Taha Bayar";
  const current = (slug) => (p.slug === slug ? ' aria-current="page"' : "");
  const nav = de
    ? `<a href="/sichere-datenuebertragung-offline.html"${current("sichere-datenuebertragung-offline")}>Überblick</a>` +
      `<a href="/messdaten-offline-pc-lims.html"${current("messdaten-offline-pc-lims")}>Labor</a>` +
      `<a href="/ot-dateitransfer-ohne-usb.html"${current("ot-dateitransfer-ohne-usb")}>Industrie</a>` +
      `<a href="/excel-csv-fehler-pruefen.html"${current("excel-csv-fehler-pruefen")}>Excel-Prüfung</a>` +
      '<a href="/pilot.html">Open Source (EN)</a><a href="/contact.html">Kontakt</a>' +
      '<a class="button" href="/transfer.html">Kostenlos testen</a>'
    : en
    ? `<a href="/how-it-works.html"${current("how-it-works")}>How it works</a>` +
      `<a href="/import-check.html"${current("import-check")}>Import Check</a>` +
      `<a href="/security.html"${current("security")}>Security</a>` +
      `<a href="/limits.html"${current("limits")}>Limits</a>` +
      `<a href="/pilot.html"${current("pilot")}>Open source</a>` +
      `<a href="/guides.html"${current("guides")}>Guides</a>` +
      `<a href="/contact.html"${current("contact")}>Contact</a>` +
      '<a class="button" href="/transfer.html">Start free</a>'
    : `<a href="/numune-karsilastirma.html"${current("numune-karsilastirma")}>Numune karşılaştırma</a>` +
      `<a href="/csv-aktarim-kontrolu.html"${current("csv-aktarim-kontrolu")}>CSV aktarım kontrolü</a>` +
      `<a href="/pilot.html">Açık kaynak</a><a href="/iletisim.html"${current("iletisim")}>İletişim</a>`;
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">` +
    `<title>${esc(p.title)} · Kionel</title><meta name="description" content="${esc(p.description)}">${hreflang(p)}` +
    `<link rel="icon" href="/favicon.svg" type="image/svg+xml">` +
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/ibm-plex-sans-400-latin.woff2">` +
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/ibm-plex-sans-600-latin.woff2">` +
    `<link rel="preload" as="font" type="font/woff2" crossorigin href="/fonts/ibm-plex-mono-500-latin.woff2">` +
    `<link rel="stylesheet" href="/src/funnel.css">${p.head ?? ""}${p.guide ? articleLd(p) : ""}</head>` +
    `<body data-page="${p.slug}"><a class="skip-link" href="#main">${de ? "Zum Inhalt springen" : lang === "tr" ? "İçeriğe geç" : "Skip to content"}</a>` +
    `<header><a class="brand" href="/index.html">${mark()}<span><b>Kionel</b><span>LAB WORKFLOWS</span></span></a>` +
    `<button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav">${de ? "Menü" : lang === "tr" ? "Menü" : "Menu"}</button>` +
    `<nav id="site-nav" aria-label="Main">${nav}</nav></header>` +
    `<main id="main">${p.body}</main>` +
    `<footer>${en ? footerEn(seller) : de ? footerDe(seller) : footerTr(seller)}</footer>` +
    `<script type="module" src="/src/site.ts"></script><script type="module" src="/src/funnel.ts"></script></body></html>`;
  writeFileSync(join(root, "apps/web", `${p.slug}.html`), html);
}
console.log(`${pages.length} funnel pages generated; indexing is controlled by launch preparation.`);
