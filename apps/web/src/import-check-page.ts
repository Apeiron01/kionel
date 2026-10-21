import "./import-check.css";
import { checkImport, decodeImport, IMPORT_EXAMPLE, IMPORT_LIMITS, parseImportCsv, readImportProfile, writeImportCsv,
  type Delimiter, type ImportCheck, type ImportColumn, type ImportProfile } from "@kionel/lab-workflows/import-check";
import { readExcelSelection, type ExcelSelectionBridge } from "./excel-import.ts";

const tr = document.documentElement.lang === "tr";
const t = (en: string, turkish: string) => tr ? turkish : en;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sourceText = $<HTMLTextAreaElement>("ic-source-text"), planText = $<HTMLTextAreaElement>("ic-plan-text");
const sourceSeparator = $<HTMLSelectElement>("ic-source-separator");
let baseProfile: ImportProfile | undefined, report: string | undefined, prepared: string | undefined;
let sourceBytes: Uint8Array | undefined, sourceName = "pasted.csv", sourceKind = "pasted-csv";
let planLoadFailed = false;
let revision = 0;
const sepValue = (v: string): Delimiter => v === "tab" ? "\t" : v === ";" ? ";" : ",";
const sourceSep = () => sourceSeparator.value === "auto" ? undefined : sepValue(sourceSeparator.value);

function invalidate(): number {
  revision++; prepared = undefined; report = undefined;
  $("ic-result").hidden = true;
  $<HTMLButtonElement>("ic-download").disabled = true;
  $<HTMLButtonElement>("ic-report").disabled = true;
  return revision;
}
function status(message: string, error = false): void {
  const box = $("ic-status"); box.textContent = message; box.hidden = false;
  box.className = `ic-status${error ? " is-error" : ""}`;
}
function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Check could not be completed.";
  const translations: Record<string, string> = {
    "Select at least one identifier column as the record key.": "Kayıt kimliği için en az bir kimlik sütunu seçin.",
    "The file is not UTF-8. Export it as CSV UTF-8 first.": "Dosya UTF-8 değil. Önce CSV UTF-8 olarak dışa aktarın.",
    "CSV needs a non-empty, unique header row without surrounding spaces.": "CSV, başında/sonunda boşluk olmayan ve tekrarlanmayan sütun adları içermeli.",
    "Invalid identifier width.": "Kimlik uzunluğu 1–256 arasında tam sayı olmalı.",
    "Choose the source decimal separator.": "Kaynak ondalık işaretini . veya , olarak girin.",
    "Enter distinct allowed values separated by |.": "İzinli değerleri | ile ayırın; boş veya tekrarlı değer kullanmayın.",
    "Use text or identifier fields for record keys, not decimal values.": "Kimlik sütununda ondalık değer yerine metin veya kimlik türü kullanın.",
    "Malformed CSV: a quoted field was not closed.": "CSV'de tırnaklı bir alan kapatılmamış.",
    "Malformed CSV: unexpected character or quote.": "CSV'de beklenmeyen karakter veya tırnak var.",
    "Ambiguous separator. Choose comma, semicolon or tab explicitly.": "Ayırıcı belirsiz. Virgül, noktalı virgül veya sekmeyi açıkça seçin.",
    "Profile columns need unique source and safe target names.": "Kaynak ve hedef sütun adları benzersiz olmalı; hedef adı formül gibi başlayamaz.",
    "Invalid import profile.": "Profil biçimi geçersiz. Kionel Import Check profil dosyası kullanın.",
    "Use at most 32 columns.": "En fazla 32 sütun kullanın.",
    "Use at most 10,000 data rows.": "En fazla 10.000 veri satırı kullanın.",
    "A cell exceeds 256 characters.": "Bir hücre 256 karakteri aşıyor.",
    "CSV exceeds 2 MB.": "CSV 2 MB sınırını aşıyor.",
  };
  return tr ? translations[message] ?? message : message;
}
function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeName(): string {
  return sourceName.replace(/\.[^.]+$/, "").replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0,70) || "result";
}
const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)),
  (b) => b.toString(16).padStart(2,"0")).join("");
const utf8 = (s: string) => new TextEncoder().encode(s);

