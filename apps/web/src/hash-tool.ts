/**
 * SHA-256 aracı: dosya bu sekmede okunur ve özetlenir; hiçbir şey yüklenmez.
 * Rehber sayfasındaki araç, ürünün her aktarımda yaptığı ilk kontrolün aynısı.
 */
import "./report.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const lang = document.documentElement.lang;
const t = (en: string, tr: string, de: string) => (lang === "tr" ? tr : lang === "de" ? de : en);
const IDLE = t("Drop a file here, or click to choose", "Dosyayı buraya bırakın ya da tıklayıp seçin", "Datei hier ablegen oder klicken");
// ponytail: dosya belleğe tek parça okunur; 1 GiB üstünde komut satırı önerilir (parça parça okur).
const MAX_BYTES = 1024 ** 3;
let actual = "";

function status(text: string, ok: boolean): void {
  const box = $("hash-status");
  box.textContent = text;
  box.className = `evidence-status ${ok ? "is-ok" : "is-bad"}`;
  box.hidden = false;
}

/** Büyük/küçük harf ve eski certutil'in bayt arası boşlukları değeri değiştirmez. */
function compare(): void {
  const expected = $<HTMLInputElement>("hash-expected").value.replace(/[\s:]/g, "").toLowerCase();
  if (!expected) return;
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    status(t("The expected value is not a SHA-256: it should be 64 characters, 0–9 and a–f.", "Beklenen değer bir SHA-256 değil: 64 karakter olmalı, 0–9 ve a–f.", "Der erwartete Wert ist kein SHA-256: 64 Zeichen, 0–9 und a–f."), false);
    return;
  }
  if (!actual) {
    status(t("Now add the file to compare with this value.", "Şimdi bu değerle karşılaştırılacak dosyayı ekleyin.", "Jetzt die Datei hinzufügen, die mit diesem Wert verglichen werden soll."), false);
    return;
  }
  status(expected === actual
    ? t("Match: this is the same file, bit for bit.", "Eşleşiyor: bu, bit bit aynı dosya.", "Übereinstimmung: Es ist Bit für Bit dieselbe Datei.")
    : t("No match: this file is not the one the expected value was taken from.", "Eşleşmiyor: bu dosya, beklenen değerin alındığı dosya değil.", "Keine Übereinstimmung: Diese Datei ist nicht die, von der der erwartete Wert stammt."), expected === actual);
}

async function take(file: File | undefined): Promise<void> {
  if (!file) return;
  const label = $("hash-drop");
  if (file.size > MAX_BYTES) {
    status(t(`${file.name} is larger than 1 GB. Use the command for your system below; it reads the file in pieces.`, `${file.name} 1 GB'tan büyük. Aşağıdaki komutu kullanın; dosyayı parça parça okur.`, `${file.name} ist größer als 1 GB. Nutzen Sie den Befehl für Ihr System unten; er liest die Datei in Teilen.`), false);
    return;
  }
  label.querySelector("span")!.textContent = t(`Reading ${file.name}…`, `${file.name} okunuyor…`, `${file.name} wird gelesen…`);
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
    actual = Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    actual = "";
    label.querySelector("span")!.textContent = IDLE;
    status(t(`${file.name} could not be read. Try again, or use the command for your system below.`, `${file.name} okunamadı. Yeniden deneyin ya da aşağıdaki komutu kullanın.`, `${file.name} konnte nicht gelesen werden. Erneut versuchen oder den Befehl unten nutzen.`), false);
    return;
  }
  label.classList.add("loaded");
  label.querySelector("span")!.textContent = `✓ ${file.name} — ${t("drop another to replace", "değiştirmek için başka dosya bırakın", "zum Ersetzen eine andere ablegen")}`;
  $("hash-name").textContent = file.name;
  $("hash-size").textContent = t(`${file.size.toLocaleString("en")} bytes`, `${file.size.toLocaleString("tr")} bayt`, `${file.size.toLocaleString("de")} Byte`);
  $("hash-value").textContent = actual;
  $("hash-output").hidden = false;
  status(t("SHA-256 calculated in this tab. Paste an expected value below to compare.", "SHA-256 bu sekmede hesaplandı. Karşılaştırmak için beklenen değeri aşağıya yapıştırın.", "SHA-256 in diesem Tab berechnet. Zum Vergleich unten den erwarteten Wert einfügen."), true);
  compare();
}

const input = $<HTMLInputElement>("hash-file");
const drop = $("hash-drop");
input.onchange = () => void take(input.files?.[0]);
drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("is-over"); });
drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
drop.addEventListener("drop", (event) => {
  event.preventDefault();
  drop.classList.remove("is-over");
  void take(event.dataTransfer?.files[0]);
});
$("hash-expected").addEventListener("input", compare);
$("hash-clear").onclick = () => {
  actual = "";
  input.value = "";
  drop.classList.remove("loaded");
  drop.querySelector("span")!.textContent = IDLE;
  $("hash-output").hidden = true;
  status(t("File removed. Drop another file to check it.", "Dosya kaldırıldı. Denetlemek için başka bir dosya bırakın.", "Datei entfernt. Zum Prüfen eine andere Datei ablegen."), true);
};
$("hash-copy").onclick = async () => {
  try {
    await navigator.clipboard.writeText(actual);
    status(t("SHA-256 copied.", "SHA-256 kopyalandı.", "SHA-256 kopiert."), true);
  } catch {
    status(t("Copying is blocked in this browser. Select the value above and copy it by hand.", "Bu tarayıcı kopyalamaya izin vermiyor. Yukarıdaki değeri seçip elle kopyalayın.", "Kopieren ist in diesem Browser blockiert. Den Wert oben markieren und von Hand kopieren."), false);
  }
};
