/**
 * QR inceleme aracı: resim bu sekmede okunur, hiçbir şey yüklenmez. Kodun içindeki
 * metni ve onu gören herkesin ne öğreneceğini gösterir.
 */
import "./report.css";
import { decodeFrames } from "@kionel/transport-qr";
import { inspectQr, type QrFinding } from "./qr-inspect.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tr = document.documentElement.lang === "tr";
const t = (en: string, turkish: string) => (tr ? turkish : en);
const IDLE = t("Drop a picture of a QR code here, or click to choose", "QR kodun resmini buraya bırakın ya da tıklayıp seçin");
// ponytail: resim başına en çok 4 kod; daha fazlası için resmi kırpın.
const MAX_CODES = 4;

function status(text: string, ok: boolean): void {
  const box = $("qr-status");
  box.textContent = text;
  box.className = `evidence-status ${ok ? "is-ok" : "is-bad"}`;
  box.hidden = false;
}

function verdict(finding: QrFinding): string {
  switch (finding.kind) {
    case "wifi": return t(`This code shows the Wi-Fi password in plain text. Anyone who photographs it can join "${finding.detail}".`,
      `Bu kod Wi-Fi parolasını düz metin olarak gösteriyor. Fotoğrafını çeken herkes "${finding.detail}" ağına girebilir.`);
    case "wifi-open": return t(`A Wi-Fi network name ("${finding.detail}") with no password in the code.`, `Parolasız bir Wi-Fi ağ adı ("${finding.detail}").`);
    case "otp": return t("This code contains the secret behind your one-time login codes. Anyone with a copy of it can generate the same codes. Treat a screenshot of it like a password.",
      "Bu kod, tek kullanımlık giriş kodlarınızı üreten sırrı taşıyor. Kopyasını alan herkes aynı kodları üretebilir. Ekran görüntüsüne parola gibi davranın.");
    case "otp-export": return t("This is an authenticator export: it contains the login-code secrets of every account in it.",
      "Bu bir doğrulayıcı dışa aktarımı: içindeki her hesabın giriş kodu sırrını taşıyor.");
    case "link-secret": return t(`This link carries what looks like a password or access token ("${finding.detail}"). Anyone who scans the code gets it.`,
      `Bu bağlantı parola ya da erişim belirteci gibi görünen bir değer taşıyor ("${finding.detail}"). Kodu okutan herkes onu alır.`);
    case "private-key": return t("This looks like a private key or a wallet recovery phrase. Anyone who scans it controls what it protects.",
      "Bu bir özel anahtara ya da cüzdan kurtarma cümlesine benziyor. Kodu okutan, koruduğu şeyin sahibi olur.");
    case "opaque": return t(`This code holds ${finding.bytes} bytes that mean nothing to a reader. That does not show it is encrypted: apps often only scramble such data with a method built into the app, and anyone with the app can undo it. This tool cannot tell which it is; until the maker says, treat the code like a password.`,
      `Bu kod, okuyana bir şey ifade etmeyen ${finding.bytes} bayt taşıyor. Bu, şifreli olduğunu göstermez: uygulamalar çoğu zaman veriyi yalnızca uygulamaya gömülü bir yöntemle karıştırır ve uygulamaya sahip herkes bunu geri alabilir. Bu araç hangisi olduğunu bilemez; üretici söyleyene kadar koda parola gibi davranın.`);
    case "link": return t("A link, with nothing that looks like a password or token in it. Where it leads is a separate question: this tool does not open it.",
      "Bir bağlantı; içinde parola ya da belirteç gibi görünen bir şey yok. Nereye götürdüğü ayrı bir soru: bu araç bağlantıyı açmaz.");
    case "contact": return t("Contact details in plain text: anyone who scans the code reads them.", "Düz metin kişi bilgileri: kodu okutan herkes bunları okur.");
    case "text": return t("Plain text. Anyone who scans the code reads exactly this.", "Düz metin. Kodu okutan herkes tam olarak bunu okur.");
  }
}

function show(findings: QrFinding[]): void {
  const list = $("qr-results");
  list.replaceChildren(...findings.map((finding) => {
    const item = document.createElement("div");
    const note = document.createElement("p");
    note.className = `evidence-status ${finding.level === "plain" ? "is-ok" : "is-bad"}`;
    note.textContent = verdict(finding);
    const facts = document.createElement("dl");
    facts.className = "evidence-facts";
    const term = document.createElement("dt");
    term.textContent = t(`Content (${finding.bytes} bytes)`, `İçerik (${finding.bytes} bayt)`);
    const content = document.createElement("dd");
    content.textContent = finding.text;
    facts.append(term, content);
    item.append(note, facts);
    return item;
  }));
}

async function take(file: File | undefined): Promise<void> {
  if (!file) return;
  const label = $("qr-drop").querySelector("span")!;
  label.textContent = t(`Reading ${file.name}…`, `${file.name} okunuyor…`);
  $("qr-results").replaceChildren();
  $("qr-clear").hidden = true;
  let codes: Uint8Array[];
  try {
    const image = await createImageBitmap(file);
    // Fotoğraflar büyük olabilir; QR için 3000 piksel yeter.
    const scale = Math.min(1, 3000 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    codes = await decodeFrames(context.getImageData(0, 0, canvas.width, canvas.height), MAX_CODES);
  } catch {
    label.textContent = IDLE;
    status(t(`${file.name} could not be opened as a picture. Use a PNG or JPEG screenshot or photo.`, `${file.name} resim olarak açılamadı. PNG ya da JPEG ekran görüntüsü veya fotoğraf kullanın.`), false);
    return;
  }
  $("qr-clear").hidden = false;
  if (!codes.length) {
    label.textContent = IDLE;
    status(t("No QR code could be read in this picture. Use a sharper or larger one, with the whole code visible.", "Bu resimde okunabilen bir QR kod yok. Kodun tamamı görünen, daha net ya da daha büyük bir resim kullanın."), false);
    return;
  }
  label.textContent = `✓ ${file.name} — ${t("drop another to replace", "değiştirmek için başka resim bırakın")}`;
  const findings = codes.map(inspectQr);
  show(findings);
  const exposed = findings.filter((finding) => finding.level !== "plain").length;
  status(exposed
    ? t(`${codes.length} code(s) read in this tab; ${exposed} need your attention. Nothing was uploaded.`, `Bu sekmede ${codes.length} kod okundu; ${exposed} tanesi dikkat istiyor. Hiçbir şey yüklenmedi.`)
    : t(`${codes.length} code(s) read in this tab; no password, key or token was recognised. Nothing was uploaded.`, `Bu sekmede ${codes.length} kod okundu; parola, anahtar ya da belirteç tanınmadı. Hiçbir şey yüklenmedi.`), !exposed);
}

const input = $<HTMLInputElement>("qr-file");
const drop = $("qr-drop");
input.onchange = () => void take(input.files?.[0]);
drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("is-over");
  void take(event.dataTransfer?.files[0]);
});
$("qr-clear").onclick = () => {
  input.value = "";
  $("qr-results").replaceChildren();
  $("qr-clear").hidden = true;
  drop.querySelector("span")!.textContent = IDLE;
  status(t("Picture removed. Nothing was kept.", "Resim kaldırıldı. Hiçbir şey saklanmadı."), true);
};