function renderProfile(profile: ImportProfile): void {
  baseProfile = structuredClone(profile);
  $<HTMLInputElement>("ic-profile-name").value = profile.name;
  $<HTMLInputElement>("ic-profile-revision").value = String(profile.revision);
  $<HTMLSelectElement>("ic-output-separator").value = profile.outputDelimiter === "\t" ? "tab" : profile.outputDelimiter;
  $<HTMLSelectElement>("ic-output-decimal").value = profile.outputDecimal;
  const body = $("ic-mapping"); body.replaceChildren();
  profile.columns.forEach((column, index) => {
    const row = document.createElement("tr"); row.dataset.index = String(index);
    const cell = (control: Node) => { const td = document.createElement("td"); td.append(control); row.append(td); };
    cell(document.createTextNode(column.source));
    const target = document.createElement("input"); target.value = column.target; target.maxLength = 120; target.dataset.field = "target";
    target.setAttribute("aria-label", `${column.source}: ${t("target name", "hedef adı")}`); cell(target);
    const kind = document.createElement("select"); kind.dataset.field = "kind";
    for (const [value, label] of [["text", t("Text", "Metin")], ["id", t("Identifier", "Kimlik")], ["decimal", t("Decimal", "Ondalık")], ["choice", t("Allowed values", "İzinli değerler")]]) {
      const option = document.createElement("option"); option.value = value; option.textContent = label; kind.append(option);
    }
    kind.value = column.kind; kind.setAttribute("aria-label", `${column.source}: ${t("type", "tür")}`); cell(kind);
    const rule = document.createElement("input"); rule.dataset.field = "rule"; rule.maxLength = 1024;
    rule.value = column.kind === "id" ? String(column.width ?? "") : column.kind === "decimal" ? column.separator! : column.kind === "choice" ? column.values!.join("|") : "";
    rule.setAttribute("aria-label", `${column.source}: ${t("rule", "kural")}`); cell(rule);
    const key = document.createElement("input"); key.type = "checkbox"; key.dataset.field = "key"; key.checked = column.key;
    key.setAttribute("aria-label", `${column.source}: ${t("record key", "kayıt kimliği")}`); cell(key);
    const updateRule = () => {
      rule.disabled = kind.value === "text";
      rule.placeholder = kind.value === "id" ? t("Width (optional)", "Uzunluk (isteğe bağlı)") : kind.value === "decimal" ? ". or ," : "mg/L|pH";
      key.disabled = kind.value === "decimal";
      if (key.disabled) key.checked = false;
    };
    kind.addEventListener("change", () => { rule.value = kind.value === "decimal" ? "." : ""; updateRule(); });
    updateRule(); body.append(row);
  });
  $("ic-profile-editor").hidden = false;
}

function currentProfile(): ImportProfile {
  if (!baseProfile) throw new Error(t("Choose a CSV and create a profile, or load a saved profile first.", "Önce CSV'den profil oluşturun veya kaydedilmiş bir profil yükleyin."));
  const columns = Array.from($("ic-mapping").querySelectorAll("tr")).map((row, index): ImportColumn => {
    const field = <T extends HTMLInputElement | HTMLSelectElement>(name: string) => row.querySelector<T>(`[data-field="${name}"]`)!;
    const kind = field<HTMLSelectElement>("kind").value as ImportColumn["kind"], rule = field<HTMLInputElement>("rule").value;
    return { source: baseProfile!.columns[index].source, target: field<HTMLInputElement>("target").value,
      kind, key: field<HTMLInputElement>("key").checked,
      ...(kind === "id" && rule !== "" ? { width: Number(rule) } : {}),
      ...(kind === "decimal" ? { separator: rule as "." | "," } : {}),
      ...(kind === "choice" ? { values: rule.split("|") } : {}) };
  });
  return readImportProfile({ ...baseProfile, name: $<HTMLInputElement>("ic-profile-name").value,
    revision: Number($<HTMLInputElement>("ic-profile-revision").value), columns,
    outputDelimiter: sepValue($<HTMLSelectElement>("ic-output-separator").value),
    outputDecimal: $<HTMLSelectElement>("ic-output-decimal").value });
}

function newProfile(): void {
  const data = parseImportCsv(sourceText.value, sourceSep());
  renderProfile({ schema: "kionel-import-profile/v1", name: t("My import", "Aktarım profilim"), revision: 1,
    sourceColumns: data.columns, outputDelimiter: ",", outputDecimal: ".",
    columns: data.columns.map((name) => ({ source: name, target: name, kind: "text", key: false })) });
  status(t("Review the column rules and choose the record key before checking.", "Kontrolden önce sütun kurallarını gözden geçirin ve kayıt kimliğini seçin."));
}

function sourceInfo(): void {
  const data = parseImportCsv(sourceText.value, sourceSep());
  $("ic-source-info").textContent = `${sourceName} · ${data.rows.length} ${t("data rows", "veri satırı")} · ${data.columns.length} ${t("columns", "sütun")}`;
}

async function loadFile(slot: "source" | "plan" | "profile", file: File | undefined): Promise<void> {
  if (!file) return;
  const generation = invalidate();
  // Remove the previous file's contents before reading the replacement, even if the replacement fails.
  if (slot === "source") { sourceText.value = ""; sourceBytes = undefined; }
  if (slot === "plan") { planText.value = ""; planLoadFailed = true; }
  if (slot === "profile") { baseProfile = undefined; $("ic-profile-editor").hidden = true; }
  try {
    if (file.size > (slot === "profile" ? 128 * 1024 : IMPORT_LIMITS.bytes)) throw new Error(t("File exceeds the supported size.", "Dosya desteklenen boyutu aşıyor."));
    const bytes = new Uint8Array(await file.arrayBuffer()), text = decodeImport(bytes);
    if (generation !== revision) return;
    if (slot === "source") {
      sourceText.value = text; sourceBytes = bytes; sourceName = file.name; sourceKind = "file-csv";
      sourceInfo(); if (!baseProfile) newProfile();
    } else if (slot === "plan") { parseImportCsv(text); planText.value = text; planLoadFailed = false; }
    else renderProfile(readImportProfile(JSON.parse(text)));
    status(t("File loaded locally. Check again after any change.", "Dosya yerelde okundu. Değişiklikten sonra yeniden kontrol edin."));
  } catch (e) {
    if (generation === revision) {
      if (slot === "source") { sourceText.value = ""; sourceBytes = undefined; }
      status(errorMessage(e), true);
    }
  }
}

const findingNames: Record<string, [string, string]> = {
  schema_changed: ["Source header differs from the saved profile", "Kaynak başlığı kayıtlı profilden farklı"],
  empty_data: ["No data rows", "Veri satırı yok"], row_shape: ["Wrong number of cells", "Hücre sayısı yanlış"],
  invalid_cell: ["Missing value, surrounding spaces or unsupported characters", "Eksik değer, kenar boşluğu veya desteklenmeyen karakter"],
  invalid_decimal: ["Decimal does not match the selected source format", "Ondalık değer seçilen kaynak biçimine uymuyor"],
  formula_like: ["Formula-like text cannot be exported safely", "Formül gibi başlayan metnin dışa aktarımı durduruldu"],
  identifier_width: ["Identifier width differs; no zero-padding applied", "Kimlik uzunluğu farklı; sıfır eklenmedi"],
  invalid_choice: ["Value is outside the allowed list", "Değer izinli listenin dışında"],
  duplicate_key: ["Record key occurs more than once", "Kayıt kimliği tekrarlanıyor"],
  missing_key: ["Expected record is missing", "Beklenen kayıt eksik"], unexpected_key: ["Record is outside the expected list", "Kayıt beklenen listenin dışında"],
  plan_schema: ["Expected list must use the target key headers in order", "Beklenen liste hedef kimlik başlıklarını sırayla kullanmalı"],
  invalid_plan: ["Expected list has an invalid or empty key", "Beklenen listede geçersiz veya boş kimlik var"],
  duplicate_plan: ["Expected list itself contains duplicate keys", "Beklenen listede tekrarlı kimlik var"],
};

function renderResult(result: ImportCheck): void {
  $("ic-result").hidden = false;
  const title = $("ic-result-title"); title.className = result.state === "passed" ? "ic-result-pass" : "ic-result-block";
  title.textContent = result.state === "passed" ? t("Selected checks passed", "Seçilen kontroller geçti") : t("CSV preparation blocked", "CSV hazırlama durduruldu");
  $("ic-result-summary").textContent = `${result.observedRows} ${t("rows", "satır")} · ${result.totalFindings} ${t("findings", "bulgu")} · ${t("Nothing sent to a destination system.", "Hedef sisteme gönderim yapılmadı.")}`;
  $("ic-coverage").textContent = result.coverageChecked
    ? t(`Coverage checked against the supplied ${result.expectedRows}-key list only.`, `Kapsam yalnız verilen ${result.expectedRows} kimlikli listeye göre kontrol edildi.`)
    : t("Completeness was not checked. Without a valid expected list, missing records cannot be determined.", "Kapsam kontrol edilmedi. Geçerli beklenen liste olmadan eksik kayıt belirlenemez.");
  const head = $("ic-result-head"), body = $("ic-result-body"); head.replaceChildren(); body.replaceChildren();
  const addRow = (parent: HTMLElement, cells: string[], tag: "th" | "td") => {
    const row = document.createElement("tr");
    for (const value of cells) { const cell = document.createElement(tag); cell.textContent = value; row.append(cell); }
    parent.append(row);
  };
  if (result.findings.length) {
    addRow(head, [t("Row", "Satır"), t("Column / key", "Sütun / kimlik"), t("Finding", "Bulgu"), t("Value", "Değer")], "th");
    for (const finding of result.findings.slice(0,100)) addRow(body, [String(finding.row ?? "—"), finding.column ?? finding.key?.join(" + ") ?? "—",
      findingNames[finding.code]?.[tr ? 1 : 0] ?? finding.code, finding.value ?? "—"], "td");
    if (result.totalFindings > 100) addRow(body, ["…", "", t("First 100 shown; the report contains up to 2,000 findings and the full finding count.", "İlk 100 bulgu gösteriliyor; rapor en fazla 2.000 bulguyu ve toplam bulgu sayısını içerir."), ""], "td");
  } else if (result.output) {
    addRow(head, result.output.columns, "th");
    for (const row of result.output.rows.slice(0,5)) addRow(body, row, "td");
  }
}

async function runCheck(): Promise<void> {
  const generation = invalidate();
  try {
    if (planLoadFailed) throw new Error(t("The expected list could not be read. Load a valid list or explicitly remove it.", "Beklenen liste okunamadı. Geçerli liste yükleyin veya listeyi açıkça kaldırın."));
    const profile = currentProfile(), source = parseImportCsv(sourceText.value, sourceSep());
    const expected = planText.value !== "" ? parseImportCsv(planText.value) : undefined;
    const result = checkImport(profile, source, expected);
    const outputText = result.output ? writeImportCsv(result.output, profile.outputDelimiter) : undefined;
    const [sourceHash, profileHash, expectedHash, outputHash] = await Promise.all([
      hash(sourceBytes ?? utf8(sourceText.value)), hash(utf8(JSON.stringify(profile))),
      expected ? hash(utf8(planText.value)) : null, outputText ? hash(utf8(outputText)) : null,
    ]);
    if (generation !== revision) return;
    const { output: _output, ...summary } = result;
    report = JSON.stringify({ ...summary, generatedAt: new Date().toISOString(), sourceName, sourceKind,
      sourceSha256Basis: sourceBytes ? "original-file-bytes" : sourceKind === "excel-selection" ? "formatted-selection-csv-utf8" : "csv-text-utf8",
      sourceSha256: sourceHash, profile, profileSha256: profileHash, expectedTextSha256: expectedHash, outputSha256: outputHash }, null, 2);
    prepared = outputText;
    renderResult(result);
    $<HTMLButtonElement>("ic-download").disabled = prepared === undefined;
    $<HTMLButtonElement>("ic-report").disabled = false;
    status(result.state === "passed" ? t("Check complete. Review the preview before downloading.", "Kontrol tamamlandı. İndirmeden önce önizlemeyi inceleyin.")
      : t("Review the findings and correct the source or the rules; no prepared CSV is available.", "Bulguları inceleyip kaynağı veya kuralları düzeltin; hazırlanmış CSV verilmedi."), result.state !== "passed");
  } catch (e) { if (generation === revision) status(errorMessage(e), true); }
}

$("ic-check").addEventListener("click", () => void runCheck());
$("ic-columns").addEventListener("click", () => { invalidate(); try { newProfile(); } catch (e) { status(errorMessage(e), true); } });
$("ic-save-profile").addEventListener("click", () => { try { download("kionel-import-profile.json", JSON.stringify(currentProfile(), null, 2), "application/json"); } catch (e) { status(errorMessage(e), true); } });
$("ic-plan-template").addEventListener("click", () => {
  try { const p = currentProfile(); download("expected-keys.csv", writeImportCsv({ columns: p.columns.filter((c) => c.key).map((c) => c.target), rows: [] }, ","), "text/csv;charset=utf-8"); }
  catch (e) { status(errorMessage(e), true); }
});
$("ic-download").addEventListener("click", () => { if (prepared !== undefined) download(`${safeName()}-prepared.csv`, prepared, "text/csv;charset=utf-8"); });
$("ic-report").addEventListener("click", () => { if (report !== undefined) download(`${safeName()}-import-check.json`, report, "application/json"); });
for (const slot of ["source", "plan", "profile"] as const) {
  const input = $<HTMLInputElement>(`ic-${slot}-file`);
  input.addEventListener("change", () => { const file = input.files?.[0]; input.value = ""; void loadFile(slot, file); });
}
sourceText.addEventListener("input", () => { sourceBytes = undefined; sourceName = "pasted.csv"; sourceKind = "pasted-csv"; invalidate(); });
planText.addEventListener("input", () => { planLoadFailed = false; invalidate(); });
sourceSeparator.addEventListener("change", invalidate);
$("ic-profile-editor").addEventListener("input", invalidate);
$("ic-profile-editor").addEventListener("change", invalidate);
$("ic-clear-plan").addEventListener("click", () => { planText.value = ""; planLoadFailed = false; invalidate(); status(t("Expected list removed. Completeness will not be checked.", "Beklenen liste kaldırıldı. Kapsam kontrol edilmeyecek.")); });
function example(broken: boolean): void {
  invalidate(); sourceBytes = undefined; sourceKind = "example-csv"; sourceName = broken ? "missing-example.csv" : "valid-example.csv";
  sourceSeparator.value = "auto"; sourceText.value = broken ? IMPORT_EXAMPLE.broken : IMPORT_EXAMPLE.source;
  planText.value = IMPORT_EXAMPLE.plan; planLoadFailed = false; renderProfile(IMPORT_EXAMPLE.profile); sourceInfo(); void runCheck();
}
$("ic-example").addEventListener("click", () => example(false));
$("ic-broken").addEventListener("click", () => example(true));
$("ic-reset").addEventListener("click", () => {
  invalidate(); sourceText.value = ""; planText.value = ""; planLoadFailed = false; sourceBytes = undefined; baseProfile = undefined;
  sourceName = "pasted.csv"; sourceKind = "pasted-csv"; $("ic-profile-editor").hidden = true; $("ic-mapping").replaceChildren();
  $("ic-source-info").textContent = t("Working data cleared from this tab.", "Çalışma verisi bu sekmeden temizlendi.");
  status(t("Data cleared. Files already downloaded remain on your device.", "Veriler temizlendi. Önceden indirilen dosyalar cihazınızda kalır."));
});
$("ic-excel")?.addEventListener("click", async () => {
  const generation = invalidate(); sourceBytes = undefined; sourceText.value = "";
  try {
    const office = (globalThis as unknown as { Office?: ExcelSelectionBridge }).Office;
    const table = await readExcelSelection(office);
    if (generation !== revision) return;
    sourceText.value = writeImportCsv(table, ","); sourceSeparator.value = ","; sourceKind = "excel-selection"; sourceName = "excel-selection.csv";
    sourceInfo(); if (!baseProfile) newProfile();
    status(t("Formatted selection read locally. Review the rules; Excel may already have changed the original values.", "Biçimlenmiş seçim yerelde okundu. Kuralları inceleyin; Excel özgün değerleri önceden değiştirmiş olabilir."));
  } catch (e) { if (generation === revision) status(errorMessage(e), true); }
});
