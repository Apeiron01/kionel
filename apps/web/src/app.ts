/** Kionel web demo — QR el sıkışması, şifreli aktarım ve teslim makbuzu. */
import {
  FRAME_OVERHEAD,
  AdaptiveFlowController,
  ControlKind,
  FrameType,
  LtDecoder,
  decodeAck,
  decodeHandshakeControl,
  decodeFrame as parseFrame,
  encodeAck,
  encodeHandshakeControl,
  encodeFrame,
  ltEncode,
  negotiateCapabilities,
  pack,
  packSecureEnvelope,
  systematicEncode,
  unpack,
  unpackSecureEnvelope,
  type AckMessage,
  type NegotiatedCapabilities,
  type SessionCapabilities,
} from "@kionel/core";
import {
  b64,
  createProtectedIdentity,
  unb64,
  importProtectedIdentity,
  verifyDispatch,
  verifyReceipt,
  verifyAuditLedger,
  type AuditEntry,
  type Bytes,
  type Dispatch,
  type DispatchContext,
  type Identity,
  type Pending,
  type QualificationEvidence,
  type Receipt,
  type Session,
} from "@kionel/crypto";
import {
  answerOffer,
  createOffer,
  finishOffer,
  issueAuditEntry,
  issueDispatch,
  issueQualificationEvidence,
  issueReceipt,
  createReceiverKey,
  createTransferCode,
  formatTransferCode,
  isCodeWire,
  issueReceiverCard,
  normalizeTransferCode,
  openOneWay,
  openWithCode,
  sealOneWay,
  sealWithCode,
  verifyReceiverCard,
  expand,
  isShrunk,
  shrink,
  type ReceiverCard,
  type ReceiverKey,
} from "@kionel/issue";
import {
  CLOCK_WARNING, RECORDS_STAY_VALID, entitlement, licenseNotice, licenseSeverity, monotonicNow, verifyLicense,
  type ClockState, type Entitlement,
} from "@kionel/licensing";
import {
  LAB_PILOT_KEY_POLICY,
  browserEd25519Identity,
  evaluateKeyPolicy,
} from "@kionel/platform-keys";
import {
  MAX_CONTENT_LIMIT_BYTES, decodeFrames as readQrAll, drawFrame, drawFrames, focusRegion, type Box,
  estimateTransfer, formatBytes, frameBytes,
} from "@kionel/transport-qr";
import { MATRIX_GATE, attemptPayload, matrixAttemptIndex, matrixAttemptName, sameBytes } from "@kionel/qualification";
import { TRANSFER_PRODUCT_UI, isTransferProductProfile, type TransferProductProfile } from "./products.ts";
import QRCode from "qrcode";
import { renderSasMarks } from "./sas-marks.ts";
import { explainReason, inspectEvidence, printEvidence } from "./evidence-view.ts";
import { renderAllStories, renderStory } from "./storyboard.ts";
import { bundleFiles } from "./zip.ts";
import { FREE_PAPER_PAGES, MAX_PAGES, pagesFor, paperFrames, paperPlan, type Density, type PaperPlan } from "./paper.ts";
import { receiveSteps, sendSteps, type SendRoute, type Step } from "./steps.ts";
import { SERIAL_BLOCK, Unwrapper, choosePort, portCancelled, portProblem, serialSupported, wrap, type SerialPortLike } from "./serial-link.ts";
import { applyTemplate, checkTemplate } from "./file-template.ts";
import { checkContext, checkFile, describePolicy, parsePolicy, policyLabel, type SitePolicy } from "./site-policy.ts";
import { LIVE_DECODE_MS, colourSeconds, recordingSeconds } from "./speed.ts";
import { LOG_LIMIT, entryFor, inPeriod, reviewReport, summary, toCsv, type LogEntry, type LogKind } from "./transfer-log.ts";
import { alreadyReceived, isAccepted, pinSender, senderShort, type TrustedSender } from "./trusted-senders.ts";
import { receiptHash as receiptFingerprint } from "@kionel/crypto";
import {
  DIGICERT_TRUSTED_ROOT_G4, anchorBytes, buildTimestampRequest, unwrapTimestampResponse, verifyTimestampWeb,
} from "@kionel/timestamp/web";
import { COLOUR_FPS, ColourReader, ColourSender, grabColourFrame } from "./colour.ts";
import { listenSound, packSoundReceipt, playSound, soundSeconds, unpackSoundReceipt } from "./sound-link.ts";
import { cameraConstraints, populateCameraPicker, rememberCamera, rememberedCamera } from "./camera.ts";
import { qrPool } from "./qr-pool.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

// ---- sürümler ----------------------------------------------------------------------
/**
 * Kişisel sürüm (ücretsiz): kendi dosyası 5 MB'a kadar, şifreli, canlı okuma ve
 * kodla eşleşme. İşletme lisansı yüklü CİHAZ: imzalı kayıtlar, rapor, denetim
 * zinciri, ekran kaydından okuma, alıcı kartı, 64 MB. Kural cihaz başınadır: sevk
 * kaydı gönderende, teslim makbuzu alıcıda üretildiği için lisans ikisinde de yüklü
 * olmalıdır (Pilot kapsamındaki "2 cihaz" budur).
 */
const FREE_MAX_BYTES = 5 * 1024 * 1024;
const isBusiness = (): boolean => access !== "demo";
const BUSINESS_NOTE = "Signed records, reports, screen recordings and receiver cards come with a business licence on this device.";

/** İşletme özelliği istenip lisans yoksa ne olduğunu ve nereden alınacağını söyler. */
function needsBusiness(feature: string): boolean {
  if (isBusiness()) return false;
  notify(`${feature} needs a business licence on this device. The free personal edition sends your own files up to 5 MB, ` +
    "read live, without signed records. Compare editions at kionel.com/pilot.html.", "warn");
  return true;
}

function businessNote(parent: HTMLElement, text: string): void {
  parent.append(Object.assign(document.createElement("p"), { className: "hint-note business-note", textContent: text }));
}

// ---- bildirim bandı -----------------------------------------------------------
type NoticeKind = "ok" | "warn" | "bad";
let noticeTimer = 0;
/**
 * Ekranın üstünde görünen mesaj. Başarı birkaç saniye sonra kaybolur; hata ve
 * uyarı, kullanıcı kapatana ya da yeni bir mesaj gelene kadar kalır.
 */
function notify(text: string, kind: NoticeKind): void {
  const box = $("notice");
  $("notice-text").textContent = text;
  box.dataset.kind = kind;
  box.hidden = false;
  window.clearTimeout(noticeTimer);
  if (kind === "ok") noticeTimer = window.setTimeout(() => { box.hidden = true; }, 7000);
}
$("notice-close").onclick = () => { $("notice").hidden = true; };
// Initialize storage names before loadIdentity synchronously opens IndexedDB.
// Declaring them below the call made the Promise reject in the temporal dead
// zone and silently downgraded every initial page load to a session identity.
const IDENTITY_DB = "kionel-secure-identity";
const IDENTITY_STORE = "keys";
const IDENTITY_KEY = "device-ed25519-v1";
const AUDIT_STORE = "audit";
const AUDIT_KEY = "ledger-v1";
let identityPersistent = true;
/**
 * İmza ve anahtar anlaşması tarayıcının yerleşik Ed25519/X25519'u ile yapılır.
 * Eski tarayıcıda (Windows 7/8.1'in son Chrome'u 109) bunlar yoktur ve aktarım
 * anlaşılmaz bir hatayla düşüyordu; açılışta söylenir, hata da aynı cümleyi taşır.
 */
const OLD_BROWSER = "This browser is too old for Kionel: it lacks the built-in Ed25519 and X25519 cryptography that signs " +
  "and encrypts transfers. Use Chrome or Edge 137 or later, Firefox 130 or later, or Safari 17 or later. " +
  "Windows 7 and 8.1 cannot run these versions.";
void Promise.all([
  crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign"]),
  crypto.subtle.generateKey({ name: "X25519" }, false, ["deriveBits"]),
]).catch(() => notify(OLD_BROWSER, "bad"));
const identityPromise = loadIdentity();
/**
 * Kabul edilen en büyük dosya: protokolün taşıyabildiğinin tamamı.
 *
 * Bir ara 5 MiB'e çekilmişti ki kimse pişman olacağı bir aktarımı başlatmasın.
 * Yanlış araçtı: protokolün taşıyabildiği bir dosyayı reddetmek ÜRÜNÜ sınırlar,
 * uzun süren bir aktarım ise yalnızca kullanıcının sabrını sınırlar — ve sabır
 * onun harcayacağı şey. Doğru çözüm süreyi başlamadan önce söylemek ve uzun
 * aktarımı yasaklamak yerine BÖLÜNEBİLİR kılmak.
 */
const MAX_WEB_TRANSFER_BYTES = MAX_CONTENT_LIMIT_BYTES;

/**
 * Tek kamera karesinde aranacak azami kod sayısı.
 *
 * Sınırsız arama, kodun hiç olmadığı bir görüntüde tarayıcıyı boşuna meşgul
 * eder ve kare hızını düşürür — yani kurtarmaya çalıştığı şeyi bozar. Dokuz,
 * gönderen tarafındaki en büyük ızgarayla aynı.
 */
const MAX_SYMBOLS_PER_FRAME = 9;
const LOCAL_CAPABILITIES: SessionCapabilities = {
  v: 1,
  transports: ["qr-v1"],
  maxFrameBytes: frameBytes(40),
  maxFps: 60,
  duplex: true,
  arq: true,
  resume: true,
};

// ---- ürün profilleri --------------------------------------------------------
type ProductProfile = DispatchContext["profile"] & TransferProductProfile;
const PRODUCTS = TRANSFER_PRODUCT_UI;
const requestedProduct = new URLSearchParams(location.search).get("product");
let activeProduct: ProductProfile = isTransferProductProfile(requestedProduct) ? requestedProduct : "lab";

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-product]"))) {
  button.onclick = () => setProduct(button.dataset.product as ProductProfile);
}
setProduct(activeProduct);

function setProduct(profile: ProductProfile): void {
  const product = PRODUCTS[profile];
  if (!product) return;
  activeProduct = profile;
  document.documentElement.style.setProperty("--acc", product.accent);
  $("product-name").textContent = product.name;
  $("product-promise").textContent = product.promise;
  $("context-title").textContent = product.contextTitle;
  $("reference-label").textContent = product.referenceLabel;
  $<HTMLInputElement>("context-reference").placeholder = product.referencePlaceholder;
  $("note-label").textContent = product.noteLabel;
  $<HTMLInputElement>("context-note").placeholder = product.notePlaceholder;
  $("product-trust").textContent = product.trust;
  $("workflow-hint").textContent = product.workflowHint;
  $<HTMLSelectElement>("context-classification").value = product.defaultClassification;
  void renderIdentityTrust();
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-product]"))) {
    button.classList.toggle("active", button.dataset.product === profile);
    button.setAttribute("aria-pressed", String(button.dataset.product === profile));
  }
  const url = new URL(location.href);
  url.searchParams.set("product", profile);
  history.replaceState(null, "", url);
}

async function renderIdentityTrust(): Promise<void> {
  const target = $("identity-trust");
  try {
    const identity = await browserEd25519Identity(
      await identityPromise,
      identityPersistent ? "persistent" : "session",
    );
    const verdict = evaluateKeyPolicy(identity, LAB_PILOT_KEY_POLICY);
    target.classList.toggle("bad", !verdict.ok);
    const scope = "Lab pilot policy met · Enterprise requires hardware identity";
    target.textContent = verdict.ok
      ? `Identity: Web Crypto · software-protected · ${identity.persistence === "persistent" ? "persistent" : "this tab only"} · ${scope}`
      : `Identity policy not met: ${verdict.reasons.join("; ")}`;
    target.title = "The browser key is non-exportable, but it is not Secure Enclave/StrongBox/TPM evidence.";
  } catch (error) {
    target.classList.add("bad");
    target.textContent = `Device identity could not be checked: ${(error as Error).message}`;
  }
}

function productContext(): DispatchContext {
  const reference = $<HTMLInputElement>("context-reference").value.trim();
  const note = $<HTMLInputElement>("context-note").value.trim();
  const operator = $<HTMLInputElement>("context-operator").value.trim();
  if (isBusiness() && PRODUCTS[activeProduct].referenceRequired && !reference) throw new Error(`${PRODUCTS[activeProduct].referenceLabel} is required`);
  return {
    profile: activeProduct,
    ...(reference ? { reference } : {}),
    classification: $<HTMLSelectElement>("context-classification").value as DispatchContext["classification"],
    ...(note ? { note } : {}),
    ...(operator ? { operator } : {}),
  };
}

/**
 * Bağlam sevk kaydına imzayla girer, sonradan eklenemez. Eksikse aktarım
 * başlamadan ve alanın kendisi gösterilerek söylenir.
 */
function requireContext(): DispatchContext | undefined {
  const field = $<HTMLInputElement>("context-reference");
  try {
    const context = productContext();
    const violation = sitePolicy && checkContext(sitePolicy, context);
    if (violation) {
      const wrong = sitePolicy!.requireOperator && !context.operator && !/work order|classification/.test(violation) ? $("context-operator") : field;
      wrong.setAttribute("aria-invalid", "true");
      wrong.focus();
      $("send-stats").textContent = `Not sent: ${violation}.`;
      notify($("send-stats").textContent!, "bad");
      return undefined;
    }
    field.removeAttribute("aria-invalid");
    return context;
  } catch {
    field.setAttribute("aria-invalid", "true");
    field.focus();
    $("send-stats").textContent =
      `Enter the ${PRODUCTS[activeProduct].referenceLabel.toLowerCase()} first. ` +
      "It is signed into the dispatch record, so it cannot be added afterwards.";
    notify($("send-stats").textContent!, "bad");
    return undefined;
  }
}
for (const id of ["context-reference", "context-operator"]) {
  $<HTMLInputElement>(id).addEventListener("input", (event) => (event.target as HTMLElement).removeAttribute("aria-invalid"));
}

/** Dosya düğmesi yüklenen şeyi söyler; aynı dosyayı tekrar tekrar yüklemenin sebebi buydu. */
function markFileButton(inputId: string, loaded: string | undefined, idle: string): void {
  const label = $(inputId).parentElement!;
  label.classList.toggle("loaded", Boolean(loaded));
  label.querySelector("span")!.textContent = loaded ?? idle;
}

// ---- kalıcı depolama -----------------------------------------------------------
// Lisans, alıcı kartı ve cihaz anahtarı tarayıcıda durur. Tarayıcı yer açarken
// "en iyi çaba" verisini silebilir; kalıcı depolama istemek bunu önler. Kullanıcı
// tarayıcı verisini kendisi silerse yine gider — bu yüzden lisans dosyası saklanmalı.
void navigator.storage?.persist?.().catch(() => undefined);

// ---- çevrimdışı çalışma -----------------------------------------------------
/**
 * Uygulama ilk ziyaretten sonra cihazda kalır; sonraki açılışlarda ağ gerekmez.
 * "Aktarım sırasında ağ yok" demek yetmiyordu: sayfanın kendisi de internetten
 * geliyordu ve izole bir iş istasyonunda bu haklı bir itirazdı.
 */
/**
 * Çevrimdışı paket: tek HTML dosyası, internete hiç çıkmayan PC'ye kopyalanır.
 * Sürümü sabittir ve kendini güncellemez — doğrulanmış sistem bunu ister.
 * Web sürümünde boş dizedir.
 */
declare const __KIONEL_OFFLINE__: string;
declare const __KIONEL_BUILD__: string;
$("build-id").textContent = __KIONEL_OFFLINE__
  ? `Kionel offline package ${__KIONEL_OFFLINE__} · build ${__KIONEL_BUILD__}`
  : `Kionel web · build ${__KIONEL_BUILD__}`;
const SITE = __KIONEL_OFFLINE__ ? "https://kionel.com" : location.origin;
if (__KIONEL_OFFLINE__) {
  // Renkli kod işçileri pakette gömülü kopyalardan başlar; web sürümü bu modülü hiç yüklemez.
  void import("./colour-offline.ts");
  $("offline-state").textContent = `Offline package ${__KIONEL_OFFLINE__}: runs from this file, without a network. ` +
    "It never updates itself; a new version is a new file.";
  $("offline-state").hidden = false;
} else if ("serviceWorker" in navigator) {
  void navigator.serviceWorker.register("/sw.js").then(() => {
    const target = $("offline-state");
    if (!target) return;
    target.textContent = navigator.serviceWorker.controller
      ? "Offline ready: this page now runs without a network."
      : "Saved for offline use. Reload once to finish.";
    target.hidden = false;
  }).catch(() => { /* desteklenmiyorsa uygulama yine çalışır */ });
}

// ---- lisans -----------------------------------------------------------------
/**
 * Kendi dosyasını aktarmak lisans ister; lisanssız cihaz yalnız örnek dosyayla
 * demo yapar. Doğrulama yereldir: açık anahtar derlemeye gömülür (vite.config.ts),
 * lisans dosyası bu tarayıcıda saklanır, hiçbir sunucuya sorulmaz.
 *
 * ponytail: kapı gönderende. Alıcı tarafı kapatmak, lisanslı gönderenin
 * lisanssız alıcıya teslimini bozardı; cihaz sayısı sözleşme konusudur.
 */
declare const __KIONEL_LICENSE_AUTHORITY__: string;
const LICENSE_KEY = "kionel.license.v1";
const CLOCK_KEY = "kionel.clock.v1";
/** Kionel is open source (AGPL-3.0): every feature is enabled. The licence code below stays for
 *  commercial licensees who embed Kionel in a closed product; it never gates the open edition. */
const OPEN_EDITION = true;
let access: Entitlement = OPEN_EDITION ? "licensed" : "demo";
const licenseReady = refreshLicense().then(() => renderLicenseButton(false));

function renderLicenseButton(userAction: boolean): void {
  markFileButton("license-file", access === "demo" ? undefined : "✓ Licence loaded — load a different file", "Load licence file");
  let stored = false;
  try { stored = Boolean(localStorage.getItem(LICENSE_KEY)); } catch { /* depolama yok */ }
  $("licence-forget").hidden = !stored;
  const status = $("license-status");
  const kind: NoticeKind = status.dataset.state === "ok" ? "ok" : status.dataset.state === "warn" ? "warn" : "bad";
  const keep = kind === "ok" && userAction
    ? "\nKeep the licence file: you load it again after clearing browser data or on another browser or computer."
    : "";
  if (userAction || kind === "warn") notify(`${status.textContent ?? ""}${keep}`, kind);
}

async function refreshLicense(): Promise<void> {
  const target = $("license-status");
  if (OPEN_EDITION) {
    access = "licensed";
    target.dataset.state = "ok";
    target.textContent = "Open source edition (AGPL-3.0): every feature is enabled, no licence file needed.";
    return;
  }
  let raw: string | null = null;
  try { raw = localStorage.getItem(LICENSE_KEY); } catch { /* depolama kapalıysa demo */ }
  if (!raw || !__KIONEL_LICENSE_AUTHORITY__) {
    access = "demo";
    target.dataset.state = "free";
    target.textContent = "Personal edition (free): send your own files up to 5 MB, read live. " +
      "Load a business licence for signed records, reports, screen recordings and larger files.";
    return;
  }
  try {
    // Saat geri alınırsa lisans, görülen en ileri zamana göre kontrol edilir.
    const clock = monotonicNow(readClock());
    writeClock(clock.next);
    const state = await verifyLicense(JSON.parse(raw), unb64(__KIONEL_LICENSE_AUTHORITY__), clock.now);
    if (state.state !== "invalid" && state.license.scope.productLines.every(line => line === "import-automation")) {
      access = "demo";
      target.dataset.state = "stopped";
      target.textContent = "This licence covers Import Automation. Load a Lab licence for file-transfer business features. Your existing files and records remain available.";
      target.classList.add("bad");
      return;
    }
    access = entitlement(state);
    target.textContent = clock.rolledBack ? `${licenseNotice(state)} ${CLOCK_WARNING}` : licenseNotice(state);
    // Süre azaldığında ve bittiğinde satır rengini değiştirir: metni okumayan da
    // durumu görür. Windows'un lisans uyarısıyla aynı fikir, aynı sertlikte değil.
    target.dataset.state = licenseSeverity(state);
  } catch {
    access = "demo";
    target.dataset.state = "stopped";
    target.textContent = `The licence file could not be read — it may be damaged or not a licence file. You are using the free personal edition. ${RECORDS_STAY_VALID}`;
  }
  target.classList.toggle("bad", access !== "licensed");
}

function readClock(): ClockState | undefined {
  try {
    const raw = localStorage.getItem(CLOCK_KEY);
    return raw ? (JSON.parse(raw) as ClockState) : undefined;
  } catch { return undefined; }
}

function writeClock(state: ClockState): void {
  try { localStorage.setItem(CLOCK_KEY, JSON.stringify(state)); } catch { /* depolama kapalı */ }
}

/** Yüklenen her şey kaldırılabilir olmalı: ortak bir bilgisayarda lisansı bırakmamak için. */
$("licence-forget").onclick = async () => {
  if (!confirm("Remove the licence from this browser? Business features stop here until you load kionel-license.json " +
    "again. Records already made stay valid.")) return;
  try { localStorage.removeItem(LICENSE_KEY); } catch { /* depolama yok */ }
  $<HTMLInputElement>("license-file").value = "";
  hideLicenceCode();
  await refreshLicense();
  renderLicenseButton(false);
  notify("Licence removed from this browser. It now runs as the free personal edition; load the licence file to bring " +
    "business features back.", "ok");
};

$<HTMLInputElement>("license-file").onchange = async (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await installLicence(await file.text());
};

/**
 * Lisans üç yoldan yüklenir: dosya, yapıştırılan metin, başka cihazın gösterdiği
 * kod. Telefona dosya indirmek çoğu zaman zahmetli; lisans ~570 bayt olduğu
 * için tek bir koda sığar. Hepsi aynı doğrulamadan geçer: imza tutmazsa yüklenmez.
 */
async function installLicence(raw: string): Promise<boolean> {
  let previous: string | null = null;
  try { previous = localStorage.getItem(LICENSE_KEY); } catch { /* depolama yok */ }
  try { localStorage.setItem(LICENSE_KEY, raw.trim()); } catch { /* aşağıda kişisel sürüm gösterilir */ }
  await refreshLicense();
  if (access === "demo" && previous) {
    // Geçersiz bir metin, çalışan lisansın yerine geçmesin.
    try { localStorage.setItem(LICENSE_KEY, previous); } catch { /* yok */ }
    await refreshLicense();
    notify("That is not a valid Kionel licence. The licence already loaded here was kept.", "bad");
    return false;
  }
  renderLicenseButton(true);
  return access !== "demo";
}

function hideLicenceCode(): void {
  window.clearTimeout(licenceCodeTimer);
  $("licence-qr").hidden = true;
  $("licence-show").textContent = "Show licence as a code";
}

$("licence-show").onclick = () => {
  if (!$("licence-qr").hidden) {
    hideLicenceCode();
    notify("Licence code hidden.", "ok");
    return;
  }
  let raw: string | null = null;
  try { raw = localStorage.getItem(LICENSE_KEY); } catch { /* yok */ }
  if (!raw || access === "demo") {
    notify("No valid licence is loaded on this device. Load the licence file here first.", "bad");
    return;
  }
  // Kod metin olarak (bayt modu) çizilir; boşluksuz JSON tek koda sığar.
  const compact = new TextEncoder().encode(JSON.stringify(JSON.parse(raw)));
  const canvas = $<HTMLCanvasElement>("licence-qr");
  drawFrame(canvas, compact, { version: 27 });
  canvas.hidden = false;
  // Kodu fotoğraflayan lisansı alır: ekranda en fazla bir dakika kalır.
  window.clearTimeout(licenceCodeTimer);
  licenceCodeTimer = window.setTimeout(hideLicenceCode, LICENCE_CODE_MS);
  $("licence-show").textContent = "Hide the licence code";
  notify("On the other device open Receive with the live camera and point it at this code. It hides after one minute: " +
    "anyone who photographs it gets your licence. Your licence covers the number of devices written on it.", "warn");
};
let licenceCodeTimer = 0;
const LICENCE_CODE_MS = 60_000;

$("licence-paste-load").onclick = async () => {
  const text = $<HTMLTextAreaElement>("licence-paste").value;
  if (!text.trim()) {
    notify("Paste the licence text first.", "bad");
    return;
  }
  if (await installLicence(text)) $<HTMLTextAreaElement>("licence-paste").value = "";
};

/** Alıcı kamerası bir lisans kodu okursa lisansı yükler; tarama sürer. */
let lastLicenceCode = "";
async function acceptLicenceCode(bytes: Uint8Array): Promise<boolean> {
  if (bytes[0] !== 0x7b) return false;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return false; }
  if (!text.includes('"kionel-license/') || text === lastLicenceCode) return text === lastLicenceCode;
  lastLicenceCode = text;
  // Kameraya gösterilen her lisans kodu sorulur: aksi hâlde biri kameraya başka bir
  // kurumun lisansını tutarak bu cihazın lisansını sessizce değiştirebilirdi.
  let who = "an unknown organisation";
  let until = "";
  try {
    const offered = JSON.parse(text) as { licensee?: string; validUntil?: string };
    who = offered.licensee ?? who;
    until = offered.validUntil ? `, valid until ${offered.validUntil.slice(0, 10)}` : "";
  } catch { /* imza kontrolü zaten reddeder */ }
  const replacing = access !== "demo" ? " It replaces the licence loaded on this device now." : "";
  if (!confirm(`Load the Kionel licence of ${who}${until} on this device?${replacing}`)) {
    notify("Licence code ignored. Nothing was changed.", "warn");
    return true;
  }
  await installLicence(text);
  return true;
}

// ---- fiziksel qualification kayıt modu -------------------------------------
interface QualificationAggregate {
  sender: string; receiver: string; browser: string; transport: string;
  attempts: number; successes: number; silentCorruptions: number;
  goodputTotal: number; startedAt: string; endedAt: string;
}
const QUALIFICATION_KEY = "kionel.qualification.runs.v1";
const qualificationEnabled = new URLSearchParams(location.search).get("qualification") === "1";
const qualificationPanel = $<HTMLDetailsElement>("qualification-panel");
let qualificationRuns = loadQualificationRuns();
let qualificationAttemptKey: string | undefined;
qualificationPanel.hidden = !qualificationEnabled;
if (qualificationEnabled) {
  $<HTMLInputElement>("qualification-sender").value = localStorage.getItem("kionel.qualification.sender") ?? "";
  $<HTMLInputElement>("qualification-receiver").value = localStorage.getItem("kionel.qualification.receiver") ?? "";
  $("qualification-fail").onclick = () => closeQualificationAttempt(false);
  $("qualification-next").onclick = () => location.reload();
  $("qualification-export").onclick = () => void exportQualificationMatrix();
  $("qualification-payload").onclick = () => void loadMatrixPayload();
  $("qualification-run").onclick = () => void runMatrixSequence(MATRIX_GATE.minAttemptsPerPair);
  renderQualificationStats();
}

/**
 * Matris yükü iki tarafta da aynı türetilir; alıcı beklediğini yeniden
 * hesaplayıp bayt bayt karşılaştırabildiği için SESSİZ BOZULMA gerçekten
 * görülebilir. Rastgele kullanıcı dosyasıyla bu kapı ölçülemez: alıcının
 * karşılaştıracağı bir referansı olmaz.
 *
 * runId sabit 0'dır — yük gizli değil, yalnız iki tarafın anlaşması gerekir.
 * Deneme indeksi mühürlü zarfın içindeki dosya adında taşınır, yani AES-GCM
 * ve CRC ile korunur; kayan indeks yüzünden yanlış "bozulma" raporlanamaz.
 */
const MATRIX_RUN_ID = 0;
const MATRIX_PAYLOAD_BYTES = 4096;
const MATRIX_INDEX_KEY = "kionel.qualification.matrix.index";
/** 4 KB yük ~3 blok; ARQ tamamlanmazsa bu bütçe denemeyi kapatır. */
const MATRIX_FRAME_BUDGET = 60;
/** Uçuştaki karelerin boşalması için denemeler arası boşluk. */
const MATRIX_GAP_MS = 700;
let matrixRunning = false;

async function loadMatrixPayload(): Promise<void> {
  const index = Number(localStorage.getItem(MATRIX_INDEX_KEY) ?? "0") || 0;
  localStorage.setItem(MATRIX_INDEX_KEY, String(index + 1));
  const data = await attemptPayload(MATRIX_RUN_ID, index, MATRIX_PAYLOAD_BYTES);
  // Dosya girdisine enjekte edilir; gönderme yolu aynen çalışır, kopyalanmaz.
  const transfer = new DataTransfer();
  transfer.items.add(new File([data as BlobPart], `kionel-matrix-${index}.bin`, { type: "application/octet-stream" }));
  const input = $<HTMLInputElement>("file");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change"));
}

/** Bütünlük kontrollerinin tamamı geçtiği hâlde içerik farklıysa: sessiz bozulma. */
async function matrixContentMismatch(name: string, data: Uint8Array): Promise<boolean> {
  const index = matrixAttemptIndex(name);
  if (index === undefined) return false;
  const expected = await attemptPayload(MATRIX_RUN_ID, index, MATRIX_PAYLOAD_BYTES);
  return !sameBytes(expected, data);
}

function noteSilentCorruption(): void {
  if (!qualificationAttemptKey) return;
  qualificationRuns[qualificationAttemptKey].silentCorruptions++;
  saveQualificationRuns();
}

function beginQualificationAttempt(): void {
  if (!qualificationEnabled || qualificationAttemptKey) return;
  const sender = $<HTMLInputElement>("qualification-sender").value.trim();
  const receiver = $<HTMLInputElement>("qualification-receiver").value.trim();
  if (!sender || !receiver || sender === receiver) {
    $("qualification-stats").textContent = "Measurement not recorded: sender and receiver need different device labels.";
    return;
  }
  localStorage.setItem("kionel.qualification.sender", sender);
  localStorage.setItem("kionel.qualification.receiver", receiver);
  const key = `${sender}\u0000${receiver}`;
  const now = new Date().toISOString();
  const run = qualificationRuns[key] ?? {
    sender, receiver, browser: navigator.userAgent.slice(0, 120), transport: "qr-v1",
    attempts: 0, successes: 0, silentCorruptions: 0, goodputTotal: 0, startedAt: now, endedAt: now,
  };
  run.attempts++;
  run.endedAt = now;
  qualificationRuns[key] = run;
  qualificationAttemptKey = key;
  saveQualificationRuns();
  renderQualificationStats();
}

function closeQualificationAttempt(success: boolean, goodputKBs = 0): void {
  if (!qualificationAttemptKey) {
    if (qualificationEnabled) $("qualification-stats").textContent += "\nNo attempt is open.";
    return;
  }
  const run = qualificationRuns[qualificationAttemptKey];
  if (success) {
    run.successes++;
    run.goodputTotal += goodputKBs;
  }
  run.endedAt = new Date().toISOString();
  qualificationAttemptKey = undefined;
  saveQualificationRuns();
  renderQualificationStats();
}

async function exportQualificationMatrix(): Promise<void> {
  const runs: QualificationEvidence[] = [];
  const identity = await identityPromise;
  for (const run of Object.values(qualificationRuns)) {
    if (!run.attempts) continue;
    runs.push(await issueQualificationEvidence(identity, {
      sender: run.sender, receiver: run.receiver, browser: run.browser, transport: run.transport,
      attempts: run.attempts, successes: run.successes, silentCorruptions: run.silentCorruptions,
      meanGoodputKBs: run.successes ? run.goodputTotal / run.successes : 0,
      startedAt: run.startedAt, endedAt: run.endedAt,
    }));
  }
  const document = new TextEncoder().encode(JSON.stringify({ schema: "kionel-device-matrix/v1", runs }, null, 2));
  const result = $("qualification-result");
  result.replaceChildren();
  addDownload(result, document, "kionel-device-matrix.json", `Signed matrix · ${runs.length} device pairs`);
}

function renderQualificationStats(): void {
  const runs = Object.values(qualificationRuns);
  const attempts = runs.reduce((sum, run) => sum + run.attempts, 0);
  const successes = runs.reduce((sum, run) => sum + run.successes, 0);
  $("qualification-stats").textContent =
    `${runs.length} directed pairs · ${attempts} attempts · ${successes} succeeded · ${attempts - successes} failed` +
    `${qualificationAttemptKey ? "\nA transfer attempt is open." : ""}`;
}

function loadQualificationRuns(): Record<string, QualificationAggregate> {
  try {
    const value = JSON.parse(localStorage.getItem(QUALIFICATION_KEY) ?? "{}") as Record<string, QualificationAggregate>;
    return value && typeof value === "object" ? value : {};
  } catch { return {} }
}
function saveQualificationRuns(): void { localStorage.setItem(QUALIFICATION_KEY, JSON.stringify(qualificationRuns)) }

// ---- sekmeler ---------------------------------------------------------------
const panels = { send: $("send"), recv: $("recv") };
let receiverStarted = false;
for (const name of ["send", "recv"] as const) {
  $(`tab-${name}`).onclick = () => {
    panels.send.hidden = name !== "send";
    panels.recv.hidden = name !== "recv";
    $("tab-send").classList.toggle("active", name === "send");
    $("tab-recv").classList.toggle("active", name === "recv");
    if (name === "recv" && !receiverStarted) void startReceiver();
    // Görünmeyen sekmede kamera açık kalmasın; dönünce düğmeyle açılır.
    if (name === "send" && stopReceiverScan && !receiverPaused) setReceiverPaused(true);
  };
}

// ---- GÖNDER -----------------------------------------------------------------
const sendCanvas = $<HTMLCanvasElement>("qr");
const sendVideo = $<HTMLVideoElement>("send-video");
let selected: { name: string; data: Bytes } | undefined;
let senderSession: Session | undefined;
let senderNegotiated: NegotiatedCapabilities | undefined;
let secureWire: Uint8Array | undefined;
let stopSenderScan: (() => void) | undefined;
let stopAnimation: (() => void) | undefined;

/** Ekrandaki QR sürümü ve kare hızı — tahmin bunlardan hesaplanır, sabitten değil. */
function transferSettings(): { version: number; hold: number; tiles: number } {
  return {
    version: Number($<HTMLSelectElement>("version").value) || 27,
    hold: Number($<HTMLSelectElement>("hold").value) || 2,
    tiles: Number($<HTMLSelectElement>("tiles").value) || 1,
  };
}

/**
 * Seçilen dosyayı ve süresini birlikte gösterir.
 *
 * Süreyi aktarım başlamadan söylemek, kullanıcının hâlâ vazgeçebileceği tek an.
 * Sonrasında söylemek bilgi değil, mazerettir.
 */
/** Sıkıştırılmış boyut: süreyi belirleyen ekrana çıkacak bayt sayısıdır, dosyanınki değil. */
let selectedWireSize = 0;
/** Bu süreyi aşan aktarımda kullanıcı baştan uyarılır. */
const LONG_TRANSFER_SECONDS = 90;

/** Göndericinin okuma biçimi seçimi: canlı QR, kayıt için yoğun QR, renkli kod. */
let sendPreset: "live" | "record" | "colour" = "live";

function renderRecordPlan(): void {
  const plan = $("record-plan");
  plan.hidden = !(sendPreset !== "live" && selected);
  if (!plan.hidden) {
    const seconds = sendPreset === "colour" ? colourSeconds(selectedWireSize) : recordingSeconds(selectedWireSize);
    plan.textContent = `Receiver: film this screen for at least ${seconds} seconds at 1080p, keeping the whole code in the picture.`;
  }
}

function showSelectedFile(name: string, size: number, wireSize = size, notice = true): void {
  const estimate = estimateTransfer(wireSize, { ...transferSettings(), decodeMs: LIVE_DECODE_MS });
  const lines = [
    wireSize < size * 0.9
      ? `${name} · ${formatBytes(size)} → ${formatBytes(wireSize)} after compression`
      : `${name} · ${formatBytes(size)} (already compressed; sent as is)`,
    `Estimated time ${estimate.label} · ${estimate.frames} images · ~${formatBytes(estimate.bytesPerSecond)}/s`,
    "Not a device measurement: assumes the receiving phone decodes about 7 codes a second and misses a quarter of them.",
    "With multiple codes every code must be read; more codes do not guarantee a faster transfer.",
  ];
  // Uzun aktarımda asıl zorluk dosya boyutu değil, kamerayı o kadar süre ekranda
  // tutmak. Bunu baştan söylemek ve bölünebileceğini belirtmek, kullanıcıyı
  // yarıda bırakılmış bir aktarımla baş başa bırakmaktan iyidir.
  if (estimate.needsResume) {
    lines.push(
      "Long transfer: keep the camera on the screen for this whole time.",
      "You can pause — the receiver keeps its progress and resumes where it stopped.",
    );
  }
  lines.push("Next: scan the receiver's offer QR — or, if this PC has no camera, type the receiver's code below.");
  $("send-stats").textContent = lines.join("\n");
  renderRecordPlan();
  if (notice && estimate.seconds > LONG_TRANSFER_SECONDS && sendPreset === "live") {
    notify(
      `This file needs ${estimate.label} of steady camera time. Optical transfer suits files up to about 1 MB. ` +
      "To speed it up: set Screen to \"monitor — 4 codes\", and QR version 40 with the receiving camera held close to the screen.",
      "warn",
    );
  }
}

// Ayar değişince tahmin de değişmeli, yoksa ekrandaki sayı yalan olur.
for (const id of ["version", "hold", "tiles"]) {
  $<HTMLSelectElement>(id).addEventListener("change", () => {
    if (selected) showSelectedFile(selected.name, selected.data.length, selectedWireSize);
  });
}

$<HTMLInputElement>("file").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (!files.length) return;
  await licenseReady;
  // Site politikası her dosyaya ayrı uygulanır; biri uymazsa hiçbiri seçilmez.
  const violation = sitePolicy && files.map((file) => checkFile(sitePolicy!, file.name, file.size)).find(Boolean);
  if (violation) {
    $("send-stats").textContent = `Not selected: ${violation}.`;
    notify($("send-stats").textContent!, "bad");
    input.value = "";
    return;
  }
  // Birden çok dosya tek ZIP olarak gider; sınırlar toplam boyuta uygulanır.
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const what = files.length > 1 ? `These ${files.length} files are` : `${files[0].name} is`;
  if (!isBusiness() && total > FREE_MAX_BYTES) {
    $("send-stats").textContent =
      `${what} ${formatBytes(total)}. The free personal edition sends up to 5 MB; ` +
      "a business licence raises the limit to 64 MB.";
    notify($("send-stats").textContent!, "warn");
    input.value = "";
    return;
  }
  if (total > MAX_WEB_TRANSFER_BYTES) {
    $("send-stats").textContent =
      `${what} over the protocol limit: ${formatBytes(total)} > ${formatBytes(MAX_WEB_TRANSFER_BYTES)}.`;
    notify($("send-stats").textContent!, "bad");
    input.value = "";
    return;
  }
  if (files.length === 1) {
    await selectPayload(files[0].name, new Uint8Array(await files[0].arrayBuffer()));
    return;
  }
  const zip = await bundleFiles(await Promise.all(files.map(async (file) => ({
    name: file.name, data: new Uint8Array(await file.arrayBuffer()), modified: new Date(file.lastModified),
  }))));
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const name = `kionel-${files.length}-files-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.zip`;
  await selectPayload(name, zip as Bytes);
  notify(`${files.length} files packed into ${name}, with MANIFEST-SHA256.txt listing each file's SHA-256. ` +
    "They travel and are signed as one file.", "ok");
};

/**
 * "Diğer cihazı aç" karesi.
 *
 * Laboratuvarda ikinci cihaz çoğu zaman bir telefon ve oraya adresi elle yazmak
 * ilk denemenin en büyük sürtünmesi. Sayfanın adresini QR olarak göstermek
 * kamerayla tek dokunuşa indiriyor.
 */
$("pair-qr").onclick = () => {
  const canvas = $<HTMLCanvasElement>("pair-canvas");
  if (!canvas.hidden) {
    canvas.hidden = true;
    $("pair-note").hidden = true;
    $("pair-qr").textContent = "Show link for the other device";
    return;
  }
  const url = `${SITE}/transfer.html?product=${activeProduct}`;
  // Protokol kareleri ham BAYT modunda kodlanır; telefon kamerası onu adres
  // olarak tanımaz ve arama motoruna düşer. Bu kare insan içindir, protokol
  // için değil — kütüphanenin metin kodlaması kullanılıyor.
  void QRCode.toCanvas(canvas, url, { errorCorrectionLevel: "M", margin: 2, width: 380,
    color: { dark: "#071316", light: "#ffffff" } });
  canvas.hidden = false;
  $("pair-note").hidden = false;
  $("pair-qr").textContent = "Hide the link";
};

/** Seçimi geri almak: gönderim sürüyorsa durur, ekrandaki kodlar kalkar. */
$("file-clear").onclick = () => {
  const name = selected?.name ?? "The file";
  stopAnimation?.();
  stopSenderScan?.();
  selected = undefined;
  senderSession = undefined;
  secureWire = undefined;
  lastSend = undefined;
  selectedWireSize = 0;
  $<HTMLInputElement>("file").value = "";
  markFileButton("file", undefined, "Choose file");
  for (const id of ["send-hint", "send-sas", "send-confirm", "receipt-scan", "send-again", "file-clear"]) $(id).hidden = true;
  sendCanvas.hidden = true;
  sendVideo.hidden = true;
  $("dispatch-result").replaceChildren();
  $("seal-qr").hidden = true;
  $("send-stats").textContent = "Choose a file to begin.";
  renderRecordPlan();
  renderReceiverCard();
  notify(`${name} removed. Nothing more is shown on this screen.`, "ok");
};

$("demo-file").onclick = () => {
  // Örnek dosyada iş emri alanında takılmak demonun amacını boşa çıkarır.
  const reference = $<HTMLInputElement>("context-reference");
  if (!reference.value.trim()) reference.value = "DEMO-0001";
  void selectDemo();
};
const selectDemo = () => selectPayload("kionel-demo-numune.csv", new TextEncoder().encode(
  "numune_id,analit,sonuc,birim\nDEMO-001,Kursun,0.8,mg/kg\nDEMO-002,Kadmiyum,0.1,mg/kg\n",
));

/**
 * Alıcının teklifini cevaplar ve cevap QR'ını gösterir. Teklif kamerayla
 * okunmuş da olabilir, mikrofonla duyulmuş da: kayıt aynıdır, doğrulaması da.
 * Sesle gelen teklif ham kayıttır (yetenek bloğu taşımaz); böylece iki uç
 * kendiliğinden tek yönlü fountain'e düşer — kamerasız gönderen ACK okuyamaz.
 */
async function answerReceiverOffer(bytes: Uint8Array, bySound = false): Promise<void> {
  const control = decodeHandshakeControl(bytes);
  const offer = control?.kind === ControlKind.Offer ? control.record : bytes;
  const { reply, session } = await answerOffer(await identityPromise, owned(offer));
  senderSession = session;
  pairedBySound = bySound;
  senderNegotiated = negotiateCapabilities(LOCAL_CAPABILITIES, control?.capabilities);
  const replyWire = control
    ? encodeHandshakeControl({ kind: ControlKind.Reply, record: reply, capabilities: LOCAL_CAPABILITIES })
    : reply;
  drawFrame(sendCanvas, replyWire, { version: 10 });
  sendVideo.hidden = true;
  sendCanvas.hidden = false;
  $("send-hint").hidden = true;
  showSas($("send-sas"), session);
  $("send-confirm").hidden = false;
  $("send-stats").textContent = `${bySound ? "Paired by sound. " : ""}Show the reply QR to the receiver, then compare the codes.\nChannel: ${senderNegotiated.arq ? "duplex ARQ" : "simplex fountain"}${identityNotice()}`;
}

async function selectPayload(name: string, data: Bytes): Promise<void> {
  selected = { name, data };
  endSoundListen();
  endReceiptListen();
  $("receipt-listen").hidden = true;
  pairedBySound = false;
  sentDispatch = undefined;
  senderSession = undefined;
  secureWire = undefined;
  stopSenderScan?.();
  stopAnimation?.();
  sendCanvas.hidden = true;
  sendVideo.hidden = true;
  $("send-hint").hidden = false;
  $("send-sas").hidden = true;
  $("send-confirm").hidden = true;
  $("receipt-scan").hidden = true;
  $("dispatch-result").replaceChildren();
  lastSend = undefined;
  $("send-again").hidden = true;
  selectedWireSize = (await shrink(data)).length;
  showSelectedFile(name, data.length, selectedWireSize);
  markFileButton("file", `✓ ${name} · ${kb(data.length)} — choose another file`, "Choose file");
  $("file-clear").hidden = false;
  renderReceiverCard();

  try {
    stopSenderScan = await scanCamera(sendVideo, async (bytes) => {
      try {
        await answerReceiverOffer(bytes);
        return true;
      } catch {
        return false; // Kionel teklifi olmayan QR'ları sessizce atla
      }
    });
  } catch (error) {
    // Kamera araması geç biterse kullanıcı çoktan kodla göndermeye başlamış olabilir;
    // "kamera yok" uyarısı o zaman "Gönderiliyor" mesajının üstüne yazılmasın.
    if (!$("send-stop").hidden || !$("serial-stop").hidden) return;
    $("send-stats").textContent += "\n\n" + (installedCard
      ? `No camera on this device — that is fine. Press "Send to ${installedCard.label} without camera".`
      : `${cameraError(error)}\nThat is fine: on the receiving device press Receive → Show a code, ` +
        "type the code below and press Send with this code.");
    if (!installedCard) notify(`${cameraError(error)} That is fine: on the receiving device press Receive → Show a code, then type it below.`, "warn");
  }
}

// ---- kamerasız gönderim (alıcı kartı) ------------------------------------------
// Kart herkese açık bilgi taşır, gizli değil; tarayıcıda saklanması "bir kez
// kurulur" demek. Her okumada imzası yeniden doğrulanır.
const CARD_KEY = "kionel.receiver-card.v1";
let installedCard: ReceiverCard | undefined;

async function loadInstalledCard(): Promise<void> {
  try {
    const raw = localStorage.getItem(CARD_KEY);
    installedCard = raw ? (await verifyReceiverCard(JSON.parse(raw))) ?? undefined : undefined;
  } catch {
    installedCard = undefined;
  }
  renderReceiverCard();
}
void loadInstalledCard();

function renderReceiverCard(): void {
  markFileButton("card-file", installedCard ? `✓ Card: ${installedCard.label} — replace` : undefined, "Load receiver card");
  $("card-status").textContent = installedCard
    ? `Receiver card installed: ${installedCard.label}. Files from this device go to that receiver only.`
    : "No receiver card installed.";
  $("card-forget").hidden = !installedCard;
  if (installedCard) $<HTMLDetailsElement>("card-setup").open = true;
  $("oneway-send").hidden = !(installedCard && selected);
  if (installedCard) $("oneway-send").textContent = `Send to ${installedCard.label} without camera`;
}

$<HTMLInputElement>("card-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (needsBusiness("A receiver card")) return;
  let card: ReceiverCard | null = null;
  try {
    card = await verifyReceiverCard(JSON.parse(await file.text()));
  } catch { /* JSON değil: aşağıda aynı mesaj */ }
  if (!card) {
    $("card-status").textContent = "This is not a valid receiver card, or it was changed after it was created. Nothing was installed.";
    notify($("card-status").textContent!, "bad");
    return;
  }
  localStorage.setItem(CARD_KEY, JSON.stringify(card));
  installedCard = card;
  renderReceiverCard();
  notify(`Receiver card installed: ${card.label}. Choose a file, then press "Send to ${card.label} without camera".`, "ok");
};

$("card-forget").onclick = () => {
  localStorage.removeItem(CARD_KEY);
  installedCard = undefined;
  renderReceiverCard();
  notify("Receiver card removed. Load a new card, or use a code from the receiver.", "ok");
};

$("oneway-send").onclick = () => {
  const card = installedCard;
  if (card) void sendWithoutCamera((identity, file, context) => sealOneWay(identity, card, file, context));
};

$("code-send").onclick = () => {
  const code = normalizeTransferCode($<HTMLInputElement>("typed-code").value);
  if (!code) {
    $("send-stats").textContent = "The code has 12 characters, for example 7K3Q-M9XD-4PAB. Check it on the receiver's screen.";
    notify($("send-stats").textContent!, "bad");
    $("typed-code").focus();
    return;
  }
  void sendWithoutCamera((identity, file, context) => sealWithCode(identity, code, file, context));
};

// ---- sesle eşleşme: gönderen dinler ------------------------------------------------
/*
 * Kamerası olmayan ama mikrofonu olan gönderen, alıcının teklifini duyar.
 * Sesle gizli bir şey taşınmaz (bkz. sound-link.ts); aktarım kodu sesle
 * gönderilmez. Doğrulama kamera yolundakiyle aynıdır: iki ekrandaki kodlar
 * karşılaştırılır.
 */
let stopSoundListen: (() => void) | undefined;
let pairedBySound = false;

function endSoundListen(): void {
  stopSoundListen?.();
  stopSoundListen = undefined;
  $("sound-listen").hidden = false;
  $("sound-unlisten").hidden = true;
}

/** El sıkışma hataları çekirdekte Türkçe; arayüz İngilizce. */
function offerProblem(error: unknown): string {
  const message = (error as Error)?.message ?? "";
  if (message.includes("süresi dolmuş")) return "the offer is more than two minutes old, or the clocks of the two devices differ by more than two minutes. Press Pair by sound again on the receiver, and check the date and time on this PC";
  if (message.includes("imza")) return "its signature is not valid";
  return "it is not a Kionel pairing offer";
}

function microphoneError(error: unknown): string {
  switch ((error as Error)?.name) {
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found on this PC. Type the code shown on the receiver instead.";
    case "NotAllowedError":
      return "Microphone access was refused. Allow the microphone for this site (icon in the address bar), then press Listen again — or type the code shown on the receiver.";
    default:
      return `The microphone could not be used: ${(error as Error)?.message ?? error}. Type the code shown on the receiver instead.`;
  }
}

$("sound-listen").onclick = async () => {
  const status = $("sound-status");
  if (!selected) {
    notify("Choose a file first (step 2).", "bad");
    return;
  }
  status.hidden = false;
  status.textContent = "Asking for the microphone…";
  let heardSound = false;
  let holdMessageUntil = 0;
  try {
    stopSoundListen = await listenSound(
      (bytes) => void (async () => {
        try {
          await answerReceiverOffer(bytes, true);
          stopSenderScan?.();
          stopSenderScan = undefined;
          endSoundListen();
          status.textContent = "Heard the receiver. The microphone is off again.";
          notify("Paired by sound. Show the reply code on this screen to the receiver's camera, then compare the codes on both screens.", "ok");
        } catch (error) {
          holdMessageUntil = performance.now() + 8000;
          status.textContent = `A pairing sound was heard, but it was not accepted: ${offerProblem(error)}. Still listening.`;
          notify(status.textContent, "warn");
        }
      })(),
      (share, peak) => {
        if (peak > 0.02) heardSound = true;
        if (!stopSoundListen || performance.now() < holdMessageUntil) return;
        status.textContent = share > 0 && share < 1
          ? `Hearing the receiver: ${Math.round(share * 100)}%. Keep the devices still.`
          : heardSound
            ? "Listening. Sound reaches the microphone; waiting for the receiver's pairing sound."
            : "Listening. No sound yet: on the receiving device press \"Pair by sound\", turn the volume up and hold its speaker near this PC's microphone.";
      },
    );
    $("sound-listen").hidden = true;
    $("sound-unlisten").hidden = false;
    notify("Listening. On the receiving device press Receive → Sender has no camera → Pair by sound.", "ok");
  } catch (error) {
    status.textContent = microphoneError(error);
    notify(status.textContent, "bad");
  }
};

$("sound-unlisten").onclick = () => {
  endSoundListen();
  $("sound-status").textContent = "Stopped listening. The microphone is off.";
  notify("Stopped listening. The microphone is off.", "ok");
};

// ---- sesle teslim makbuzu: gönderen dinler -----------------------------------------
/** Bu oturumda gönderilen dosyanın sevk kaydı; sesle gelen makbuz onunla yeniden kurulur. */
let sentDispatch: Dispatch | undefined;
let stopReceiptListen: (() => void) | undefined;

function endReceiptListen(): void {
  stopReceiptListen?.();
  stopReceiptListen = undefined;
  $("receipt-unlisten").hidden = true;
}

$("receipt-listen").onclick = async () => {
  const status = $("receipt-listen-status");
  status.hidden = false;
  if (!senderSession || !sentDispatch) {
    status.textContent = "Nothing has been sent in this session yet.";
    notify(status.textContent, "bad");
    return;
  }
  const session = senderSession;
  const dispatch = sentDispatch;
  status.textContent = "Asking for the microphone…";
  let holdMessageUntil = 0;
  try {
    stopReceiptListen = await listenSound(
      (bytes) => void (async () => {
        const compact = unpackSoundReceipt(bytes);
        const problem = !compact
          ? "it is not a delivery receipt (perhaps the pairing sound is still playing)"
          : compact.session !== session.sessionId
          ? "it belongs to a different transfer"
          : await acceptReceipt({
            v: 1, session: compact.session, hash: dispatch.hash, bytes: dispatch.bytes, at: compact.at,
            sender: dispatch.sender, receiver: b64(session.peer), dispatch, sig: b64(compact.signature),
          }) ? "" : "its signature does not match the file this PC sent";
        if (problem) {
          holdMessageUntil = performance.now() + 8000;
          status.textContent = `A Kionel sound was heard, but ${problem}. Still listening.`;
          notify(status.textContent, "warn");
          return;
        }
        endReceiptListen();
        $("receipt-listen").hidden = true;
        status.textContent = "Receipt heard and verified. The microphone is off again.";
      })(),
      (share) => {
        if (!stopReceiptListen || performance.now() < holdMessageUntil) return;
        status.textContent = share > 0 && share < 1
          ? `Hearing a Kionel sound: ${Math.round(share * 100)}%. Keep the devices still.`
          : "Listening for the delivery receipt. On the receiving device press \"Play the delivery receipt as sound\" and hold its speaker near this PC's microphone.";
      },
    );
    $("receipt-listen").hidden = true;
    $("receipt-unlisten").hidden = false;
    notify("Listening for the delivery receipt. The receiving device plays it once the file has arrived.", "ok");
  } catch (error) {
    status.textContent = microphoneError(error).replace("Type the code shown on the receiver instead.", "The signed receipt is still on the receiving device and can be exported there.").replace(" — or type the code shown on the receiver.", ".");
    notify(status.textContent, "bad");
  }
};

$("receipt-unlisten").onclick = () => {
  endReceiptListen();
  $("receipt-listen").hidden = false;
  $("receipt-listen-status").textContent = "Stopped listening. The microphone is off.";
  notify("Stopped listening. The microphone is off.", "ok");
};

type OneWaySeal = (identity: Identity, file: { name: string; data: Bytes }, context: DispatchContext) =>
  Promise<{ wire: Bytes; dispatch: Dispatch }>;

// ---- ışığa duyarlılık uyarısı -----------------------------------------------
/**
 * Hareketli kodlar saniyede 20–60 kez değişir; WCAG 2.3.1'in üç yanıp sönme
 * sınırının çok üstünde. Işığa duyarlı epilepsisi olan birinde nöbet
 * tetikleyebilir. Gönderim başlamadan önce sorulur; onay tarayıcıda 30 gün
 * saklanır, sonra yeniden sorulur. Kalıcı not ayrıca ekranda durur.
 */
const FLASH_KEY = "kionel.flash-warning.v1";
const FLASH_VALID_MS = 30 * 24 * 60 * 60 * 1000;

async function flashingAccepted(): Promise<boolean> {
  try {
    const at = Number(localStorage.getItem(FLASH_KEY));
    if (at && Date.now() - at < FLASH_VALID_MS) return true;
  } catch { /* depolama yoksa her seferinde sorulur */ }
  const dialog = $<HTMLDialogElement>("flash-warning");
  if (typeof dialog.showModal !== "function") {
    return confirm("Sending shows rapidly flashing images that can trigger seizures in people with photosensitive epilepsy. Start?");
  }
  dialog.returnValue = "";
  dialog.showModal();
  await new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
  const accepted = dialog.returnValue === "accept";
  if (accepted) {
    try { localStorage.setItem(FLASH_KEY, String(Date.now())); } catch { /* yalnız bu kez */ }
  } else {
    notify("Transfer not started.", "warn");
  }
  return accepted;
}

// ---- tam ekran ---------------------------------------------------------------------
/**
 * Tam ekranda kod büyür, her modül daha çok piksel kaplar; telefon yoğun kodu
 * daha rahat okur. Canvas'ın piksel boyutu ekrana göre yeniden ayarlanır;
 * çizim tam sayı ölçekle yapıldığı için modül kenarları keskin kalır.
 */
function fitStageCanvas(): void {
  const full = document.fullscreenElement === $("send-stage");
  const side = full
    ? Math.floor(Math.min(window.innerWidth, window.innerHeight) * (window.devicePixelRatio || 1))
    : 900;
  sendCanvas.width = side;
  sendCanvas.height = side;
}
document.addEventListener("fullscreenchange", () => {
  fitStageCanvas();
  $("send-fullscreen").textContent = document.fullscreenElement ? "Exit full screen" : "Full screen — easier to read";
});
$("send-fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $("send-stage").requestFullscreen();
  } catch {
    notify("This browser does not allow full screen here. Enlarge the window instead.", "warn");
  }
};

async function sendWithoutCamera(seal: OneWaySeal): Promise<void> {
  if (!selected) {
    $("send-stats").textContent = "Choose a file first (step 2).";
    notify($("send-stats").textContent!, "bad");
    return;
  }
  const context = requireContext();
  if (!context) return;
  if (!(await flashingAccepted())) return;
  try {
    stopSenderScan?.();
    stopSenderScan = undefined;
    sendVideo.hidden = true;
    $("send-hint").hidden = true;
    $("dispatch-result").replaceChildren();
    senderSession = undefined;
    senderNegotiated = undefined; // tek yön: geri kanal yok, yalnız fountain
    const { wire, dispatch } = await seal(await identityPromise, selected, context);
    // Kare oturumu her gönderimde rastgele: alıcı reddettiği bir akışı
    // numarasından tanır ve yeniden gönderilen akışa karıştırmaz.
    startSending(wire, selected.name, undefined, globalThis.crypto.getRandomValues(new Uint32Array(1))[0]);
    offerDispatchRecord(dispatch);
    notify("Sending. Keep this screen visible and point the receiver's camera at it until the receiver shows the file.", "ok");
  } catch (error) {
    $("send-stats").textContent = `The transfer could not be prepared: ${(error as Error).message}`;
    notify($("send-stats").textContent!, "bad");
  }
};

/** Sevk kaydı işletmede indirilebilir; kişisel sürümde yalnız aktarımın içinde kalır. */
// ---- yalnız mühürleme ----------------------------------------------------------
/**
 * Dosya aktarılmaz; o anda, bu cihazın anahtarıyla dosyanın SHA-256'sı, boyutu,
 * zamanı ve iş emri imzalanır (sevk kaydıyla aynı biçim, doğrulayıcı aynı).
 * Kayıt birkaç yüz bayttır ve tek bir sabit kodla dışarı taşınır: hava boşluklu
 * bilgisayardan kanıt çıkar, veri çıkmaz.
 */
$("seal-only").onclick = async () => {
  if (needsBusiness("Sealing a file")) return;
  if (!selected) {
    notify("Choose the file to seal first.", "bad");
    return;
  }
  const context = requireContext();
  if (!context) return;
  try {
    const session = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
    const seal = await issueDispatch(await identityPromise, { session, content: owned(selected.data), context });
    void logTransfer("sealed", selected.name, seal);
    const wire = new TextEncoder().encode(JSON.stringify(seal));
    const canvas = $<HTMLCanvasElement>("seal-qr");
    drawFrame(canvas, wire, { version: 27 });
    canvas.hidden = false;
    $("dispatch-result").replaceChildren();
    addDownload($("dispatch-result"), new TextEncoder().encode(JSON.stringify(seal, null, 2)),
      `${safeBase(selected.name)}.seal.json`, "Download the sealed record", true);
    // Mühür kâğıda basılabilir: kod sonradan herhangi bir cihazın canlı kamerasıyla
    // okunur — kanıtı çıkarmak için o an ikinci bir cihaz gerekmez.
    const sealed = selected;
    const paper = Object.assign(document.createElement("button"), {
      type: "button", className: "report-button", textContent: "Print the seal on paper (with its code)",
    });
    paper.onclick = async () => printEvidence(
      await inspectEvidence(JSON.parse(JSON.stringify(seal)), owned(sealed.data), sealed.name),
      "Sealed record",
      { image: canvas.toDataURL("image/png"), caption: "Scan with Kionel — Receive → Live camera — to carry this proof into another system. The file itself is not in this code." },
    );
    const hide = Object.assign(document.createElement("button"), {
      type: "button", className: "secondary", textContent: "Hide the seal code",
    });
    hide.onclick = () => {
      canvas.hidden = true;
      hide.remove();
      notify("Seal code hidden. The downloaded record and the printed report stay valid.", "ok");
    };
    $("dispatch-result").append(paper, hide);
    // ponytail: mühür denetim zincirine yazılmıyor — zincir teslim makbuzu biçiminde; mühür
    // kendi imzasıyla doğrulanır. Zincire "sealed" olayı gerekirse ledger biçimine eklenir.
    notify(`${selected.name} sealed. The file stays here; scan the code with the receiving device to carry the proof out.`, "ok");
  } catch (error) {
    notify(`The file could not be sealed: ${(error as Error).message}`, "bad");
  }
};

/** Telefonda: mühür kodu okunursa kayıt gösterilir ve indirilebilir. */
async function acceptSeal(bytes: Uint8Array): Promise<boolean> {
  if (bytes[0] !== 0x7b) return false; // "{" — mühür JSON'u; el sıkışma ve veri kareleri ikilidir
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return false; }
  const report = await inspectEvidence(value);
  if (report.kind !== "dispatch") return false;
  const result = $("result");
  result.replaceChildren();
  const seal = value as Dispatch;
  if (seal.context) result.append(signedContextCard(seal.context));
  result.append(Object.assign(document.createElement("p"), {
    textContent: report.ok ? "Sealed record received and its signature verified. The file itself stayed on the sealing device." : report.headline,
    className: report.ok ? "ok" : "bad",
  }));
  addDownload(result, new TextEncoder().encode(JSON.stringify(seal, null, 2)), `sealed-${seal.session}.seal.json`, "Download the sealed record", true);
  const button = Object.assign(document.createElement("button"), { type: "button", textContent: "Print seal report / save as PDF", className: "report-button" });
  button.onclick = () => printEvidence(report);
  result.append(button);
  if (report.ok) offerCarriedFile(seal);
  notify(report.ok
    ? "Sealed record received. If the file came another way, add it below to sign the delivery receipt, or check it later at kionel.com/verify.html."
    : report.headline, report.ok ? "ok" : "bad");
  return true;
}

// ---- başka yoldan gelen dosya: mühür + dosya → teslim makbuzu ---------------------------
/**
 * Dosya USB bellekle, ağla ya da elden gelmiş olabilir; gönderen PC onu mühürlemiştir
 * (imzalı sevk kaydı). Alıcı kaydı yükler ya da kodunu okur, dosyayı ekler: dosya kayda
 * karşı doğrulanır ve teslim makbuzu, optik aktarımdakiyle aynı biçimde imzalanır.
 * Taşıyıcı değişir, kanıt değişmez.
 */
let carriedSeal: Dispatch | undefined;

function offerCarriedFile(seal: Dispatch): void {
  carriedSeal = seal;
  $("carried-file-row").hidden = false;
  $("carried-note").textContent = `Sealed record loaded: ${seal.bytes.toLocaleString("en")} bytes` +
    `${seal.context?.reference ? `, ${seal.context.reference}` : ""}, signed by sender ${senderShort(seal.sender)}. ` +
    "Now add the file that arrived (step 2): it is checked against this record before anything is signed.";
}

$<HTMLInputElement>("carried-seal").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (needsBusiness("Signing a receipt for a file that came another way")) return;
  let value: unknown;
  try { value = JSON.parse(await file.text()); } catch { value = undefined; }
  const report = await inspectEvidence(value);
  if (report.kind !== "dispatch" || !report.ok) {
    notify(`${file.name} is not a sealed record this device can verify${report.kind === "dispatch" ? `: ${report.headline}` : ""}. ` +
      "Use the .seal.json file downloaded on the sending PC.", "bad");
    return;
  }
  offerCarriedFile(value as Dispatch);
  notify("Sealed record loaded and its signature verified. Now add the file that arrived.", "ok");
};

$<HTMLInputElement>("carried-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  const seal = carriedSeal;
  if (!file || !seal) return;
  if (needsBusiness("Signing a receipt for a file that came another way")) return;
  const result = $("result");
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const checked = await verifyDispatch(seal, owned(data));
    if (!checked.ok) {
      const refused = `${file.name} is not the file that was sealed: ${explainReason(checked.reason)}. No receipt was signed.`;
      result.replaceChildren(Object.assign(document.createElement("p"), { textContent: refused, className: "bad" }));
      notify(refused, "bad");
      return;
    }
    await requireAcceptedSender(seal.sender);
    const earlier = alreadyReceived(await readLog(), seal);
    if (earlier) {
      const note = `${file.name} was already received on ${new Date(earlier.at).toLocaleString()} with the same sealed record. It was not signed again.`;
      result.replaceChildren(Object.assign(document.createElement("p"), { textContent: note, className: "hint-note" }));
      notify(note, "warn");
      return;
    }
    const receipt = await issueReceipt(await identityPromise, { session: seal.session, content: owned(data), sender: unb64(seal.sender), dispatch: seal });
    const verdict = await verifyReceipt(receipt, owned(data));
    if (!verdict.ok) throw new Error(`delivery evidence not verified: ${explainReason(verdict.reason)}`);
    const ledger = await appendAudit(receipt, "receipt-verified");
    // Dosya Kionel'in dışında taşındı: yolda şifreli olduğu söylenemez, yalnız kayıtla aynı olduğu.
    showDelivery(result, seal, { name: file.name, data }, receipt, ledger,
      "The file matches the sealed record and both signatures are verified. It travelled outside Kionel, so Kionel did not encrypt it on the way.");
    $("recv-stats").textContent = "File checked against the sealed record. Delivery receipt signed on this device.";
    carriedSeal = undefined;
    $("carried-file-row").hidden = true;
    $("carried-note").textContent = "Delivered. To receive another carried file, add its sealed record (step 1).";
  } catch (error) {
    const refused = (error as { senderKey?: string }).senderKey;
    const rejected = `Not delivered: ${(error as Error).message}.`;
    result.replaceChildren(Object.assign(document.createElement("p"), { textContent: rejected, className: "bad" }));
    if (refused) addPinButton(result, refused, "");
    notify(rejected, "bad");
  }
};

function offerDispatchRecord(dispatch: Dispatch): void {
  if (!selected) return;
  if (!isBusiness()) {
    businessNote($("dispatch-result"), BUSINESS_NOTE);
    return;
  }
  void logTransfer("sent", selected.name, dispatch);
  addDownload(
    $("dispatch-result"),
    new TextEncoder().encode(JSON.stringify(dispatch, null, 2)),
    `${safeBase(selected.name)}.sevk.json`,
    "Download the signed dispatch record",
    true,
  );
  addReportButton($("dispatch-result"), dispatch, selected, "Print dispatch report / save as PDF");
}

/**
 * Aynı oturum içinde bir yükü mühürleyip yayına verir. Matris koşusu da bunu
 * kullanır: yeni el sıkışma yapılmaz, dolayısıyla SAS bir kez ve elle
 * doğrulanır. Otomasyon SAS onayını ASLA kendi vermez.
 */
async function sealAndSend(payload: { name: string; data: Uint8Array }, done?: SendCompletion): Promise<Dispatch> {
  const identity = await identityPromise;
  const dispatch = await issueDispatch(identity, {
    session: senderSession!.sessionId,
    content: owned(payload.data),
    context: productContext(),
  });
  const sealed = await senderSession!.seal(owned(await shrink(pack(payload))));
  secureWire = packSecureEnvelope({ metadata: JSON.stringify(dispatch), sealed });
  startSending(secureWire, payload.name, done);
  return dispatch;
}

$("send-confirm").onclick = async () => {
  if (!selected || !senderSession) return;
  if (!requireContext()) return;
  if (!(await flashingAccepted())) return;
  try {
    $("send-confirm").hidden = true;
    $("send-sas").hidden = true;
    const dispatch = await sealAndSend(selected);
    sentDispatch = dispatch;
    offerDispatchRecord(dispatch);
    notify("Sending. Keep this screen visible until the receiver shows the file.", "ok");
    if (senderNegotiated?.arq) void startSenderFeedback();
    // Sesle eşleşen gönderenin kamerası yok: makbuz QR'ını okuyamaz, ama sesle duyabilir.
    else if (!pairedBySound) $("receipt-scan").hidden = false;
    else {
      $("receipt-listen").hidden = false;
      notify("Sending. Keep this screen visible until the receiver shows the file. Then press \"Listen for the delivery receipt\": a receiver with a business licence plays it as sound.", "ok");
    }
    if (qualificationEnabled) $("qualification-run").hidden = false;
  } catch (error) {
    $("send-stats").textContent = `The transfer could not be prepared: ${(error as Error).message}`;
    notify($("send-stats").textContent!, "bad");
  }
};

/**
 * Matris koşusu: tek oturumda arka arkaya deterministik yük yayınlar.
 * Denemeler arasında kısa bir boşluk bırakılır; uçuşta kalan kareler bir sonraki
 * denemenin decoder'ına karışırsa AES-GCM etiketini düşürür, yani en kötü ihtimalle
 * o deneme BAŞARISIZ sayılır — asla sessiz bozulma olarak raporlanmaz.
 */
async function runMatrixSequence(attempts: number): Promise<void> {
  if (!senderSession || matrixRunning) return;
  matrixRunning = true;
  $("qualification-run").hidden = true;
  try {
    for (let index = 0; index < attempts && matrixRunning; index++) {
      const data = await attemptPayload(MATRIX_RUN_ID, index, MATRIX_PAYLOAD_BYTES);
      await new Promise<void>((resolve) => {
        void sealAndSend({ name: matrixAttemptName(index), data }, { frameBudget: MATRIX_FRAME_BUDGET, onDone: resolve })
          .catch(() => resolve());
      });
      stopAnimation?.();
      $("qualification-stats").textContent = `Matrix run: ${index + 1}/${attempts} attempts broadcast.`;
      await new Promise((resolve) => setTimeout(resolve, MATRIX_GAP_MS));
    }
  } finally {
    matrixRunning = false;
    $("qualification-run").hidden = false;
  }
}

$("receipt-scan").onclick = async () => {
  if (!selected || !senderSession) return;
  stopAnimation?.();
  sendCanvas.hidden = true;
  sendVideo.hidden = false;
  $("receipt-scan").hidden = true;
  $("send-stats").textContent = "Scan the delivery receipt QR on the receiver's screen.";
  try {
    stopSenderScan = await scanCamera(sendVideo, async (bytes) => {
      return acceptSenderReceipt(bytes);
    });
  } catch (error) {
    $("send-stats").textContent = cameraError(error);
    $("receipt-scan").hidden = false;
    notify($("send-stats").textContent!, "bad");
  }
};

let applySenderAck: ((ack: AckMessage) => void) | undefined;

async function startSenderFeedback(): Promise<void> {
  sendVideo.hidden = false;
  try {
    stopSenderScan = await scanCamera(sendVideo, async (bytes) => {
      const frame = parseFrame(bytes);
      if (frame?.type === FrameType.Ack && frame.sessionId === senderSession?.sessionId) {
        const ack = decodeAck(frame.payload);
        if (ack) applySenderAck?.(ack);
        return false;
      }
      return acceptSenderReceipt(bytes);
    });
  } catch (error) {
    sendVideo.hidden = true;
    $("receipt-scan").hidden = false;
    $("send-stats").textContent += `\nThe return channel could not be opened; fountain fallback is active. ${cameraError(error)}`;
  }
}

async function acceptSenderReceipt(bytes: Uint8Array): Promise<boolean> {
  try {
    return await acceptReceipt(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Receipt);
  } catch {
    return false;
  }
}

/** Makbuzu doğrular ve teslimi kapatır; makbuz QR ile de gelmiş olabilir, sesle de. */
async function acceptReceipt(receipt: Receipt): Promise<boolean> {
  if (!selected || !senderSession) return false;
  try {
    const verdict = await verifyReceipt(receipt, selected.data);
    const ownKey = b64((await identityPromise).pub);
    if (!verdict.ok || receipt.session !== senderSession.sessionId || receipt.sender !== ownKey) return false;
    const ledger = isBusiness() ? await appendAudit(receipt, "receipt-verified") : undefined;
    stopAnimation?.();
    sendVideo.hidden = true;
    addDownload(
      $("dispatch-result"),
      new TextEncoder().encode(JSON.stringify(receipt, null, 2)),
      `${safeBase(selected.name)}.makbuz.json`,
      "Download the verified delivery receipt",
    );
    if (ledger) addDownload(
      $("dispatch-result"),
      new TextEncoder().encode(JSON.stringify(ledger, null, 2)),
      "kionel-audit-ledger.json",
      "Download the signed audit chain",
      true,
    );
    addReportButton($("dispatch-result"), receipt, selected, "Print transfer report / save as PDF");
    $("send-stats").textContent = "Delivery verified: the receiver signed that it received exactly this file.";
    notify($("send-stats").textContent, "ok");
    return true;
  } catch {
    return false;
  }
}

/**
 * İki hazır ayar, iki okuma biçimi için. Canlı okuyan kamera saniyede ~30 kareyi
 * ve orta yoğunlukta kodu rahat çözer; kayıt eden kamera 60 kareyi ve en yoğun
 * kodu kaldırır, çünkü çözme sonra, acele etmeden yapılır.
 */
function applyPreset(mode: "live" | "record" | "colour"): void {
  if (mode === "record" && needsBusiness("The fast recording mode")) return;
  if (mode === "colour" && needsBusiness("The colour code")) return;
  sendPreset = mode;
  if (mode !== "colour") {
    $<HTMLSelectElement>("version").value = mode === "record" ? "40" : "27";
    // Kayıtta saniyede 20 kod: telefon kameraları çoğunlukla 30 fps kaydeder; 60'ta
    // karelerin çoğu iki kodun karışımı olur.
    $<HTMLSelectElement>("hold").value = mode === "record" ? "3" : "2";
  }
  $("preset-live").setAttribute("aria-pressed", String(mode === "live"));
  $("preset-record").setAttribute("aria-pressed", String(mode === "record"));
  $("preset-colour").setAttribute("aria-pressed", String(mode === "colour"));
  renderFlowGuide($("send-flow"), mode, undefined);
  renderStory($("send-story"), { live: "code-live", record: "code-record", colour: "code-colour" }[mode]);
  renderRecordPlan();
  $<HTMLSelectElement>("version").dispatchEvent(new Event("change"));
  notify({
    live: "Set for a receiver that reads live: 30 images/s. Keep the receiving device's camera on this screen until the file arrives.",
    record: "Set for a receiver that records the screen: dense codes at 20 images/s. A device reading live cannot keep up with this — on the receiving device choose \"Record the screen\".",
    // "Neredeyse her kare okunur" yalnız temiz bir ekran kaydında doğru; telefon
    // kamerasıyla uzaktan çekilen kayıtta ölçülen oran %0–2 idi. Koşulu yazmak,
    // kullanıcının yöntemi deneyip boşuna kaybetmesinden iyidir.
    colour: "Set for the colour code: the most data in each image, but it needs a clean recording — press \"Full screen\" and let the code fill the picture. From a phone camera at arm's length it often reads nothing; a screen recording of the sending computer is what it is made for. If in doubt, \"Fast — recording\" is the safe choice.",
  }[mode], "ok");
}
// ---- nasıl alınır: uyumluluk ve animasyon ----------------------------------------
/**
 * Gönderme ve okuma yöntemlerinin hangi birleşimi çalışır. Kullanıcı renkli kodu
 * canlı kamerayla okuyamayacağını bilemez; seçtiği anda ekranda görmelidir.
 * best = önerilen, ok = çalışır, slow = deneysel ve yavaş, no = çalışmaz.
 */
type Fit = "best" | "ok" | "slow" | "no";
const FIT: Record<"live" | "record" | "colour", Record<"live" | "record" | "file", Fit>> = {
  live: { live: "best", record: "ok", file: "ok" },
  record: { live: "no", record: "best", file: "ok" },
  colour: { live: "slow", record: "best", file: "ok" },
};
const FIT_MARK: Record<Fit, string> = { best: "✓ recommended", ok: "✓ works", slow: "~ slow, experimental", no: "✗ does not work" };
const READ_NAMES = { live: "Live camera", record: "Record the screen now", file: "Open a recording" } as const;
const SEND_NAMES = { live: "Standard — live", record: "Fast — recording", colour: "Robust — colour code" } as const;
const WHY_NOT: Partial<Record<string, string>> = {
  "record/live": "20 dense codes a second are too much to read live; the receiving device must record.",
  "colour/live": "colour codes need clean frames; live reading works, but slowly — recording is better.",
};

function renderFlowGuide(target: HTMLElement, send: keyof typeof FIT, read: keyof typeof READ_NAMES | undefined): void {
  // Göndericide okuma biçimi seçilmez: seçilen yöntemin önerilen okuması gösterilir.
  const shown = read ?? (send === "live" ? "live" : "record");
  target.dataset.send = send;
  target.dataset.read = shown;
  target.querySelector<HTMLElement>(".fg-phone-label")!.textContent =
    shown === "live" ? "receiver reads live" : shown === "file" ? "receiver opens a video" : "receiver films";
  const list = target.querySelector(".fg-compat")!;
  const items: HTMLLIElement[] = [];
  if (read === undefined) {
    // Gönderici: telefonun üç alma yolu.
    for (const way of ["live", "record", "file"] as const) {
      const fit = FIT[send][way];
      const li = document.createElement("li");
      li.className = `fit-${fit}`;
      li.textContent = `${READ_NAMES[way]}: ${FIT_MARK[fit]}`;
      const why = WHY_NOT[`${send}/${way}`];
      if (why) li.title = why;
      if (why && fit !== "ok" && fit !== "best") li.textContent += ` — ${why}`;
      items.push(li);
    }
  } else {
    // Alıcı: göndericinin üç seçeneği, bu okuma yöntemiyle.
    for (const option of ["live", "record", "colour"] as const) {
      const fit = FIT[option][read];
      const li = document.createElement("li");
      li.className = `fit-${fit}`;
      li.textContent = `Sender "${SEND_NAMES[option]}": ${FIT_MARK[fit]}`;
      const why = WHY_NOT[`${option}/${read}`];
      if (why && fit !== "ok" && fit !== "best") li.textContent += ` — ${why}`;
      items.push(li);
    }
  }
  list.replaceChildren(...items);
}

$("preset-live").onclick = () => applyPreset("live");
$("preset-record").onclick = () => applyPreset("record");
$("preset-colour").onclick = () => applyPreset("colour");
renderFlowGuide($("send-flow"), "live", undefined);
renderStory($("send-story"), "code-live");
renderAllStories();

$("version").onchange = $("hold").onchange = () => {
  if (secureWire && selected) startSending(secureWire, selected.name);
};

interface SendCompletion {
  /** Simplex'te bitiş sinyali yoktur; kare bütçesi denemeyi sonlandırır. */
  frameBudget: number;
  onDone: () => void;
}

let colourSender: ColourSender | undefined;

/**
 * Kaydedecek kişi için geri sayım, kodun hemen üstünde: tahminle çekmek yerine
 * sayaç bitince durdurur. Süre, dosya boyutundan ve ölçülen verimden gelir.
 */
let countdownTimer = 0;
function startFilmCountdown(seconds: number): void {
  const line = $("film-countdown");
  window.clearInterval(countdownTimer);
  // Önce 3 saniye hazırlık: kaydedenin kamera uygulamasını açıp başlatmasına zaman kalır.
  let left = seconds + 3;
  const render = () => {
    line.textContent = left > seconds
      ? `Start filming now · ${left - seconds}`
      : left > 0 ? `Keep filming · ${left} s` : "✓ Enough — you can stop filming";
    line.classList.toggle("done", left <= 0);
  };
  render();
  line.hidden = false;
  countdownTimer = window.setInterval(() => {
    left--;
    render();
    if (left <= 0) window.clearInterval(countdownTimer);
  }, 1000);
}
function stopFilmCountdown(): void {
  window.clearInterval(countdownTimer);
  $("film-countdown").hidden = true;
}

/** Aynı şifreli zarf, QR yerine renkli kodla. Kayıtlar ve şifreleme değişmez. */
async function startColourSending(content: Uint8Array, label: string): Promise<void> {
  stopAnimation?.();
  sendCanvas.hidden = true;
  try {
    colourSender = await ColourSender.start($("send-stage"), content);
  } catch (error) {
    notify(`The colour code could not start: ${(error as Error).message}. Choose "Fast" to send with QR codes.`, "bad");
    return;
  }
  $("send-stats").textContent =
    `${label} · ${kb(content.length)} encrypted · colour code at ${COLOUR_FPS} images/s\n` +
    // Renkli kodda okunabilirliği belirleyen tek şey kodun karede kapladığı yer;
    // tam ekran düğmesi vardı ama kimse söylemiyordu.
    `Press "Full screen" first: the colour code only reads well when it fills the picture.\n` +
    `Receiver: film this screen for at least ${colourSeconds(content.length)} seconds.`;
  $("send-stop").hidden = false;
  $("send-restart").hidden = sendPreset === "live";
  $("send-fullscreen").hidden = !document.fullscreenEnabled;
  startFilmCountdown(colourSeconds(content.length));
  sendTimer.arm();
  sendTimer.start("Sending");
  stopAnimation = () => {
    sendTimer.stop("Codes shown for");
    stopFilmCountdown();
    colourSender?.stop();
    colourSender = undefined;
    $("send-stop").hidden = true;
    $("send-restart").hidden = true;
    $("send-fullscreen").hidden = true;
    if (document.fullscreenElement) void document.exitFullscreen();
  };
}

/**
 * Son gönderim: durdurulduktan sonra aynı şifreli zarf, aynı oturum ve aynı kodla
 * yeniden oynatılır. Sayfayı yenileyip kodu yeniden yazmak gerekmez; alıcı aynı
 * aktarımın parçalarını toplamayı sürdürür. Seçili yöntem değiştirilebilir.
 */
let lastSend: { content: Uint8Array; label: string; sessionId: number } | undefined;

/** Kayıtta alıcı başı kaçırdıysa: gönderim geri sayımla yeniden başlar, aynı kodla. */
$("send-restart").onclick = () => {
  if (!lastSend) return;
  const { content, label, sessionId } = lastSend;
  startSending(content, label, undefined, sessionId);
  notify("Started again: a 3-second countdown, then the codes. Start filming now.", "ok");
};

$("send-again").onclick = async () => {
  if (!lastSend) return;
  if (!(await flashingAccepted())) return;
  $("send-again").hidden = true;
  const { content, label, sessionId } = lastSend;
  startSending(content, label, undefined, sessionId);
  notify("Sending again with the same code. The receiver keeps what it already collected.", "ok");
};

/**
 * Süre sayacı: ölçümü kronometresiz yapabilmek için. Gönderende kodların ne
 * kadar gösterildiği, alanda ilk koddan teslime kadar geçen süre görünür.
 */
function stopwatch(id: string) {
  let startedAt = 0;
  let timer = 0;
  /** Durduktan sonra kilitli: yeni sayım ancak kullanıcı yeni bir işlem başlatınca (arm). */
  let locked = false;
  const format = (ms: number) => {
    const seconds = Math.round(ms / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };
  return {
    start(label: string): void {
      if (timer || locked) return;
      startedAt = performance.now();
      const tick = () => { $(id).textContent = `${label} · ${format(performance.now() - startedAt)}`; };
      tick();
      $(id).hidden = false;
      timer = window.setInterval(tick, 1000);
    },
    /** Durdurur, son süreyi ekranda bırakır ve biçimli süreyi döndürür. */
    stop(label: string): string | undefined {
      if (!timer) return undefined;
      window.clearInterval(timer);
      timer = 0;
      locked = true;
      const took = format(performance.now() - startedAt);
      $(id).textContent = `${label} · ${took}`;
      return took;
    },
    arm(): void { locked = false; },
  };
}
const sendTimer = stopwatch("send-timer");
const recvTimer = stopwatch("recv-timer");

function startSending(content: Uint8Array, label: string, done?: SendCompletion, sessionId = senderSession!.sessionId): void {
  if (!done) {
    lastSend = { content, label, sessionId };
    $("send-again").hidden = true;
  }
  // Matris koşusu ölçüm içindir ve QR'la yapılır; renkli kod yalnız gerçek gönderimde.
  if (sendPreset === "colour" && !done) {
    void startColourSending(content, label);
    return;
  }
  stopAnimation?.();
  sendCanvas.hidden = false;
  const version = Number($<HTMLSelectElement>("version").value);
  const configuredHold = Number($<HTMLSelectElement>("hold").value);
  let hold = configuredHold;
  const blockSize = frameBytes(version) - FRAME_OVERHEAD;
  const fountain = ltEncode(content, blockSize);
  const initial = systematicEncode(content, blockSize);
  let retry: ReturnType<typeof systematicEncode> | undefined;
  let latestAck: AckMessage | undefined;
  let initialDone = !senderNegotiated?.arq;
  let lastAckSequence = -1;
  let sentAtAck = 0;
  let receivedAtAck = 0;
  const flow = new AdaptiveFlowController(Math.round(60 / configuredHold), 5, 60);
  let lastDisplayAt = -Infinity;
  let sent = 0;
  const t0 = performance.now();
  let raf = 0;

  applySenderAck = (ack) => {
    if (ack.sequence <= lastAckSequence || ack.totalBlocks !== Math.ceil(content.length / blockSize)) return;
    lastAckSequence = ack.sequence;
    latestAck = ack;
    if (initialDone && ack.missing.length) retry = systematicEncode(content, blockSize, ack.missing);
    const fps = flow.observe({
      sent: Math.max(1, sent - sentAtAck),
      received: Math.max(0, ack.receivedBlocks - receivedAtAck),
      decodeMs: ack.decodeMicros / 1000,
    });
    sentAtAck = sent;
    receivedAtAck = ack.receivedBlocks;
    hold = Math.max(1, Math.round(60 / fps));
    if (ack.complete) {
      stopAnimation?.();
      done?.onDone();
    }
  };

  const nextBlock = () => {
    if (retry) {
      const next = retry.next();
      if (!next.done) return next.value;
      retry = undefined;
    }
    if (!initialDone) {
      const next = initial.next();
      if (!next.done) return next.value;
      initialDone = true;
      if (latestAck?.missing.length) {
        retry = systematicEncode(content, blockSize, latestAck.missing);
        return retry.next().value!;
      }
    }
    return fountain.next().value!;
  };

  const loop = (timestamp: number) => {
    raf = requestAnimationFrame(loop);
    // Pace by elapsed time: 120/144 Hz displays must not double the requested rate.
    if (timestamp - lastDisplayAt < (1000 * hold) / 60 - 0.5) return;
    lastDisplayAt = timestamp;
    // Ekran ne kadar büyükse o kadar çok kod aynı anda gösterilir; kamera
    // hepsini tek karede okursa verim kod sayısıyla çarpılır.
    const tiles = Math.max(1, Number($<HTMLSelectElement>("tiles").value) || 1);
    const batch: Uint8Array[] = [];
    for (let index = 0; index < tiles; index++) {
      const { seed, payload } = nextBlock();
      batch.push(encodeFrame({ type: FrameType.Data, sessionId, seed, totalBytes: content.length, blockSize, payload }));
    }
    drawFrames(sendCanvas, batch, { version });
    sent += batch.length;
    if (done && sent >= done.frameBudget) {
      stopAnimation?.();
      done.onDone();
    }
    const secs = (performance.now() - t0) / 1000 || 1;
    $("send-stats").textContent =
      `${label} · ${kb(content.length)} encrypted · ${Math.ceil(content.length / blockSize)} blocks\n` +
      `${sent} frames · ${(sent / secs).toFixed(1)} frames/s · ceiling ${((sent * blockSize) / 1024 / secs).toFixed(1)} KB/s\n` +
      `${senderNegotiated?.arq ? `duplex ARQ · ACK ${lastAckSequence < 0 ? "waiting" : lastAckSequence} · target ${flow.fps} fps` : "simplex fountain"}`;
  };
  raf = requestAnimationFrame(loop);
  $("send-stop").hidden = false;
  $("send-restart").hidden = sendPreset === "live";
  $("send-fullscreen").hidden = !document.fullscreenEnabled;
  if (sendPreset === "record" && !done) startFilmCountdown(recordingSeconds(content.length));
  sendTimer.arm();
  sendTimer.start("Sending");
  stopAnimation = () => {
    sendTimer.stop("Codes shown for");
    stopFilmCountdown();
    cancelAnimationFrame(raf);
    $("send-stop").hidden = true;
    $("send-restart").hidden = true;
    $("send-fullscreen").hidden = true;
    if (document.fullscreenElement) void document.exitFullscreen();
  };
}

$("send-stop").onclick = () => {
  stopAnimation?.();
  $("send-again").hidden = !lastSend;
  sendCanvas.hidden = true;
  $("send-stats").textContent += "\nStopped. Choose the file again to send it again.";
  notify("Sending stopped. The dispatch record already downloaded stays valid; send the file again to deliver it.", "ok");
};

// ---- AL ---------------------------------------------------------------------
const recvVideo = $<HTMLVideoElement>("recv-video");
const offerCanvas = $<HTMLCanvasElement>("offer-qr");
let receiverIdentity: Identity;
let pendingOffer: Pending;
let receiverSession: Session | undefined;
let receiverNegotiated: NegotiatedCapabilities | undefined;
let receiverConfirmed = false;
let receiverDecoder: LtDecoder | undefined;
let useful = 0;
/** Bu cihazda aktarım kodu (ya da kart) yokken görülen veri kareleri. */
let codelessFrames = 0;
/** Kayıttan okunuyorsa eksik kod bitişte söylenir; canlıda hemen. */
let readingRecording = false;
let decoded = 0;
/** Çözücüye verilen kamera karesi sayısı: captured ile farkı, çözücüler meşgulken atlanan karelerdir. */
let tried = 0;
let transferStartedAt = 0;
let ackSequence = 0;
let lastAckAt = 0;
let stopReceiverScan: (() => void) | undefined;
let receiverPaused = false;
/** Kart üretilmişse alıcının kalıcı anahtarı; tek yönlü kareler yalnız o zaman kabul edilir. */
let oneWayKey: ReceiverKey | undefined;
let oneWaySession: number | undefined;
/** Alıcının gösterdiği tek kullanımlık kod; ayarlıysa kodla mühürlenmiş akış beklenir. */
let typedCode: string | undefined;
/** Açılamayan akışlar: gönderen doğru kodla yeniden başlatınca eskisi karışmasın. */
const rejectedSessions = new Set<number>();
/**
 * Teslim edilmiş tek yönlü aktarımlar: gönderen yedek kareleri teslimden sonra da
 * yollar (seri hatta sürekli akışta her dosyada). Onlar yeni bir aktarım sanılmasın.
 */
const deliveredSessions = new Set<number>();
/** Kilitli oturum dışındaki oturumların kare sayısı: gönderen yeniden başlatmış olabilir. */
const foreignFrames = new Map<number, number>();
const SWITCH_AFTER_FRAMES = 12;
const RECEIVER_KEY_ID = "receiver-x25519-v1";

/**
 * Uzun aktarımda kamerayı dakikalarca ekranda tutmak asıl zorluk — dosya boyutu
 * değil. Ara vermek kamerayı kapatır ama decoder'ı ellemez, yani toplanmış
 * bloklar durur ve devam edildiğinde yalnız eksikler alınır.
 *
 * Kapsam bilerek OTURUM İÇİdir. Sayfa kapanırsa oturum anahtarı da gider —
 * anahtarlar geçici olduğu için (ileri gizlilik) ve bunu bozmak, aktarımı
 * bölünebilir yapmak uğruna asıl güvenceden vazgeçmek olurdu. Toplanan bloklar
 * şifreli; anahtar olmadan zaten açılamazlar.
 */
function setReceiverPaused(paused: boolean): void {
  receiverPaused = paused;
  const button = $<HTMLButtonElement>("recv-pause");
  // Aktarım başlamadan da kamera kapatılabilmeli: telefonda boşuna açık kalıp
  // pil yiyordu. Aktarım sürerken aynı düğme ilerlemeyi korur.
  const inTransfer = Boolean(receiverDecoder);
  button.textContent = paused
    ? (inTransfer ? "Turn camera on — continue where it stopped" : "Turn camera on")
    : (inTransfer ? "Turn camera off — progress is kept" : "Turn camera off");
  recvVideo.hidden = paused;
  if (paused) {
    stopReceiverScan?.();
    stopReceiverScan = undefined;
    $("recv-stats").textContent = inTransfer
      ? `Camera off · ${Math.round(collected(receiverDecoder!) * 100)}% collected.\n` +
        "When you turn it back on, only the missing frames are read.\n" +
        "Do not close the page: the session key is temporary and progress is lost if it closes."
      : "Camera off. Turn it on when the sender is ready.";
  } else {
    void resumeReceiverScan();
  }
}

/** Kameradan gelen her kare için alıcı mantığı. Duraklat/devam aynı işlevi
 *  yeniden bağlar; kopyalanmış ikinci bir sürüm zamanla ayrışırdı. */
async function onReceiverFrame(bytes: Uint8Array, captured: number, decodeMs: number): Promise<boolean> {
    // Lisans kodu: yüklenir, kamera açık kalır (ardından aktarım gelebilir).
    if (!receiverSession && oneWaySession === undefined && await acceptLicenceCode(bytes)) return false;
    // Mühür kodu: aktarım değil, tek bir imzalı kayıt.
    if (!receiverSession && oneWaySession === undefined && await acceptSeal(bytes)) return true;
    // El sıkışmadan önce gelen veri karesi, kamerasız gönderenden gelir. Yalnız
    // bu cihaz bir kart üretmişse dinlenir; zarf zaten yalnız bu anahtarla açılır.
    if (heldWire && parseFrame(bytes)?.sessionId === heldSession) return false;
    // Yalnız seri hatta dinlerken: kaydı ya da sayfaları bilerek yeniden okumak yeni bir teslim üretmeli.
    if (serialListening && !receiverSession && deliveredSessions.has(parseFrame(bytes)?.sessionId ?? -1)) return false;
    // Basılı sayfada kod sona kalabilir: bloklar koddan bağımsızdır, kod yalnız açarken gerekir.
    if (!receiverSession && (oneWayKey || typedCode || pairMode === "paper") && oneWaySession === undefined) {
      const first = parseFrame(bytes);
      if (first?.type === FrameType.Data && !rejectedSessions.has(first.sessionId)) {
        oneWaySession = first.sessionId;
        offerCanvas.hidden = true;
      }
    }
    // Gönderen aktarımı yeniden başlatırsa (yeni gönderim, yeni kod) kareler yeni
    // bir oturuma aittir. Önceden sessizce atılıyordu: canlı taramada %18'e gelip
    // sonra kaydı açan kullanıcı hiçbir ilerleme görmüyordu. Yeni oturumdan
    // yeterince kare gelince ona geçilir; tek tük yabancı kare mevcut aktarımı bozmaz.
    if (!receiverSession && oneWaySession !== undefined) {
      const incoming = parseFrame(bytes);
      if (incoming?.type === FrameType.Data && incoming.sessionId !== oneWaySession && !rejectedSessions.has(incoming.sessionId)) {
        const seen = (foreignFrames.get(incoming.sessionId) ?? 0) + 1;
        foreignFrames.set(incoming.sessionId, seen);
        if (seen < SWITCH_AFTER_FRAMES) return false;
        oneWaySession = incoming.sessionId;
        receiverDecoder = undefined;
        useful = 0;
        decoded = 0;
        tried = 0;
        transferStartedAt = 0;
        foreignFrames.clear();
        notify("The sender started the transfer again. Kionel switched to the new transfer; earlier progress belonged to the old one.", "warn");
      }
    }
    if (!receiverSession && oneWaySession === undefined) {
      if (parseFrame(bytes)?.type === FrameType.Data) {
        codelessFrames++;
        if (codelessFrames === 20 && !readingRecording) {
          notify("A Kionel transfer is on the sending screen, but this device has no code for it. If the sender typed " +
            "a code, choose \"Sender has no camera — show a code\" here and send again with the code shown.", "warn");
        }
        return false;
      }
      try {
        const control = decodeHandshakeControl(bytes);
        const reply = control?.kind === ControlKind.Reply ? control.record : bytes;
        receiverSession = await finishOffer(pendingOffer, owned(reply));
        receiverNegotiated = negotiateCapabilities(LOCAL_CAPABILITIES, control?.capabilities);
        if (stopSoundPlay) {
          endSoundPlay();
          soundPairedSession = true;
          $("sound-note").textContent = "The sender heard this device and replied. Compare the codes on both screens.";
          notify("Paired by sound. Compare the codes on both screens, then press Codes match.", "ok");
        }
        beginQualificationAttempt();
        offerCanvas.hidden = true;
        showSas($("recv-sas"), receiverSession);
        $("recv-confirm").hidden = false;
        $("recv-stats").textContent = `Handshake complete. Compare the codes.\nChannel: ${receiverNegotiated.arq ? "duplex ARQ" : "simplex fountain"}`;
      } catch {
        // Cevap kaydı olmayan kareyi beklemeye devam et.
      }
      return false;
    }
    if (receiverSession && !receiverConfirmed) return false;

    const frame = parseFrame(bytes);
    if (!frame || frame.type !== FrameType.Data || frame.sessionId !== (receiverSession?.sessionId ?? oneWaySession)) return false;
    decoded++;
    if (!transferStartedAt) transferStartedAt = performance.now();
    if (frame.totalBytes > MAX_WEB_TRANSFER_BYTES) {
      $("recv-stats").textContent = "Transfer rejected: the file is larger than this device accepts.";
      notify($("recv-stats").textContent, "bad");
      return false;
    }
    if (!receiverDecoder && pairMode === "paper" && !isBusiness()) {
      const pages = pagesFor(frame.totalBytes, frame.blockSize);
      if (pages && pages > FREE_PAPER_PAGES) {
        // Oturum reddedilmez: lisans yüklenince aynı sayfalar hemen okunur.
        if (!paperLimitWarned) notify(`These pages hold a ${pages}-page file; the free personal edition reads up to ${FREE_PAPER_PAGES} pages. ` +
          "Load a business licence on this device to read it; the pages stay valid.", "warn");
        paperLimitWarned = true;
        oneWaySession = undefined;
        return false;
      }
    }
    if (!receiverDecoder) {
      receiverDecoder = new LtDecoder(frame.totalBytes, frame.blockSize);
      // Ara verme yalnız beklemeye değecek uzunluktaki aktarımda anlamlı; kısa
      // aktarımda düğme göstermek kullanıcıya olmayan bir sorun icat eder.
      if (!receiverPaused) $("recv-pause").textContent = "Turn camera off — progress is kept";
    }
    if (receiverDecoder.totalBytes !== frame.totalBytes || receiverDecoder.blockSize !== frame.blockSize) return false;
    recvTimer.start("Receiving");
    if (receiverDecoder.ingest(frame.seed, frame.payload)) useful++;
    if (receiverNegotiated?.arq && (performance.now() - lastAckAt > 350 || useful % 12 === 0)) {
      drawReceiverAck(receiverDecoder, decodeMs);
    }
    renderReceiver(receiverDecoder, captured);
    if (!receiverDecoder.done) return false;
    $("recv-pause").hidden = true;
    if (!receiverSession) return finishOneWay(receiverDecoder.result()!);
    await finishReceive(receiverDecoder.result()!);
    // Matris koşusunda oturum korunur: yeni el sıkışma ve yeni SAS onayı
    // gerekmez, decoder sıfırlanıp sonraki deneme beklenir.
    if (!qualificationEnabled) return true;
    receiverDecoder = undefined;
    useful = 0;
    decoded = 0;
    tried = 0;
    transferStartedAt = 0;
    beginQualificationAttempt();
    return false;
}

$<HTMLButtonElement>("recv-pause").onclick = () => setReceiverPaused(!receiverPaused);

// Kamera değiştirmek akışı sıfırlamaz: toplanan bloklar decoder'da durur, yalnız
// görüntü kaynağı değişir. Yanlış kamerayla başlayan bir aktarımı baştan almak
// zorunda kalmak, çözülmesi kolay bir sorunu pahalı hâle getirirdi.
$<HTMLSelectElement>("recv-camera").onchange = (event) => {
  rememberCamera((event.target as HTMLSelectElement).value);
  stopReceiverScan?.();
  stopReceiverScan = undefined;
  void resumeReceiverScan();
};

/** Ara verdikten sonra kamerayı aynı geri çağırma ile yeniden açar. */
async function resumeReceiverScan(): Promise<void> {
  if (stopReceiverScan) return;
  recvTimer.arm();
  try {
    stopReceiverScan = await scanCamera(recvVideo, onReceiverFrame);
  } catch (error) {
    $("recv-stats").textContent = cameraError(error);
    notify($("recv-stats").textContent, "bad");
  }
}

async function startReceiver(): Promise<void> {
  receiverStarted = true;
  codelessFrames = 0;
  recvTimer.arm();
  try {
    receiverIdentity = await identityPromise;
    const created = await createOffer(receiverIdentity);
    pendingOffer = created.pending;
    drawFrame(offerCanvas, encodeHandshakeControl({
      kind: ControlKind.Offer,
      record: created.offer,
      capabilities: LOCAL_CAPABILITIES,
    }), { version: 10 });
    $("recv-stats").textContent = `Offer ready. Show the sender's reply QR to the camera.${identityNotice()}`;

    oneWayKey = await readStored<ReceiverKey>(RECEIVER_KEY_ID).catch(() => undefined);
    if (oneWayKey) $("recv-stats").textContent += "\nAlso listening for a sender without a camera.";

    stopReceiverScan = await scanCamera(recvVideo, onReceiverFrame);
    $("recv-pause").hidden = false;
  } catch (error) {
    $("recv-stats").textContent = `${cameraError(error)}\nThe receiving device needs a camera; the sending device does not.`;
    notify($("recv-stats").textContent!, "bad");
    receiverStarted = false;
  }
}

// ---- renkli kod (alıcı) --------------------------------------------------------------
let colourReader: ColourReader | undefined;
let colourStarting: Promise<void> | undefined;
let colourDelivered = false;
let pendingColourFile: Uint8Array | undefined;
let noQrFrames = 0;
function ensureColourReader(): Promise<void> {
  colourStarting ??= ColourReader.create(
    (bytes) => void deliverColourFile(bytes),
    () => {
      if (!colourReader || receiverDecoder) return;
      recvTimer.start("Receiving");
      $("bar").style.width = `${Math.round(colourReader.progress * 100)}%`;
    },
  ).then((reader) => { colourReader = reader; }).catch((error: Error) => {
    colourStarting = undefined;
    notify(`The colour-code reader could not start: ${error.message}. QR codes still work.`, "warn");
  });
  return colourStarting;
}

/**
 * Renkli koddan gelen dosya, QR'dan gelenle aynı kapıdan geçer. Çift yönlü
 * aktarımda iki ekrandaki kodlar karşılaştırılmadan dosya kabul EDİLMEZ; bekletilir.
 */
async function deliverColourFile(bytes: Uint8Array): Promise<void> {
  if (colourDelivered) return;
  if (receiverSession && !receiverConfirmed) {
    pendingColourFile = bytes;
    notify("The file has arrived by colour code. Compare the codes on both screens, then press Codes match to accept it.", "warn");
    return;
  }
  if (!transferStartedAt) transferStartedAt = performance.now();
  $("bar").style.width = "100%";
  if (receiverSession) {
    await finishReceive(bytes);
    colourDelivered = true;
  } else {
    colourDelivered = await finishOneWay(bytes);
  }
}

// ---- kayıttan okuma ---------------------------------------------------------------
/**
 * Canlı kamera her kareyi çözmeye yetişemez; kayıt yetişmek zorunda değildir.
 * Telefonun kendi kamera uygulaması ekranı yüksek kare hızıyla kaydeder, sayfa
 * kaydı çözebildiği hızda oynatır. Yöntem sendmecongo'dan (MIT/Apache-2.0)
 * esinlenir; kod bizimdir ve mevcut alıcı mantığını (onReceiverFrame) kullanır,
 * yani çift yönlü, kodlu ve kartlı akışların hepsi kayıttan da okunur.
 */
// Telefonda 1920 piksellik kareyi çözmek kare başına yüzlerce ms sürer; QR için
// 1280 yeter (sürüm 40, ekranın yarısını kaplasa bile modül başına ~3 piksel).
const MAX_RECORDING_WIDTH = 1280;

/**
 * Bu kaydın hızına göre kaç saniye daha kayıt gerektiği. Gözlenen hız, bu
 * kayıttan gelen yararlı kod sayısının kaydın oynatılan süresine oranıdır.
 */
function moreSecondsNeeded(usefulHere: number, videoSeconds: number): number | undefined {
  if (!receiverDecoder || !usefulHere || videoSeconds < 1) return undefined;
  // Saniyede bir koddan az okunuyorsa daha uzun çekmek çözmez; sorun görüntüdedir.
  if (usefulHere / videoSeconds < 1) return undefined;
  const missing = Math.ceil(receiverDecoder.k * 1.08) - useful;
  if (missing <= 0) return 0;
  return Math.ceil((missing / (usefulHere / videoSeconds)) * 1.2) + 2;
}
let lastRecordingNeed: number | undefined;
/** Son okunan kaydın boyutu ve verimi: bitişte doğru öneriyi vermek için. */
let lastRecording = { width: 0, height: 0, useful: 0, seconds: 0 };
/** Mesajlaşma uygulamaları videoyu küçültür; yoğun kod o çözünürlükte okunamaz. */
const MIN_RECORDING_SIDE = 720;
const COMPRESSED_HINT = "It was probably made smaller on the way: messaging apps such as WhatsApp compress videos. " +
  "Copy the original from the phone by cable or Quick Share, or send it as a document rather than as a video.";
/** Bu süre içinde tek kare gelmezse tarayıcı kaydı okuyamıyor demektir. */
const RECORDING_STALL_MS = 6000;

async function readRecording(input: HTMLInputElement): Promise<void> {
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  if (needsBusiness("Reading a screen recording")) return;
  // Kamera uygulaması kamerayı kullanacak; canlı tarama açık kalmasın.
  if (stopReceiverScan) setReceiverPaused(true);
  if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) {
    notify("This browser cannot read recordings frame by frame. Use a current Chrome, Edge or Safari.", "bad");
    return;
  }
  $("recv-stats").textContent = `Reading ${file.name}…`;
  colourDelivered = false;
  codelessFrames = 0;
  readingRecording = true;
  recvTimer.arm();
  const typed = normalizeTransferCode($<HTMLInputElement>("recording-code").value);
  if (typed) typedCode = typed;
  await ensureColourReader();
  notify(`Reading the recording ${file.name}. Keep this page open.`, "ok");
  try {
    const outcome = await scanRecording(file, onReceiverFrame);
    if (outcome === "ended") {
      recvTimer.stop("Recording read in");
      const progress = receiverDecoder ? Math.round(collected(receiverDecoder) * 100) : 0;
      const small = Math.min(lastRecording.width, lastRecording.height) < MIN_RECORDING_SIDE
        ? ` This video is ${lastRecording.width}×${lastRecording.height}, too small for the codes. ${COMPRESSED_HINT}` : "";
      const poor = progress && !lastRecordingNeed && lastRecording.seconds >= 2
        ? ` Only ${lastRecording.useful} codes were read from ${Math.round(lastRecording.seconds)} seconds of video, so filming longer will not help; ` +
          (small ? "the picture is the problem." : "the picture is the problem: film at 1080p and 30 fps from 30–50 cm, so the code fills most of the picture, in focus and without glare or zoom.")
        : "";
      const more = lastRecordingNeed ? `Record about ${lastRecordingNeed} more seconds` : "Record a few seconds more";
      if (lastRecordingNeed) {
        $("record-need").textContent = `Record about ${lastRecordingNeed} more seconds of the sending screen.`;
        $("record-need").hidden = false;
      }
      // Renkli kodun ilerlemesi QR çözücüsünden ayrı tutulur; ikisi aynı dosyayı
      // toplar ama sayacı farklıdır. Ayrılmazsa yarı dolmuş bir renkli okuma
      // "hiç kod bulunamadı" diye raporlanıyordu.
      const colourPct = colourReader?.parts ? Math.round(colourReader.progress * 100) : 0;
      const readable = colourReader?.frames ? colourReader.parts / colourReader.frames : 0;
      const text = progress
        ? poor
          ? `The recording ended with ${progress}% of the file collected.${poor}${small} What was collected is kept.`
          : `The recording ended with ${progress}% of the file collected. ${more}: ` +
            "what was collected is kept and the next recording continues from here."
        : codelessFrames
          ? "This recording has Kionel codes, but this device does not have the code of that transfer. Type it in " +
            "\"Code used for this recording\" above and open the video again."
          // Renkli kodda kare çözülmemesinin sebebi "kod yok" değil, neredeyse hep
          // görüntü: hücreler QR'dan küçük ve video sıkıştırması rengi bozar.
          : colourReader?.parts
          ? `The recording ended with ${colourPct}% of the file collected by colour code: ` +
            `${colourReader.parts} of ${colourReader.frames} images could be read.${small} ` +
            "What was collected is kept, so another recording of the same transfer continues from here. " +
            (readable < 0.2
              ? "Most images were too blurred or too compressed to read: fill the frame with the code from 20–40 cm, " +
                "at 1080p and 30 fps without zoom, HDR or glare. If the picture cannot be improved, send with \"Fast — recording\" instead."
              : "")
          : colourReader?.frames
          ? `None of the ${colourReader.frames} colour-code images in this recording could be read.${small} ` +
            "Colour codes need a sharper picture than QR codes: fill the frame with the code from 20–40 cm, " +
            "record at 1080p and 30 fps without zoom, HDR or glare. If that is not possible, send with \"Fast — recording\" instead."
          : small
          ? `No Kionel codes were found in this recording.${small}`
          : "No Kionel codes were found in this recording. Check that the sending screen is in view, " +
            "in focus and not reflecting the light, and that the sender has started.";
      $("recv-stats").textContent = text;
      // Yarısı toplanmış bir okuma başarısızlık değil: uyarı, hata değil.
      notify(text, progress || colourPct ? "warn" : "bad");
    }
  } catch (error) {
    recvTimer.stop("Stopped after");
    notify(`The recording could not be read: ${(error as Error).message}`, "bad");
  } finally {
    readingRecording = false;
  }
}
$<HTMLInputElement>("record-capture").onchange = (event) => void readRecording(event.target as HTMLInputElement);
$<HTMLInputElement>("record-open").onchange = (event) => void readRecording(event.target as HTMLInputElement);

/** Kaydı oynatıp her gösterilen kareyi çözer; çözme yavaşsa oynatmayı yavaşlatır. */
function scanRecording(
  file: File,
  onBytes: (bytes: Uint8Array, captured: number, decodeMs: number) => Promise<boolean>,
): Promise<"done" | "ended"> {
  return new Promise((resolve, reject) => {
    // Video sayfada ve görünür olmalı: Android'de sayfaya bağlı olmayan video kare
    // üretmeyebiliyor ve kullanıcı "okuyor" yazısının altında hiçbir şey görmüyordu.
    const video = $<HTMLVideoElement>("rec-video");
    const progressLine = $("rec-progress");
    const url = URL.createObjectURL(file);
    const grab = document.createElement("canvas");
    const context = grab.getContext("2d", { willReadFrequently: true })!;
    let captured = 0;
    let finished = false;
    const usefulAtStart = useful;
    let lastFrameAt = performance.now();
    /** Bir kare işleniyor (çözme, dosyayı açma, imza): bu sırada bekçi saymaz. */
    let busy = false;
    let endedWhileBusy = false;
    /**
     * Sekme arka plana geçince tarayıcı video karelerini vermez, ama video oynamaya
     * devam eder: kareler kaybolur ve bekçi "kare gelmiyor" der. Okuma duraklar,
     * sayfaya dönülünce kaldığı yerden sürer.
     */
    let pausedForHidden = false;
    const onVisibility = () => {
      if (finished) return;
      if (document.hidden) {
        if (!video.paused) { video.pause(); pausedForHidden = true; }
        progressLine.textContent = "Paused: this page is in the background. Reading continues when you come back to it.";
      } else if (pausedForHidden) {
        pausedForHidden = false;
        lastFrameAt = performance.now();
        void video.play();
        notify("Reading continues from where it paused. Keep this page in front until it finishes.", "ok");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    const cleanup = () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(watchdog);
      video.pause();
      video.removeAttribute("src");
      video.load();
      video.hidden = true;
      URL.revokeObjectURL(url);
    };
    const finish = (outcome: "done" | "ended") => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(outcome);
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const watchdog = window.setInterval(() => {
      if (!busy && !video.paused && !document.hidden && performance.now() - lastFrameAt > RECORDING_STALL_MS) {
        fail(new Error("this browser is not delivering frames from the recording. Record at 1080p (not 4K or HEVC) " +
          "and open it again, or use the live camera"));
      }
    }, 1000);
    video.hidden = false;
    progressLine.hidden = false;
    progressLine.textContent = "Starting the recording…";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    lastRecording = { width: 0, height: 0, useful: 0, seconds: 0 };
    video.onloadedmetadata = () => {
      lastRecording.width = video.videoWidth;
      lastRecording.height = video.videoHeight;
      // Okumaya yine başlanır, ama kullanıcı sonucu beklemeden nedeni bilsin.
      if (Math.min(video.videoWidth, video.videoHeight) < MIN_RECORDING_SIDE) {
        notify(`This video is ${video.videoWidth}×${video.videoHeight}, probably too small to read. ${COMPRESSED_HINT}`, "warn");
      }
    };
    // Son kare hâlâ işlenirken video biterse karar işlem bitince verilir: kodla
    // gönderimde dosyayı açmak telefonda birkaç saniye sürer (PBKDF2, bilerek yavaş).
    video.onended = () => { if (busy) endedWhileBusy = true; else finish("ended"); };
    video.onerror = () => fail(new Error("the browser cannot play this video format. Record at 1080p H.264 (\"most compatible\" in the camera settings) and try again"));

    const onFrame = async () => {
      if (finished) return;
      busy = true;
      // İşlem uzarsa video durur: arada gösterilen kareler kaybolmaz ve video
      // işlem bitmeden sona ermez.
      let pausedHere = false;
      const pauseTimer = window.setTimeout(() => {
        if (!video.paused && !video.ended) { pausedHere = true; video.pause(); }
      }, 60);
      try {
        await processFrame();
      } finally {
        window.clearTimeout(pauseTimer);
        busy = false;
        lastFrameAt = performance.now();
      }
      if (finished) return;
      if (endedWhileBusy) return finish("ended");
      if (pausedHere && video.paused && !video.ended && !document.hidden) void video.play();
      video.requestVideoFrameCallback!(() => void onFrame());
    };

    const processFrame = async () => {
      recvTimer.start("Reading the recording");
      captured++;
      lastFrameAt = performance.now();
      // 4K kareyi çözmek yavaştır ve QR için gereksizdir; genişlik sınırlanır.
      const scale = Math.min(1, MAX_RECORDING_WIDTH / (video.videoWidth || MAX_RECORDING_WIDTH));
      const width = Math.round(video.videoWidth * scale);
      const height = Math.round(video.videoHeight * scale);
      if (width && height) {
        if (grab.width !== width || grab.height !== height) { grab.width = width; grab.height = height; }
        context.drawImage(video, 0, 0, width, height);
        const started = performance.now();
        const found = await readQrAll(context.getImageData(0, 0, width, height), MAX_SYMBOLS_PER_FRAME);
        const decodeMs = performance.now() - started;
        for (const bytes of found) {
          if (await onBytes(bytes, captured, decodeMs)) return finish("done");
        }
        // QR yoksa kare renkli kod olabilir. Çözücüler meşgulse video durur:
        // renkli kodda her kare değerlidir ve atlanan kare yeniden gelmez.
        if (!found.length && colourReader) {
          const colourFrame = await grabColourFrame(video);
          if (colourFrame) {
            if (!colourReader.idle) video.pause();
            await colourReader.submit(colourFrame, true);
          }
          if (colourDelivered) return finish("done");
          if (!finished && video.paused && !video.ended && !document.hidden) void video.play();
        }
        if (colourDelivered) return finish("done");
        // 60 fps kayıtta kare başına ~16 ms var. Karenin TÜM işlenmesi (çözme +
        // blok toplama) daha uzun sürüyorsa oynatma o oranda yavaşlar; aksi hâlde
        // arada gösterilen kareler atlanır. Kalan kaybı fountain kod telafi eder.
        const frameMs = performance.now() - started;
        video.playbackRate = Math.min(1, Math.max(0.1, (0.75 * 1000) / 60 / Math.max(frameMs, 1)));
        const share = receiverDecoder
          ? `${Math.round(collected(receiverDecoder) * 100)}% of the file`
          // Denenen kare sayısı da yazılır: hiçbiri çözülmediğinde "kod yok" ile
          // "kod var ama görüntü bozuk" ayırt edilemiyordu.
          : colourReader?.frames
            ? `colour code: ${colourReader.parts} of ${colourReader.frames} images read${colourReader.progress ? ` · ${Math.round(colourReader.progress * 100)}%` : ""}`
            : "no Kionel codes yet";
        const foreign = [...foreignFrames.values()].reduce((sum, n) => sum + n, 0);
        lastRecordingNeed = moreSecondsNeeded(useful - usefulAtStart, video.currentTime);
        lastRecording.useful = useful - usefulAtStart;
        lastRecording.seconds = video.currentTime;
        progressLine.textContent =
          `Reading the recording: ${video.currentTime.toFixed(0)}${Number.isFinite(video.duration) ? ` of ${video.duration.toFixed(0)}` : ""} s · ${useful} codes · ${share}` +
          (foreign ? ` · ${foreign} codes from a different transfer` : "") +
          (receiverDecoder && video.ended === false && lastRecordingNeed && lastRecordingNeed > (video.duration || 0) - video.currentTime
            ? ` · this video is about ${Math.ceil(lastRecordingNeed - ((video.duration || 0) - video.currentTime))} s too short`
            : "");
      }
    };
    video.requestVideoFrameCallback!(() => void onFrame());
    video.playbackRate = 0.5;
    // Okuyucu yavaş karede videoyu kısaca durdurur; ilk play() bununla çakışırsa AbortError
    // döner. Zararsızdır: oynatma işlem bitince sürer. Yalnız gerçek oynatma hataları düşürür.
    video.play().catch((error: Error) => { if (error.name !== "AbortError") fail(error); });
  });
}

// ---- alıcı modları ---------------------------------------------------------------
/**
 * İki bağımsız soru: gönderende kamera var mı (eşleşme), bu telefon nasıl okuyacak
 * (okuma). Her birleşim geçerlidir; seçime göre yalnız ilgili bölüm görünür ve
 * gönderen tarafta ne yapılacağı tek cümleyle yazılır.
 */
let pairMode: "camera" | "code" | "card" | "paper" = "camera";
let readMode: "live" | "record" | "file" | "serial" = "live";

function renderModes(): void {
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-pair]"))) {
    button.setAttribute("aria-pressed", String(button.dataset.pair === pairMode));
  }
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-read]"))) {
    button.setAttribute("aria-pressed", String(button.dataset.read === readMode));
  }
  $("pair-code-panel").hidden = pairMode !== "code";
  $("card-panel").hidden = pairMode !== "card";
  $("pair-paper-panel").hidden = pairMode !== "paper";
  $("read-question").textContent = pairMode === "paper" ? "2 · How will this device read the pages?" : "2 · How will this device read the sender's screen?";
  // Basılı sayfada ekran yok: ekran kaydı ve seri hat seçenekleri ile ekran-kamera anlatımı gizlenir.
  if (pairMode === "paper" && (readMode === "record" || readMode === "serial")) readMode = "live";
  for (const mode of ["record", "serial"]) {
    document.querySelector<HTMLButtonElement>(`[data-read="${mode}"]`)!.hidden = pairMode === "paper";
  }
  $("read-record-panel").hidden = readMode !== "record";
  $("read-file-panel").hidden = readMode !== "file";
  $("read-serial-panel").hidden = readMode !== "serial";
  // Seri hatta ekran ve kamera yok: ekran-kamera anlatımı gizlenir.
  $("recv-flow").hidden = readMode === "serial" || pairMode === "paper";
  $("recv-story").hidden = readMode === "serial" || pairMode === "paper";
  if (readMode === "record" && $("record-need").hidden) {
    $("record-need").textContent = "Film for as long as the sender's screen says.";
    $("record-need").hidden = false;
  }
  offerCanvas.hidden = pairMode !== "camera" || Boolean(receiverSession);
  const sender = {
    camera: "choose the file and scan the code shown here, then compare the codes on both screens",
    code: "choose the file, type this device's code under \"This PC has no camera?\" and press Send with this code",
    card: "choose the file and press \"Send to … without camera\" (the card must be loaded there once)",
    paper: "choose the file, pick \"Print on paper\" and print; bring the pages and their code here",
  }[pairMode];
  const speed = {
    live: "keep \"Standard — the receiver reads live\". Here: point this camera at the sender's screen.",
    record: "choose \"Fast — the receiver records the screen\" before sending. Here: press Record the screen now and film the sender for as long as the sender's screen says.",
    file: "choose \"Fast — the receiver records the screen\" before sending. Here: open the video you filmed.",
    serial: "open \"Send over a serial cable\" there, use the same speed, and press Choose the serial port and send. Here: press Choose the serial port and listen first.",
  }[readMode];
  // Adımlar hemen güncellensin (yoklama yarım saniyede bir). Modül yüklenirken ilk
  // çağrıda akış değişkenleri henüz tanımlı değil; o yüzden mikro görev olarak.
  queueMicrotask(renderFlow);
  $("mode-summary").textContent = pairMode === "paper"
    ? `On the printing PC: ${sender}. Here: enter the code, then ${readMode === "file" ? "open photos or scans of the pages" : "point this camera at each page, in any order"}.`
    : `On the sender: ${sender}; ${speed}`;
  if (readMode !== "serial" && pairMode !== "paper") renderFlowGuide($("recv-flow"), readMode === "live" ? "live" : "colour", readMode);
  renderStory($("recv-story"),
    readMode === "file" ? "later"
      : pairMode === "card" ? "card"
        : pairMode === "camera" ? "camera-live"
          : readMode === "live" ? "code-live" : "code-record");
}

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-pair]"))) {
  button.onclick = () => {
    if (button.dataset.pair === "card" && needsBusiness("A receiver card")) return;
    const entering = button.dataset.pair === "paper" && pairMode !== "paper";
    pairMode = button.dataset.pair as typeof pairMode;
    // Önceki bir aktarımın kodu sayfaları açmaz; gerçek bir denemede %100'den sonra
    // "kod açmıyor" hatasına ve baştan taramaya yol açtı. Sayfaların kodu burada girilir.
    if (entering) {
      typedCode = undefined;
      $("code-display").hidden = true;
    }
    if (pairMode === "code") {
      if (!typedCode) $("code-show").click();
      else {
        // Sayfa yenilendiyse aynı kod geri gelir: gönderen onu zaten yazmış olabilir.
        $("code-display").textContent = formatTransferCode(typedCode);
        $("code-display").hidden = false;
        $("code-show").textContent = "Show a new code";
      }
    }
    renderModes();
  };
}
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-read]"))) {
  button.onclick = () => {
    if (button.dataset.read !== "live" && needsBusiness(button.dataset.read === "serial" ? "Receiving over a serial cable" : "Reading a screen recording")) return;
    readMode = button.dataset.read as typeof readMode;
    // Kayıttan okurken kamera uygulaması kamerayı kullanacak; canlı tarama kapanır.
    if (readMode !== "live" && stopReceiverScan && !receiverPaused) setReceiverPaused(true);
    if (readMode === "live" && receiverPaused) setReceiverPaused(false);
    renderModes();
  };
}
renderModes();



// ---- sesle eşleşme: alıcı çalar ------------------------------------------------------
let stopSoundPlay: (() => void) | undefined;
let soundPlayTimer = 0;
/** Teklif iki dakika geçerlidir (MAX_RECORD_AGE_MS); ses ondan önce kesilir. */
const SOUND_PLAY_MS = 90_000;

function endSoundPlay(): void {
  stopSoundPlay?.();
  stopSoundPlay = undefined;
  window.clearTimeout(soundPlayTimer);
  $("sound-play").hidden = false;
  $("sound-stop").hidden = true;
}

$("sound-play").onclick = async () => {
  const note = $("sound-note");
  note.hidden = false;
  if (receiverSession) {
    note.textContent = "This device is already paired with a sender. Reload the page to pair again.";
    notify(note.textContent, "warn");
    return;
  }
  try {
    // Yeni teklif: sayfa açıldığında üretilen teklif iki dakikayı çoktan geçmiş olabilir.
    receiverIdentity = await identityPromise;
    const created = await createOffer(receiverIdentity);
    pendingOffer = created.pending;
    drawFrame(offerCanvas, encodeHandshakeControl({
      kind: ControlKind.Offer,
      record: created.offer,
      capabilities: LOCAL_CAPABILITIES,
    }), { version: 10 });
    // Cevap QR'ını bu kamera okuyacak; kayıt modunda kapalıysa açılır.
    if (receiverPaused) setReceiverPaused(false);
    stopSoundPlay = await playSound(created.offer);
    $("sound-play").hidden = true;
    $("sound-stop").hidden = false;
    soundPlayTimer = window.setTimeout(() => {
      endSoundPlay();
      note.textContent = "The sound stopped after 90 seconds, because a pairing offer is only valid for two minutes. Press Pair by sound again for a new one.";
      notify(note.textContent, "warn");
    }, SOUND_PLAY_MS);
    note.textContent = `Playing, about ${Math.ceil(soundSeconds(created.offer.length))} seconds per round, repeating. Turn the volume up and hold this device's ` +
      "speaker near the sending PC's microphone. When the PC shows a reply code, point this camera at it.";
    notify("Playing the pairing sound. The sending PC must be listening (\"Listen for the receiver\").", "ok");
  } catch (error) {
    endSoundPlay();
    note.textContent = `The pairing sound could not be played: ${(error as Error).message}. Type the code on the sending PC instead.`;
    notify(note.textContent, "bad");
  }
};

$("sound-stop").onclick = () => {
  endSoundPlay();
  $("sound-note").textContent = "The pairing sound stopped.";
  notify("The pairing sound stopped.", "ok");
};

// ---- sesle teslim makbuzu: alıcı çalar ------------------------------------------------
/** Bu oturum sesle eşleşti; gönderenin kamerası yok demektir. */
let soundPairedSession = false;
let soundReceipt: Uint8Array | undefined;
let stopReceiptPlay: (() => void) | undefined;
let receiptPlayTimer = 0;
const RECEIPT_PLAY_MS = 60_000;

function endReceiptPlay(): void {
  stopReceiptPlay?.();
  stopReceiptPlay = undefined;
  window.clearTimeout(receiptPlayTimer);
  $("receipt-play").hidden = !soundReceipt;
  $("receipt-stop").hidden = true;
}

async function playReceipt(): Promise<void> {
  const note = $("receipt-note");
  note.hidden = false;
  if (!soundReceipt) return;
  endReceiptPlay();
  try {
    stopReceiptPlay = await playSound(soundReceipt);
    $("receipt-play").hidden = true;
    $("receipt-stop").hidden = false;
    receiptPlayTimer = window.setTimeout(() => {
      endReceiptPlay();
      note.textContent = "The receipt sound stopped after a minute. Press Play the delivery receipt as sound to play it again.";
      notify(note.textContent, "warn");
    }, RECEIPT_PLAY_MS);
    note.textContent = `Playing the delivery receipt, about ${Math.ceil(soundSeconds(soundReceipt.length))} seconds per round, repeating. On the sending PC press ` +
      "\"Listen for the delivery receipt\" and hold this device's speaker near its microphone. Stop the sound when the PC shows \"Delivery verified\".";
  } catch (error) {
    // Tarayıcı, kullanıcı dokunmadan ses başlatmayı engelleyebilir; düğme kalır.
    note.textContent = `Press "Play the delivery receipt as sound" to send the signed receipt to the PC (${(error as Error).message}).`;
  }
}

$("receipt-play").onclick = () => {
  void playReceipt().then(() => { if (stopReceiptPlay) notify("Playing the delivery receipt. The sending PC must be listening for it.", "ok"); });
};

$("receipt-stop").onclick = () => {
  endReceiptPlay();
  $("receipt-note").textContent = "The receipt sound stopped. The signed receipt is also in the download below.";
  notify("The receipt sound stopped.", "ok");
};

// ---- kâğıda basılan aktarım -------------------------------------------------------------
/**
 * Dosya şifreli QR sayfaları olarak basılır (paper.ts). Alıcı sayfaları kamerayla,
 * herhangi bir sırayla okur ya da fotoğraflarını/taramalarını açar. Kod gönderende
 * yazılıysa o kullanılır; yoksa burada üretilir ve kullanıcıya yazdırılır: kâğıt
 * yedek, alıcı henüz yokken de basılabilmeli.
 */
$("paper-print").onclick = async () => {
  if (sendRoute !== "paper") selectRoute("paper");
  if (!selected) {
    notify("Choose a file first (step 2).", "bad");
    return;
  }
  const context = requireContext();
  if (!context) return;
  const density = $<HTMLSelectElement>("paper-density").value as Density;
  const typed = normalizeTransferCode($<HTMLInputElement>("typed-code").value);
  const code = typed ?? createTransferCode();
  const file = selected;
  try {
    const { wire, dispatch } = await sealWithCode(await identityPromise, code, file, context);
    const plan = paperPlan(wire.length, density);
    if (!isBusiness() && plan.pages > FREE_PAPER_PAGES) {
      const dense = paperPlan(wire.length, "dense").pages;
      notify(`${file.name} needs ${plan.pages} pages; the free personal edition prints up to ${FREE_PAPER_PAGES}. ` +
        (density === "standard" && dense <= FREE_PAPER_PAGES ? `Choose Dense and it fits on ${dense}, or load` : "Load") +
        ` a business licence for up to ${MAX_PAGES} pages. Need more pages for personal use? Tell us at kionel.com/contact.html.`, "warn");
      return;
    }
    if (plan.pages > MAX_PAGES) {
      notify(`${file.name} would need ${plan.pages} pages; paper takes up to ${MAX_PAGES}. ` +
        (density === "standard" ? "Choose Dense, or " : "") + "send it by screen recording or a serial cable instead.", "bad");
      return;
    }
    const frames = paperFrames(wire, density, globalThis.crypto.getRandomValues(new Uint32Array(1))[0]);
    const withCode = $<HTMLInputElement>("paper-code-on-pages").checked;
    await printPaper(file.name, frames, plan, withCode ? formatTransferCode(code) : undefined);
    $("dispatch-result").replaceChildren();
    offerDispatchRecord(dispatch);
    const shown = formatTransferCode(code);
    $("paper-code").textContent = shown;
    $("paper-code").hidden = false;
    $("paper-code-hide").hidden = false;
    $("paper-note").textContent = typed
      ? `Printed with the receiver's code ${shown}.`
      : "This is the code for these pages. Write it down and keep it apart from the pages: without it they cannot be read.";
    notify(`${plan.pages} ${plan.pages === 1 ? "page" : "pages"} of codes for ${file.name} sent to the printer (${plan.codes} codes, ` +
      `${plan.codes - plan.blocks} of them spare). ` + (typed ? "Scan them with the receiving device." : `The code is ${shown}; write it down.`), "ok");
  } catch (error) {
    notify(`The pages could not be prepared: ${(error as Error).message}`, "bad");
  }
};

async function printPaper(name: string, frames: Uint8Array[], plan: PaperPlan, code: string | undefined): Promise<void> {
  document.getElementById("print-report")?.remove();
  const sheet = Object.assign(document.createElement("section"), { id: "print-report", className: "paper" });
  const perPage = plan.columns * plan.rows;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1000;
  for (let page = 0; page < plan.pages; page++) {
    const div = Object.assign(document.createElement("div"), { className: "paper-page" });
    const head = Object.assign(document.createElement("p"), { className: "paper-head" });
    head.textContent = `KIONEL · ${name} · page ${page + 1} of ${plan.pages}` + (code ? ` · code ${code}` : "");
    const grid = Object.assign(document.createElement("div"), { className: `paper-grid cols-${plan.columns}` });
    for (const bytes of frames.slice(page * perPage, (page + 1) * perPage)) {
      drawFrame(canvas, bytes, { version: plan.version });
      grid.append(Object.assign(document.createElement("img"), { src: canvas.toDataURL("image/png"), alt: "" }));
    }
    const foot = Object.assign(document.createElement("p"), { className: "paper-foot" });
    foot.textContent = "To read: open kionel.com/transfer.html (or the offline package) → Receive → Printed pages, " +
      "enter the code, and point the camera at the pages in any order. Encrypted: the file cannot be read without its code.";
    div.append(head, grid, foot);
    sheet.append(div);
  }
  document.body.append(sheet);
  // Resimler çözülmeden yazdırılırsa sayfalar boş basılır (gerçek bir denemede böyle oldu).
  await Promise.all(Array.from(sheet.querySelectorAll("img"), (img) => img.decode().catch(() => undefined)));
  document.body.classList.add("printing-report");
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-report"), { once: true });
  window.print();
}

// Kayıttan okunmuş ama yanlış kodla açılamamış dosya: doğru kod yazılınca video yeniden okunmadan açılır.
$<HTMLInputElement>("recording-code").addEventListener("change", (event) => {
  const code = normalizeTransferCode((event.target as HTMLInputElement).value);
  if (!heldWire || !code) return;
  typedCode = code;
  notify(`Opening the file with ${formatTransferCode(code)}…`, "ok");
  void finishOneWay(heldWire);
});

$("code-use").onclick = () => {
  const code = normalizeTransferCode($<HTMLInputElement>("code-enter").value);
  if (!code) {
    notify("The code has 12 characters, for example 7K3Q-M9XD-4PAB. Check what is written on or with the pages.", "bad");
    $("code-enter").focus();
    return;
  }
  typedCode = code;
  try { sessionStorage.setItem(CODE_KEY, JSON.stringify({ code, at: Date.now() })); } catch { /* yok */ }
  $("code-display").textContent = formatTransferCode(code);
  $("code-display").hidden = false;
  $<HTMLInputElement>("code-enter").value = "";
  if (heldWire) {
    const wire = heldWire;
    notify(`Opening the file with ${formatTransferCode(code)}…`, "ok");
    void finishOneWay(wire);
    return;
  }
  $("recv-stats").textContent = "Point the camera at the printed pages, one at a time, in any order.";
  notify(`Code ${formatTransferCode(code)} in use. Point the camera at the pages, or open photos or scans of them.`, "ok");
  if (readMode === "live") {
    if (!receiverStarted) void startReceiver();
    else if (receiverPaused) setReceiverPaused(false);
    else void resumeReceiverScan();
    // Telefonda kamera görüntüsü sayfanın altında kalıyordu; kullanıcı neyi okutacağını göremedi.
    recvVideo.scrollIntoView({ block: "center", behavior: "smooth" });
  }
};

/** Sayfaların fotoğrafı ya da taraması: her görüntüde birden çok kod aranır. */
$<HTMLInputElement>("pages-open").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = "";
  if (!files.length) return;
  if (needsBusiness("Reading photos or scans of pages")) return;
  const typed = normalizeTransferCode($<HTMLInputElement>("recording-code").value);
  if (typed) typedCode = typed;
  if (!typedCode && !oneWayKey && pairMode !== "paper") {
    notify("Type the code for these pages in \"Code used for this recording or these pages\" first.", "bad");
    return;
  }
  recvTimer.arm();
  let found = 0, unreadable = 0, delivered = false;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  for (const file of files) {
    try {
      const image = await createImageBitmap(file);
      // Taramalar büyük olabilir; QR için 3000 piksel yeter.
      const scale = Math.min(1, 3000 / Math.max(image.width, image.height));
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      // Okuyucu görüntü başına en çok 9 kod verir; yoğun sayfada 12 kod var. Sınıra
      // takılırsa üst ve alt kısım (ortada örtüşerek) ayrıca okunur; tekrarlar zararsızdır.
      const whole = context.getImageData(0, 0, canvas.width, canvas.height);
      const codes = await readQrAll(whole, 9);
      if (codes.length === 9) {
        const cut = Math.round(canvas.height * 0.6);
        codes.push(...await readQrAll(context.getImageData(0, 0, canvas.width, cut), 9),
          ...await readQrAll(context.getImageData(0, canvas.height - cut, canvas.width, cut), 9));
      }
      if (!codes.length) unreadable++;
      for (const bytes of codes) {
        found++;
        if (await onReceiverFrame(bytes, found, 0)) { delivered = true; break; }
      }
    } catch (error) {
      unreadable++;
      notify(`${file.name} could not be read as an image: ${(error as Error).message}`, "bad");
    }
    if (delivered || heldWire) break;
  }
  // Dosya tamamlandı ama kod bekleniyor: o mesaj zaten gösterildi.
  if (delivered || heldWire) return;
  const share = receiverDecoder ? Math.round(collected(receiverDecoder) * 100) : 0;
  notify(`${found} codes read from ${files.length} ${files.length === 1 ? "image" : "images"}` +
    (unreadable ? ` (${unreadable} without readable codes)` : "") +
    (share ? `; ${share}% of the file so far. Add photos or scans of the remaining pages: what was read is kept.`
      : found ? ". None belongs to a transfer this code opens: check the code." : ". Photograph the pages straight on, in good light, one page per photo."),
    found && share ? "warn" : "bad");
};


// ---- adım akışı ----------------------------------------------------------------------
/**
 * Seçilen yolun adımları sırayla (steps.ts). Durum yarım saniyede bir okunur ve
 * yalnız değiştiğinde yeniden çizilir; düğmeye basılırken liste yenilenmez.
 */
// ponytail: durum yoklanıyor (2 Hz); olay kancaları her durum değişikliğine dağılmasın diye.
let sendRoute: SendRoute = "screen";
const drawn = new Map<string, string>();

function showStepTarget(id: string): void {
  const target = document.getElementById(id);
  if (!target) return;
  target.closest("details")?.setAttribute("open", "");
  const visible = target.hidden || target.offsetParent === null ? target.closest("label") ?? target.parentElement ?? target : target;
  visible.scrollIntoView({ block: "center", behavior: "smooth" });
  if (target instanceof HTMLInputElement || target instanceof HTMLButtonElement) target.focus({ preventScroll: true });
}

function drawSteps(listId: string, steps: Step[]): void {
  const key = JSON.stringify(steps);
  if (drawn.get(listId) === key) return;
  drawn.set(listId, key);
  $(listId).replaceChildren(...steps.map((step) => {
    const item = Object.assign(document.createElement("li"), { className: `flow-step is-${step.state}` });
    item.append(Object.assign(document.createElement("strong"), { textContent: step.title }));
    if (step.state === "now") {
      if (step.detail) item.append(Object.assign(document.createElement("span"), { textContent: step.detail }));
      if (step.target) {
        const go = Object.assign(document.createElement("button"), { type: "button", className: "secondary step-go", textContent: "Show me" });
        go.onclick = () => showStepTarget(step.target!);
        item.append(go);
      }
    }
    return item;
  }));
}

function renderFlow(): void {
  drawSteps("send-steps", sendSteps({
    route: sendRoute,
    file: Boolean(selected),
    code: Boolean(normalizeTransferCode($<HTMLInputElement>("typed-code").value)),
    handshake: Boolean(senderSession),
    sending: !$("send-stop").hidden || !$("serial-stop").hidden,
    printed: !$("paper-code").hidden,
    sent: !$("serial-more").hidden,
  }));
  drawSteps("recv-steps", receiveSteps({
    pair: pairMode, read: readMode,
    code: typedCode ? formatTransferCode(typedCode) : undefined,
    handshake: Boolean(receiverSession),
    confirmed: receiverConfirmed,
    listening: Boolean(serialListening),
    progress: receiverDecoder ? collected(receiverDecoder) : 0,
    delivered: Boolean($("result").querySelector("a[download]")),
  }));
}
setInterval(renderFlow, 500);

function selectRoute(route: SendRoute): void {
  sendRoute = route;
  for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-route]"))) {
    button.setAttribute("aria-pressed", String(button.dataset.route === route));
  }
  $<HTMLDetailsElement>("paper-box").open = route === "paper";
  $<HTMLDetailsElement>("serial-send-box").open = route === "serial";
  renderFlow();
}
for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-route]"))) {
  button.onclick = () => {
    const route = button.dataset.route as SendRoute;
    if (route === "serial" && needsBusiness("Sending over a serial cable")) return;
    selectRoute(route);
  };
}
// Kullanıcı yolu seçmeden bölümü açarsa ya da düğmesine basarsa akış o yola geçer.
for (const [box, route] of [["paper-box", "paper"], ["serial-send-box", "serial"]] as const) {
  $<HTMLDetailsElement>(box).addEventListener("toggle", () => {
    if ($<HTMLDetailsElement>(box).open && sendRoute !== route) selectRoute(route);
  });
}

$("paper-code-hide").onclick = () => {
  $("paper-code").hidden = true;
  $("paper-code-hide").hidden = true;
  $("paper-note").textContent = "Code hidden. Without it the printed pages cannot be read, so make sure it is written down.";
  notify("Code hidden from the screen.", "ok");
};


// ---- sürekli tek yönlü akış: klasör izleme ----------------------------------------------
/**
 * Gözetimsiz gönderim: seçilen klasörde yeni ya da değişen her dosya, alıcı kartına
 * şifrelenir, imzalanır ve seri hatta gönderilir. Kod gerekmez (kart uzun ömürlüdür).
 * Yazımı süren dosya beklenir: son değişiklikten WATCH_SETTLE_MS geçmeden gönderilmez.
 * ponytail: klasör yoklanıyor (3 s); tarayıcıda dosya sistemi olay bildirimi yaygın değil.
 */
const WATCH_EVERY_MS = 3000;
const WATCH_SETTLE_MS = 2000;
let watchDir: FileSystemDirectoryHandle | undefined;
/** TypeScript'in DOM tanımında klasör yinelemesi yok; tarayıcılarda var (Chrome/Edge 86+). */
const entriesOf = (dir: FileSystemDirectoryHandle) =>
  (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
let watching: { stop: boolean; wake?: () => void } | undefined;

async function writeWire(writer: WritableStreamDefaultWriter<Uint8Array>, wire: Uint8Array): Promise<void> {
  const sessionId = globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  const blocks = Math.ceil(wire.length / SERIAL_BLOCK);
  const initial = systematicEncode(wire, SERIAL_BLOCK);
  const fountain = ltEncode(wire, SERIAL_BLOCK);
  for (let i = 0; i < blocks + Math.max(16, Math.ceil(blocks * 0.1)); i++) {
    const next = initial.next();
    const { seed, payload } = next.done ? fountain.next().value! : next.value;
    await writer.write(wrap(encodeFrame({ type: FrameType.Data, sessionId, seed, totalBytes: wire.length, blockSize: SERIAL_BLOCK, payload })));
  }
}

$("watch-folder").onclick = async () => {
  if (!serialReady("Watching a folder")) return;
  if (!folderSupported) {
    notify("Watching a folder works in Chrome or Edge on a computer.", "bad");
    return;
  }
  try {
    watchDir = await (window as unknown as { showDirectoryPicker(o: { mode: "read" }): Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker({ mode: "read" });
  } catch (error) {
    if ((error as Error).name !== "AbortError") notify(`The folder could not be used: ${(error as Error).message}`, "bad");
    return;
  }
  $("watch-start").hidden = false;
  $("watch-status").textContent = `Folder "${watchDir.name}" chosen. Now choose the serial port to start.`;
  notify(`Folder "${watchDir.name}" chosen. Press "Choose the serial port and start".`, "ok");
};

$("watch-start").onclick = () => {
  if (!serialReady("Watching a folder")) return;
  const card = installedCard;
  const folder = watchDir;
  if (!card) {
    notify("Load the receiving computer's receiver card first (\"Same receiver every time?\"): unattended sending needs it instead of a code.", "bad");
    return;
  }
  if (!folder) return;
  const context = requireContext();
  if (!context) return;
  const chosen = choosePort(); // tıklamanın içinde
  void (async () => {
    let port: SerialPortLike;
    try {
      port = await chosen;
      await port.open({ baudRate: Number($<HTMLSelectElement>("serial-baud").value) });
    } catch (error) {
      notify(portCancelled(error) ? "No serial port chosen. Nothing is being watched." : `The serial port could not be used: ${portProblem(error)}.`, portCancelled(error) ? "warn" : "bad");
      return;
    }
    const state: NonNullable<typeof watching> = { stop: false };
    watching = state;
    $("watch-start").hidden = true;
    $("watch-folder").hidden = true;
    $("watch-stop").hidden = false;
    const writer = port.writable!.getWriter();
    const seen = new Map<string, string>();
    const key = (file: File) => `${file.size}:${file.lastModified}`;
    let sent = 0, failure: unknown;
    try {
      if (!$<HTMLInputElement>("watch-existing").checked) {
        for await (const [name, handle] of entriesOf(folder)) {
          if (handle.kind === "file") seen.set(name, key(await (handle as FileSystemFileHandle).getFile()));
        }
      }
      $("watch-status").textContent = `Watching "${folder.name}". New files are sent as they appear.`;
      notify(`Watching "${folder.name}". Each new or changed file is sent over the cable to ${card.label}.`, "ok");
      while (!state.stop) {
        for await (const [name, handle] of entriesOf(folder)) {
          if (state.stop) break;
          if (handle.kind !== "file") continue;
          const file = await (handle as FileSystemFileHandle).getFile();
          if (!file.size || seen.get(name) === key(file) || Date.now() - file.lastModified < WATCH_SETTLE_MS) continue;
          const refusal = file.size > MAX_WEB_TRANSFER_BYTES ? `${name} is larger than this edition sends`
            : sitePolicy ? checkFile(sitePolicy, name, file.size) : undefined;
          seen.set(name, key(file));
          if (refusal) {
            notify(`Not sent: ${refusal}.`, "warn");
            continue;
          }
          const { wire, dispatch } = await sealOneWay(await identityPromise, card, { name, data: new Uint8Array(await file.arrayBuffer()) }, context);
          await writeWire(writer, wire);
          void logTransfer("sent", name, dispatch);
          sent++;
          $("watch-status").textContent = `Watching "${folder.name}" · ${sent} ${sent === 1 ? "file" : "files"} sent · last: ${name} at ${new Date().toLocaleTimeString()}`;
        }
        await new Promise<void>((resolve) => { state.wake = resolve; setTimeout(resolve, WATCH_EVERY_MS); });
      }
    } catch (error) {
      failure = error;
    }
    writer.releaseLock();
    try { await port.close(); } catch { /* zaten kapalı */ }
    if (watching === state) watching = undefined;
    $("watch-start").hidden = false;
    $("watch-folder").hidden = false;
    $("watch-stop").hidden = true;
    const summaryText = `${sent} ${sent === 1 ? "file was" : "files were"} sent.`;
    $("watch-status").textContent = failure ? `Stopped: ${portProblem(failure)}. ${summaryText}` : `Not watching. ${summaryText}`;
    if (failure) notify(`Watching stopped: ${portProblem(failure)}. ${summaryText} Check the cable and start again.`, "bad");
    else notify(`Stopped watching "${folder.name}". ${summaryText} The serial port is closed.`, "ok");
  })();
};

$("watch-stop").onclick = () => {
  if (!watching) return;
  watching.stop = true;
  watching.wake?.();
};

// ---- seri kablo --------------------------------------------------------------------
/**
 * Kamerasız, ekransız yol: Kionel çerçeveleri seri hatta (serial-link.ts). Tek
 * yönlü aktarımlarla (kod ya da alıcı kartı) çalışır; geri kanal gerekmez. Port
 * seçici kullanıcı tıklamasında, ilk await'ten önce açılır.
 */
interface SerialRun { port: SerialPortLike; baud: number; name: string; wire: Uint8Array; sessionId: number; blocks: number;
  initial: ReturnType<typeof systematicEncode>; fountain: ReturnType<typeof ltEncode>; sent: number; stopped: boolean }
let serialRun: SerialRun | undefined;

function serialReady(what: string): boolean {
  if (needsBusiness(what)) return false;
  if (!serialSupported()) {
    notify("Serial cables work in Chrome or Edge on a computer. Use the camera here, or open Kionel in Chrome or Edge.", "bad");
    return false;
  }
  return true;
}

async function pumpSerial(run: SerialRun, extra: number): Promise<void> {
  const target = run.sent + extra;
  const started = performance.now(), sentBefore = run.sent;
  $("serial-stop").hidden = false;
  $("serial-more").hidden = true;
  sendTimer.arm();
  sendTimer.start("Sending over the serial cable");
  let failure: unknown;
  try {
    await run.port.open({ baudRate: run.baud });
    const writer = run.port.writable!.getWriter();
    try {
      while (!run.stopped && run.sent < target) {
        const next = run.initial.next();
        const { seed, payload } = next.done ? run.fountain.next().value! : next.value;
        await writer.write(wrap(encodeFrame({ type: FrameType.Data, sessionId: run.sessionId, seed, totalBytes: run.wire.length, blockSize: SERIAL_BLOCK, payload })));
        run.sent++;
        if (run.sent % 8 === 0 || run.sent === target) {
          const seconds = (performance.now() - started) / 1000 || 1;
          $("send-stats").textContent = `${run.name} · serial cable, ${run.baud.toLocaleString("en")} baud\n` +
            `${run.sent} of ${target} frames · ${(((run.sent - sentBefore) * SERIAL_BLOCK) / 1024 / seconds).toFixed(1)} KB/s`;
        }
      }
    } finally {
      writer.releaseLock();
    }
  } catch (error) {
    failure = error;
  }
  try { await run.port.close(); } catch { /* zaten kapalı */ }
  $("serial-stop").hidden = true;
  const took = sendTimer.stop("Sent over the serial cable in");
  if (failure) {
    notify(`Sending over the serial cable failed: ${portProblem(failure)}. Check the cable and press "Send more" to continue.`, "bad");
    $("serial-more").hidden = false;
  } else if (run.stopped) {
    notify("Sending stopped. The serial port is closed; press \"Send more\" to continue the same transfer.", "ok");
    $("serial-more").hidden = false;
  } else {
    $("serial-more").hidden = false;
    notify(`${run.name}: ${run.sent} frames sent over the serial cable in ${took ?? "a moment"}. The receiver should now show the file. ` +
      "If it does not (it started listening late, or the line lost data), press \"Send more\".", "ok");
  }
}

$("serial-send").onclick = () => {
  if (!serialReady("Sending over a serial cable")) return;
  if (sendRoute !== "serial") selectRoute("serial");
  if (!selected) {
    notify("Choose a file first (step 2).", "bad");
    return;
  }
  const code = normalizeTransferCode($<HTMLInputElement>("typed-code").value);
  const card = installedCard;
  if (!code && !card) {
    notify("Type the code shown on the receiver above, or load its receiver card, then send over the cable.", "bad");
    $("typed-code").focus();
    return;
  }
  const context = requireContext();
  if (!context) return;
  const chosen = choosePort(); // seçici tıklamanın içinde açılmalı
  const file = selected;
  void (async () => {
    let port: SerialPortLike;
    try {
      port = await chosen;
    } catch (error) {
      notify(portCancelled(error) ? "No serial port chosen. Nothing was sent." : `The serial port could not be used: ${portProblem(error)}.`, portCancelled(error) ? "warn" : "bad");
      return;
    }
    try {
      const identity = await identityPromise;
      const { wire, dispatch } = code ? await sealWithCode(identity, code, file, context) : await sealOneWay(identity, card!, file, context);
      if (serialRun) serialRun.stopped = true;
      const blocks = Math.ceil(wire.length / SERIAL_BLOCK);
      serialRun = {
        port, baud: Number($<HTMLSelectElement>("serial-baud").value), name: file.name, wire,
        sessionId: globalThis.crypto.getRandomValues(new Uint32Array(1))[0], blocks,
        initial: systematicEncode(wire, SERIAL_BLOCK), fountain: ltEncode(wire, SERIAL_BLOCK), sent: 0, stopped: false,
      };
      $("dispatch-result").replaceChildren();
      offerDispatchRecord(dispatch);
      notify(`Sending ${file.name} over the serial cable. The receiver must be listening at the same speed.`, "ok");
      // Tam bir tur ve %10 (en az 16) yedek: temiz hatta alıcı ilk turda biter.
      await pumpSerial(serialRun, blocks + Math.max(16, Math.ceil(blocks * 0.1)));
    } catch (error) {
      notify(`The transfer could not be prepared: ${(error as Error).message}`, "bad");
    }
  })();
};

$("serial-more").onclick = () => {
  const run = serialRun;
  if (!run) return;
  run.stopped = false;
  // Geç başlayan alıcı için dosyanın tamamı kadar yeni fountain karesi.
  void pumpSerial(run, run.blocks + Math.max(16, Math.ceil(run.blocks * 0.1)));
};
$("serial-stop").onclick = () => {
  if (serialRun) serialRun.stopped = true;
};

let serialListening: { reader?: ReadableStreamDefaultReader<Uint8Array>; stopped: boolean } | undefined;

$("serial-listen").onclick = () => {
  if (!serialReady("Receiving over a serial cable")) return;
  if (pairMode === "camera") {
    notify("A serial cable carries data one way. In step 1 choose \"Sender has no camera — show a code\" or a receiver card.", "bad");
    return;
  }
  if (pairMode === "code" && !typedCode) $("code-show").click();
  if (pairMode === "card" && !oneWayKey) {
    notify("Create this device's receiver card first, and load it on the sender.", "bad");
    return;
  }
  const chosen = choosePort();
  void (async () => {
    let port: SerialPortLike;
    try {
      port = await chosen;
    } catch (error) {
      notify(portCancelled(error) ? "No serial port chosen." : `The serial port could not be used: ${portProblem(error)}.`, portCancelled(error) ? "warn" : "bad");
      return;
    }
    const baud = Number($<HTMLSelectElement>("recv-serial-baud").value);
    try {
      await port.open({ baudRate: baud, bufferSize: 1 << 20 });
    } catch (error) {
      notify(`The serial port could not be opened: ${portProblem(error)}.`, "bad");
      return;
    }
    const state: NonNullable<typeof serialListening> = { stopped: false };
    serialListening = state;
    deliveredSessions.clear();
    $("serial-listen").hidden = true;
    $("serial-unlisten").hidden = false;
    recvTimer.arm();
    notify(`Listening on the serial port at ${baud.toLocaleString("en")} baud. Start sending on the PC.`, "ok");
    $("recv-stats").textContent = "Listening on the serial cable…";
    const unwrapper = new Unwrapper();
    let frames = 0, files = 0, warned = false, delivered = false, failure: unknown;
    try {
      state.reader = port.readable!.getReader();
      while (!state.stopped) {
        const { value, done } = await state.reader.read();
        if (done) break;
        for (const frame of unwrapper.push(value)) {
          frames++;
          if (await onReceiverFrame(frame, frames, 0)) {
            const repeated = repeatedDelivery;
            repeatedDelivery = false;
            // Gözetimsiz akış: teslimden sonra port açık kalır, sıradaki dosya beklenir.
            if ($<HTMLInputElement>("serial-keep").checked && !state.stopped) {
              if (!repeated) files++;
              $("recv-stats").textContent += `\nListening for the next file · ${files} received so far.`;
              continue;
            }
            delivered = true;
            break;
          }
        }
        if (delivered) break;
        if (!frames && !warned && unwrapper.discarded > 4096) {
          warned = true;
          notify("Data is arriving on the cable, but no Kionel frames. Check that both sides use the same speed.", "warn");
        }
      }
    } catch (error) {
      if (!state.stopped) failure = error;
    }
    try { await state.reader?.cancel(); } catch { /* yok */ }
    state.reader?.releaseLock();
    try { await port.close(); } catch { /* zaten kapalı */ }
    if (serialListening === state) serialListening = undefined;
    $("serial-listen").hidden = false;
    $("serial-unlisten").hidden = true;
    if (failure) notify(`The serial connection stopped: ${portProblem(failure)}. What arrived so far is kept; listen again to continue.`, "bad");
    else if (state.stopped && !delivered) notify(files
      ? `Stopped listening. ${files} ${files === 1 ? "file was" : "files were"} received; the serial port is closed.`
      : "Stopped listening. The serial port is closed; what arrived so far is kept.", "ok");
  })();
};

$("serial-unlisten").onclick = () => {
  const state = serialListening;
  if (!state) return;
  state.stopped = true;
  void state.reader?.cancel().catch(() => undefined);
};

// ---- yenilikler paneli ---------------------------------------------------------
const WHATS_NEW_KEY = "kionel.whats-new.2026-09";
try { $("whats-new").hidden = localStorage.getItem(WHATS_NEW_KEY) === "seen"; } catch { $("whats-new").hidden = false; }
$("whats-new-close").onclick = () => {
  $("whats-new").hidden = true;
  try { localStorage.setItem(WHATS_NEW_KEY, "seen"); } catch { /* yalnız bu oturum için gizlenir */ }
};

const CODE_KEY = "kionel.transfer-code.v1";
const CODE_TTL_MS = 24 * 60 * 60 * 1000;
try {
  const saved = JSON.parse(sessionStorage.getItem(CODE_KEY) ?? "null") as { code: string; at: number } | null;
  if (saved && Date.now() - saved.at < CODE_TTL_MS) typedCode = saved.code;
} catch { /* yok */ }

$("code-show").onclick = () => {
  recvTimer.arm();
  typedCode = createTransferCode();
  // Aynı sekmede sayfa yenilense de kod kalır: kayıt sonradan okunabilir. Kod
  // yalnız bu sekmede, 24 saat tutulur; yeni kod eskisinin yerine geçer.
  try { sessionStorage.setItem(CODE_KEY, JSON.stringify({ code: typedCode, at: Date.now() })); } catch { /* yok */ }
  const display = $("code-display");
  display.textContent = formatTransferCode(typedCode);
  display.hidden = false;
  offerCanvas.hidden = true;
  $("code-show").textContent = "Show a new code";
  $("recv-stats").textContent =
    "Type this code on the sending PC and press Send with this code.\nThen point this camera at the PC screen.";
};

/** Anahtarı silmek, o anahtar için üretilmiş her kartı geçersiz kılar. */
$("card-retire").onclick = async () => {
  if (!confirm("Retire this device's card key? Every receiver card made so far stops working.")) return;
  try {
    await writeStored(RECEIVER_KEY_ID, undefined);
    oneWayKey = undefined;
    $("card-note").textContent = "Card key retired. Old cards no longer open here. Create a new card when needed.";
    notify($("card-note").textContent!, "ok");
  } catch (error) {
    notify(`The card key could not be retired: ${(error as Error).message}`, "bad");
  }
};

$("card-create").onclick = async () => {
  if (needsBusiness("A receiver card")) return;
  const note = $("card-note");
  const label = $<HTMLInputElement>("card-label").value.trim();
  if (!label) {
    note.textContent = "Give this device a name first, so the sender shows where the file goes.";
    notify(note.textContent, "bad");
    return;
  }
  try {
    const identity = await identityPromise;
    // Kalıcı kimlik yoksa kart, sayfa kapanınca işe yaramaz hâle gelir.
    if (!identityPersistent) throw new Error("this browser does not allow a permanent key (private window?)");
    let key = await readStored<ReceiverKey>(RECEIVER_KEY_ID);
    if (!key) {
      key = await createReceiverKey();
      await writeStored(RECEIVER_KEY_ID, key);
    }
    oneWayKey = key;
    const card = await issueReceiverCard(identity, key, label);
    note.replaceChildren();
    addDownload(note, new TextEncoder().encode(JSON.stringify(card, null, 2)),
      `kionel-receiver-card-${safeBase(label)}.json`, "Download receiver card");
    note.append(" Load it on the sender once. This page now also listens for that sender.");
    notify("Receiver card created. Download it and load it once on the sending PC. " +
      "The card belongs to this browser: if its data is cleared, create a new card and load it on the PC again.", "ok");
  } catch (error) {
    note.textContent = `The card could not be created: ${(error as Error).message}`;
    notify(note.textContent, "bad");
  }
};

/** Sonuç ekranda kalır; bir sonraki aktarım temiz bir durumla başlar. */
/**
 * Toplanmış ama açılamamış zarf (kod yok ya da yanlış). Doğru kod girilince yeniden
 * taramadan açılır.
 */
let heldWire: Uint8Array | undefined;
let paperLimitWarned = false;
/** Bekletilen aktarımın kareleri yeniden toplanmaz: kamera aynı sayfaları görmeye devam eder. */
let heldSession: number | undefined;

function holdForCode(received: Uint8Array, message: string): false {
  heldWire = received;
  heldSession = oneWaySession;
  resetOneWayReceiver();
  $("result").replaceChildren(Object.assign(document.createElement("p"), { textContent: message, className: "warn" }));
  notify(message, "warn");
  if (pairMode === "paper") showStepTarget("code-enter");
  return false;
}

function resetOneWayReceiver(): void {
  oneWaySession = undefined;
  receiverDecoder = undefined;
  useful = 0;
  decoded = 0;
  tried = 0;
  transferStartedAt = 0;
  foreignFrames.clear();
}

/**
 * Kamerasız gönderenden gelen zarfı açar; kanıt çift yönlü akıştakiyle aynıdır.
 * Açılamazsa kamera açık kalır: gönderen kodu düzeltip yeniden başlatabilir.
 */
async function finishOneWay(received: Uint8Array): Promise<boolean> {
  const result = $("result");
  try {
    const wire = owned(received);
    let opened;
    if (isCodeWire(wire)) {
      if (!typedCode) {
        return holdForCode(received, "Every code needed has been read. Enter the code for these pages to open the file; nothing more needs scanning.");
      }
      // Basılı sayfa ve kayıt tekrar okunmadan doğru kodla açılabilir; canlı aktarımda ise
      // gönderen yanlış kod yazmıştır ve yeniden göndermesi gerekir (aşağıdaki ret yolu).
      const keep = pairMode === "paper" || readingRecording;
      try {
        opened = await openWithCode(typedCode, wire);
      } catch (error) {
        if (!keep) throw error;
        return holdForCode(received, `The code ${formatTransferCode(typedCode)} does not open this file. ` +
          (pairMode === "paper" ? "Enter the right code" : "Type the right one in \"Code used for this recording or these pages\"") +
          ": what was read is kept, so nothing needs scanning again.");
      }
      heldWire = undefined;
      heldSession = undefined;
    } else {
      if (!oneWayKey) throw new Error("this transfer was sealed for a receiver card this device does not hold");
      opened = await openOneWay(oneWayKey, wire);
    }
    // Gönderen bir sertifikayla tanınmaz: kaydın adını verdiği cihaz anahtarı ya bu
    // cihazda sabitlenmiştir ya da (liste boşsa) kabul edilip kayda geçer.
    await requireAcceptedSender(opened.dispatch.sender);
    // Gözetimsiz kablo bağlantısında eski bir aktarımın bayt bayt tekrarı yeni bir teslim
    // üretmemeli. Kayıt ve basılı sayfa bilerek yeniden okunabilir; orada bu denetim yok.
    if (serialListening) {
      const earlier = alreadyReceived(await readLog(), opened.dispatch);
      if (earlier) {
        const note = `${opened.name} was already received on ${new Date(earlier.at).toLocaleString()} with the same signed dispatch. ` +
          "It was not delivered again.";
        result.replaceChildren(Object.assign(document.createElement("p"), { textContent: note, className: "hint-note" }));
        notify(note, "warn");
        if (oneWaySession !== undefined) deliveredSessions.add(oneWaySession);
        repeatedDelivery = true;
        resetOneWayReceiver();
        return true;
      }
    }
    const receipt = await issueReceipt(await identityPromise, {
      session: opened.dispatch.session,
      content: opened.data,
      sender: unb64(opened.dispatch.sender),
      dispatch: opened.dispatch,
    });
    const verdict = await verifyReceipt(receipt, opened.data);
    if (!verdict.ok) throw new Error(`delivery evidence not verified: ${explainReason(verdict.reason)}`);
    const ledger = isBusiness() ? await appendAudit(receipt, "receipt-verified") : undefined;
    showDelivery(result, opened.dispatch, opened, receipt, ledger);
    recvVideo.hidden = true;
    $("recv-stats").textContent += "\nTransfer verified. The sender has no camera, so keep the receipt here with the file.";
    if (oneWaySession !== undefined) deliveredSessions.add(oneWaySession);
    resetOneWayReceiver();
    return true;
  } catch (error) {
    const refusedSession = oneWaySession;
    rejectedSessions.add(oneWaySession!);
    oneWaySession = undefined;
    receiverDecoder = undefined;
    useful = 0;
    decoded = 0;
    tried = 0;
    transferStartedAt = 0;
    $("bar").style.width = "0%";
    const refused = (error as { senderKey?: string }).senderKey;
    const rejected = `Transfer rejected: ${(error as Error).message}.${refused ? "" : " Still listening — start the transfer again on the sender."}`;
    result.replaceChildren(Object.assign(document.createElement("p"), { textContent: rejected, className: "bad" }));
    // Gönderen kabul edilince aynı aktarımın devamı ("Send more") yeniden dinlenir.
    if (refused) addPinButton(result, refused, "", () => { if (refusedSession !== undefined) rejectedSessions.delete(refusedSession); });
    notify(rejected, "bad");
    return false;
  }
}

$("recv-confirm").onclick = () => {
  receiverConfirmed = true;
  if (pendingColourFile) {
    const bytes = pendingColourFile;
    pendingColourFile = undefined;
    queueMicrotask(() => void deliverColourFile(bytes));
  }
  $("recv-confirm").hidden = true;
  $("recv-sas").hidden = true;
  $("recv-stats").textContent = "Secure channel verified. Waiting for the sender's data QR…";
};

function drawReceiverAck(decoder: LtDecoder, decodeMs: number): void {
  const missing = decoder.missingRanges();
  const receivedBlocks = decoder.k - missing.reduce((total, range) => total + range.end - range.start, 0);
  const payload = encodeAck({
    sequence: ++ackSequence,
    receivedBlocks,
    totalBlocks: decoder.k,
    decodeMicros: Math.max(0, Math.round(decodeMs * 1000)),
    missing: compactRanges(missing, 170),
    complete: decoder.done,
  });
  const wire = encodeFrame({
    type: FrameType.Ack,
    sessionId: receiverSession!.sessionId,
    seed: ackSequence,
    totalBytes: decoder.totalBytes,
    blockSize: decoder.blockSize,
    payload,
  });
  if (wire.length > frameBytes(27)) return; // fountain fallback akışı tamamlamaya devam eder
  drawFrame(offerCanvas, wire, { version: 27 });
  offerCanvas.hidden = false;
  lastAckAt = performance.now();
}

/** Çok parçalı eksik listesini, alınmış küçük boşlukları da isteyerek QR'a sığdırır. */
function compactRanges(ranges: { start: number; end: number }[], limit: number): { start: number; end: number }[] {
  const result = ranges.map((range) => ({ ...range }));
  while (result.length > limit) {
    let best = 0;
    let smallestGap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < result.length - 1; i++) {
      const gap = result[i + 1].start - result[i].end;
      if (gap < smallestGap) {
        smallestGap = gap;
        best = i;
      }
    }
    result[best].end = result[best + 1].end;
    result.splice(best + 1, 1);
  }
  return result;
}

/**
 * Toplanan kısım. Fountain kodda bloklar çoğunlukla sonda, birden çözülür;
 * yalnız çözülmüş blokları saymak ilerlemeyi sona kadar %1–5'te gösterir ve
 * kullanıcı aktarımı takılmış sanar. Alınan yararlı kod sayısı gerçek ilerlemedir.
 * ~%8 fazlası beklenir; tamamlanana kadar %99'da tutulur.
 */
function collected(decoder: LtDecoder): number {
  if (decoder.done) return 1;
  return Math.min(0.99, Math.max(decoder.progress, useful / (decoder.k * 1.08)));
}

let receiverRenderedAt = 0;

function renderReceiver(decoder: LtDecoder, captured: number): void {
  // Saniyede en çok beş kez: her karede yerleşim hesaplatmak ana iş parçacığını kareye yetiştirmiyordu.
  if (!decoder.done && performance.now() - receiverRenderedAt < 200) return;
  receiverRenderedAt = performance.now();
  const secs = (performance.now() - transferStartedAt) / 1000 || 1;
  $("bar").style.width = `${(collected(decoder) * 100).toFixed(1)}%`;
  $("recv-stats").textContent =
    `${(collected(decoder) * 100).toFixed(1)}% · ${decoder.k} blocks · ${kb(decoder.totalBytes)} encrypted\n` +
    `captured ${captured} · tried ${tried} · decoded ${decoded} (${(decoded / secs).toFixed(1)}/s) · useful ${useful}\n` +
    `speed ${((useful * decoder.blockSize) / 1024 / secs).toFixed(1)} KB/s`;
}

async function finishReceive(received: Uint8Array): Promise<void> {
  const result = $("result");
  try {
    const outer = unpackSecureEnvelope(received);
    if (!outer) throw new Error("the secure transfer envelope could not be opened");
    const dispatch = JSON.parse(outer.metadata) as Dispatch;
    const opened = await receiverSession!.open(owned(outer.sealed));
    // Eski sürüm sıkıştırmadan gönderir; ilk bayt ikisini ayırır.
    const file = unpack(isShrunk(opened) ? await expand(opened, MAX_WEB_TRANSFER_BYTES + 1024) : opened);
    if (!file || !file.intact) throw new Error("the file envelope failed its integrity check");

    // Her bütünlük kontrolü geçtiği hâlde içerik yanlışsa bu kanalın değil kodun
    // hatasıdır ve tek bir tanesi bile fiziksel qualification kapısını kapatır.
    if (await matrixContentMismatch(file.name, file.data)) {
      noteSilentCorruption();
      throw new Error("SILENT CORRUPTION: content does not match the expected matrix payload");
    }

    const dispatchVerdict = await verifyDispatch(dispatch, owned(file.data));
    if (!dispatchVerdict.ok || dispatch.session !== receiverSession!.sessionId || dispatch.sender !== b64(receiverSession!.peer)) {
      throw new Error(`dispatch record not verified: ${explainReason(dispatchVerdict.reason)}`);
    }
    await requireAcceptedSender(dispatch.sender);

    const receipt = await issueReceipt(await identityPromise, {
      session: receiverSession!.sessionId,
      content: owned(file.data),
      sender: receiverSession!.peer,
      dispatch,
    });
    const verdict = await verifyReceipt(receipt, owned(file.data));
    if (!verdict.ok) throw new Error(`delivery evidence not verified: ${explainReason(verdict.reason)}`);
    const ledger = isBusiness() ? await appendAudit(receipt, "receipt-verified") : undefined;
    const seconds = (performance.now() - transferStartedAt) / 1000 || 1;
    closeQualificationAttempt(true, file.data.length / 1024 / seconds);

    showDelivery(result, dispatch, file, receipt, ledger);
    // Matris koşusunda kamera açık kalmalı; makbuz QR'ı görüntüyü kapatırdı.
    if (!qualificationEnabled && isBusiness() && soundPairedSession) {
      // Sesle eşleşen gönderenin kamerası yok: makbuz QR'ını okuyamaz, sesle duyar.
      soundReceipt = packSoundReceipt({ session: receipt.session, at: receipt.at, signature: unb64(receipt.sig) });
      $("receipt-play").hidden = false;
      $("recv-stats").textContent += "\nTransfer verified. The sender has no camera: play the delivery receipt as sound.";
      void playReceipt();
    } else if (!qualificationEnabled && isBusiness()) {
      const receiptWire = new TextEncoder().encode(JSON.stringify(receipt));
      if (receiptWire.length > frameBytes(27)) throw new Error("the receipt exceeds QR capacity");
      drawFrame(offerCanvas, receiptWire, { version: 27 });
      offerCanvas.hidden = false;
      recvVideo.hidden = true;
      $("recv-stats").textContent += "\nTransfer verified. Show the receipt QR to the sender.";
    }
  } catch (error) {
    closeQualificationAttempt(false);
    result.replaceChildren(Object.assign(document.createElement("p"), {
      textContent: `Transfer rejected: ${(error as Error).message}`,
      className: "bad",
    }));
    const refused = (error as { senderKey?: string }).senderKey;
    if (refused) addPinButton(result, refused, "");
    notify(`Transfer rejected: ${(error as Error).message}`, "bad");
  }
}

/**
 * Yazdırılabilir rapor. Kayıt, rapora girmeden önce bağımsız olarak yeniden
 * doğrulanır: rapor, aktarım ekranının söylediğini değil, kaydın kendisini yansıtır.
 */
function addReportButton(parent: HTMLElement, record: unknown, file: { name: string; data: Uint8Array }, label: string): void {
  const button = Object.assign(document.createElement("button"), { type: "button", textContent: label, className: "report-button" });
  button.onclick = async () => printEvidence(await inspectEvidence(JSON.parse(JSON.stringify(record)), owned(file.data), file.name));
  parent.append(button);
}

function showDelivery(
  result: HTMLElement,
  dispatch: Dispatch,
  file: { name: string; data: Uint8Array },
  receipt: Awaited<ReturnType<typeof issueReceipt>>,
  ledger: unknown,
  verified = "Encryption integrity and both signatures verified.",
): void {
  const took = recvTimer.stop("Received in");
  const inTime = took ? ` Time from the first code: ${took}.` : "";
    result.replaceChildren();
    if (dispatch.context) result.append(signedContextCard(dispatch.context));
    addDownload(result, file.data, file.name, `${file.name} — download (${kb(file.data.length)})`);
    if (!isBusiness()) {
      result.append(Object.assign(document.createElement("p"), {
        textContent: "The file arrived encrypted and intact.",
        className: "ok",
      }));
      businessNote(result, BUSINESS_NOTE);
      notify(`${file.name} received and checked. Download it below.${inTime}`, "ok");
      return;
    }
    void finishBusinessDelivery(result, file, receipt, ledger, inTime, verified);
}

/** İşletme teslimi: istenirse önce damga, sonra indirme, rapor ve klasöre kayıt — tek makbuz. */
async function finishBusinessDelivery(
  result: HTMLElement,
  file: { name: string; data: Uint8Array },
  signed: Receipt,
  ledger: unknown,
  inTime: string,
  verified: string,
): Promise<void> {
    let receipt: Receipt = signed;
    let stampNote = "";
    let stampFailed = false;
    if (tsaBox.checked) {
      $("recv-stats").textContent = "Getting a trusted timestamp from DigiCert…";
      const stamped = await stampReceipt(signed);
      if ("error" in stamped) {
        stampFailed = true;
        stampNote = ` No trusted timestamp: ${stamped.error}. The receipt is valid with the devices' own times.`;
      } else {
        receipt = stamped.receipt;
        stampNote = ` Trusted time from DigiCert: ${stamped.at}.`;
      }
    }
    void logTransfer("received", file.name, receipt);
    const receiptJson = new TextEncoder().encode(JSON.stringify(receipt, null, 2));
    addDownload(result, receiptJson, `${safeBase(file.name)}.makbuz.json`, "Download the dual-signed delivery receipt", true);
    if (ledger) addDownload(
      result,
      new TextEncoder().encode(JSON.stringify(ledger, null, 2)),
      "kionel-audit-ledger.json",
      "Download the signed audit chain",
      true,
    );
    result.append(Object.assign(document.createElement("p"), { textContent: verified, className: "ok" }));
    addReportButton(result, receipt, file, "Print transfer report / save as PDF");
    addPinButton(result, receipt.sender, file.name);
    const delivered = `${file.name} received and verified. Download the file and its receipt below.${inTime}${stampNote}`;
    notify(delivered, stampFailed ? "warn" : "ok");
    // Klasöre kayıt bildirimi teslim bildiriminin yerini alır; damga sonucu onda da söylenir.
    void saveDelivery(file, receipt, receiptJson, stampNote, stampFailed);
}

// ---- klasöre kayıt -------------------------------------------------------------
/**
 * Alan bilgisayarda gelen dosya ve makbuz seçilen klasöre kendiliğinden yazılır.
 * Elle indirip taşıma adımı zincirin koptuğu yerdi: dosya orada Excel'de açılıp
 * yeniden kaydediliyordu. LIMS'in izlediği klasör seçilirse zincir kapanır.
 * Yalnız Chrome/Edge masaüstü (File System Access); klasör bağlantısı kimlik
 * veritabanında saklanır, izin her oturumda tarayıcıya yeniden sorulabilir.
 */
const FOLDER_KEY = "save-folder-v1";
let saveFolder: FileSystemDirectoryHandle | undefined;
const folderSupported = "showDirectoryPicker" in window;

async function renderFolder(): Promise<void> {
  $("folder-clear").hidden = !saveFolder;
  const allowed = saveFolder ? await folderWritable(saveFolder, false).catch(() => false) : false;
  $("folder-choose").textContent = !saveFolder ? "Save received files to a folder…"
    : allowed ? "Choose another folder…" : `Allow saving to "${saveFolder.name}"`;
  $("folder-naming").hidden = !folderSupported;
  if (!folderSupported) {
    $("folder-choose").hidden = true;
    $("folder-status").textContent = "Saving straight to a folder works in Chrome or Edge on a computer. " +
      "Here, download each file and receipt with the buttons that appear on delivery.";
  } else if (saveFolder && !allowed) {
    $("folder-status").textContent = `The browser asks again for "${saveFolder.name}" after it restarts. Press the button ` +
      "above once; until then, received files are only offered for download.";
  } else if (saveFolder) {
    $("folder-status").textContent = `Saving to the folder "${saveFolder.name}": each received file and its signed receipt ` +
      "are written there on delivery. Existing files are never overwritten.";
  }
}

async function folderWritable(folder: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const handle = folder as FileSystemDirectoryHandle & {
    queryPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
    requestPermission(o: { mode: "readwrite" }): Promise<PermissionState>;
  };
  if (await handle.queryPermission({ mode: "readwrite" }) === "granted") return true;
  return ask && await handle.requestPermission({ mode: "readwrite" }) === "granted";
}

$("folder-choose").onclick = async () => {
  if (needsBusiness("Saving received files to a folder")) return;
  try {
    // Kayıtlı klasörün izni düştüyse önce onu geri iste (düğmeye basış gerekir).
    if (saveFolder && !(await folderWritable(saveFolder, false))) {
      if (await folderWritable(saveFolder, true)) {
        await renderFolder();
        notify(`Saving to "${saveFolder.name}" is allowed again.`, "ok");
        return;
      }
    }
    const folder = await (window as unknown as { showDirectoryPicker(o: { mode: "readwrite" }): Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker({ mode: "readwrite" });
    saveFolder = folder;
    await writeStored(FOLDER_KEY, folder).catch(() => { /* yalnız bu oturum için */ });
    await renderFolder();
    notify(`Received files will be saved to "${folder.name}", each with its signed receipt.`, "ok");
  } catch (error) {
    if ((error as Error).name === "AbortError") return;
    notify(`The folder could not be used: ${(error as Error).message}`, "bad");
  }
};

$("folder-clear").onclick = async () => {
  const name = saveFolder?.name;
  saveFolder = undefined;
  await writeStored(FOLDER_KEY, undefined).catch(() => { /* yok */ });
  await renderFolder();
  $("folder-status").textContent = "Received files are no longer saved to a folder; download them with the buttons on delivery.";
  notify(`Stopped saving to "${name}". Files already saved there stay.`, "ok");
};

/** Gönderenden gelen ad klasörde geçerli olmalı: Windows'un yasak karakterleri ve sondaki nokta/boşluk gider. */
function folderSafe(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").slice(0, 200);
  return cleaned || "received-file";
}

/** Aynı ad varsa üzerine yazmaz: "ad (2).uzantı" dener. */
async function freeName(folder: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try { await folder.getFileHandle(candidate); } catch { return candidate; }
  }
  throw new Error("too many files with this name in the folder");
}

async function writeToFolder(folder: FileSystemDirectoryHandle, name: string, data: Uint8Array): Promise<string> {
  const target = await freeName(folder, name);
  const handle = await folder.getFileHandle(target, { create: true });
  // İçerik .crswap dosyasına yazılır, kapanınca tek seferde yerine geçer: yarım dosya görülmez,
  // ama hedef dosya bu arada boş olarak durur.
  // ponytail: izleyici boş dosyayı almasın diye rehber "boş değil ve sabit" beklemeyi söylüyor; gerekirse ara klasör + move().
  const stream = await handle.createWritable();
  await stream.write(data as BlobPart);
  await stream.close();
  return target;
}

async function saveDelivery(
  file: { name: string; data: Uint8Array },
  receipt: Receipt,
  receiptJson: Uint8Array,
  note = "",
  warn = false,
): Promise<void> {
  const folder = saveFolder;
  if (!folder) return;
  try {
    if (!(await folderWritable(folder, false))) {
      notify(`Not saved to "${folder.name}": the browser needs your permission again. Press "Allow saving" ` +
        "above; this file and its receipt are available to download below.", "warn");
      await renderFolder();
      return;
    }
    const context = receipt.dispatch?.context;
    const name = applyTemplate(folderTemplate, { name: file.name, at: new Date(receipt.at), ...context });
    const savedFile = await writeToFolder(folder, folderSafe(name), file.data);
    // Makbuz adı dosya adını birebir izler: izleyen sistem ikisini adından eşleştirir.
    const savedReceipt = await writeToFolder(folder, `${savedFile}.makbuz.json`, receiptJson);
    notify(`${savedFile} and ${savedReceipt} saved to "${folder.name}".${note}`, warn ? "warn" : "ok");
  } catch (error) {
    notify(`Could not save to "${folder.name}": ${(error as Error).message}. Download the file and receipt below instead.`, "bad");
  }
}

/**
 * Klasördeki dosya adı şablonu (file-template.ts). Boşsa gönderenin adı kalır.
 * İçerik yok, yalnız biçim; localStorage'da (GIZLILIK §5).
 */
const TEMPLATE_KEY = "kionel.folder-template.v1";
let folderTemplate = "{name}";
try {
  const saved = localStorage.getItem(TEMPLATE_KEY);
  if (saved && !checkTemplate(saved)) folderTemplate = saved;
} catch { /* varsayılan */ }
$<HTMLInputElement>("folder-template").value = folderTemplate === "{name}" ? "" : folderTemplate;

$<HTMLInputElement>("folder-template").onchange = (event) => {
  const input = event.target as HTMLInputElement;
  const value = input.value.trim();
  if (!value || value === "{name}") {
    folderTemplate = "{name}";
    input.value = "";
    input.removeAttribute("aria-invalid");
    try { localStorage.removeItem(TEMPLATE_KEY); } catch { /* yok */ }
    notify("Files saved to the folder keep the sender's file name.", "ok");
    return;
  }
  const problem = checkTemplate(value);
  if (problem) {
    input.setAttribute("aria-invalid", "true");
    notify(`File-name pattern not changed: ${problem}. Files keep being named "${folderTemplate}".`, "bad");
    return;
  }
  folderTemplate = value;
  input.removeAttribute("aria-invalid");
  try { localStorage.setItem(TEMPLATE_KEY, value); } catch { /* yalnız bu oturum */ }
  const example = applyTemplate(value, { name: "results.csv", at: new Date(), reference: "WO-004213", classification: "confidential", operator: "QC-017" });
  notify(`Files saved to the folder will be named like ${folderSafe(example)}, with the receipt as ${folderSafe(example)}.makbuz.json.`, "ok");
};

void (async () => {
  if (folderSupported) {
    saveFolder = await readStored<FileSystemDirectoryHandle>(FOLDER_KEY).catch(() => undefined) ?? undefined;
  }
  await renderFolder();
})();

// ---- kabul edilen gönderenler ---------------------------------------------------------
/**
 * Alıcı, dosyayı imzalayan anahtarı sabitleyebilir: liste boşken her gönderen kabul
 * edilir, bir gönderen sabitlenince yalnız listedekiler (trusted-senders.ts). Liste
 * kimlik veritabanında durur; lisans bitse de uygulanır, çünkü bir güvenlik ayarı
 * sessizce gevşememeli.
 */
const SENDERS_KEY = "trusted-senders-v1";
let trustedSenders: TrustedSender[] = [];
/** Son tek yönlü teslim, daha önce alınmış bir sevkin tekrarıydı. */
let repeatedDelivery = false;
const sendersReady = readStored<TrustedSender[]>(SENDERS_KEY).catch(() => undefined).then((stored) => {
  trustedSenders = Array.isArray(stored) ? stored : [];
  renderSenders();
});

function renderSenders(): void {
  const count = trustedSenders.length;
  $("senders-clear").hidden = count === 0;
  $("senders-status").textContent = count === 0
    ? "This device accepts files from any sender and records which key signed each one. After a delivery you can choose to accept only that sender."
    : `This device accepts files only from ${count === 1 ? "one pinned sender" : `${count} pinned senders`}: ` +
      `${trustedSenders.map((sender) => senderShort(sender.key)).join(", ")}. A file signed by any other key is refused.`;
}

async function requireAcceptedSender(key: string): Promise<void> {
  await sendersReady;
  // Liste her teslimde yeniden okunur: başka bir sekmede sabitlenen gönderen burada da geçerli olmalı.
  const stored = await readStored<TrustedSender[]>(SENDERS_KEY).catch(() => undefined);
  if (Array.isArray(stored) && stored.map((sender) => sender.key).join() !== trustedSenders.map((sender) => sender.key).join()) {
    trustedSenders = stored;
    renderSenders();
  }
  if (isAccepted(trustedSenders, key)) return;
  throw Object.assign(new Error(`it was signed by sender ${senderShort(key)}, which is not ${trustedSenders.length === 1 ? "the sender" : "one of the senders"} ` +
    "this device accepts. Nothing was saved. If this sender should be accepted too, press the button below and send the file again"), { senderKey: key });
}

function addPinButton(parent: HTMLElement, key: string, file: string, onPinned?: () => void): void {
  if (trustedSenders.some((sender) => sender.key === key)) return;
  const button = Object.assign(document.createElement("button"), {
    type: "button", className: "secondary", id: "sender-pin",
    textContent: trustedSenders.length ? `Accept this sender too (${senderShort(key)})` : `Accept only this sender from now on (${senderShort(key)})`,
  });
  button.onclick = async () => {
    if (needsBusiness("Accepting only pinned senders")) return;
    if (!identityPersistent) {
      notify("This browser cannot keep the list: secure storage is unavailable, so the sender cannot be pinned here.", "bad");
      return;
    }
    try {
      const next = pinSender(trustedSenders, key, new Date().toISOString(), file);
      await writeStored(SENDERS_KEY, next);
      trustedSenders = next;
      onPinned?.();
      button.remove();
      renderSenders();
      notify(`From now on this device accepts files only from ${next.length === 1 ? "this sender" : `${next.length} pinned senders`}. ` +
        `Pinned: ${senderShort(key)}. A file signed by any other key is refused.${file ? "" : " Send the refused file again."}`, "ok");
    } catch (error) {
      notify(`The sender could not be pinned: ${(error as Error).message}.`, "bad");
    }
  };
  parent.append(button);
}

$("senders-clear").onclick = async () => {
  const count = trustedSenders.length;
  try {
    await writeStored(SENDERS_KEY, []);
    trustedSenders = [];
    renderSenders();
    notify(`This device accepts files from any sender again. ${count === 1 ? "The pinned sender was" : `${count} pinned senders were`} removed from the list.`, "ok");
  } catch (error) {
    notify(`The list could not be cleared: ${(error as Error).message}.`, "bad");
  }
};

// ---- site politikası ------------------------------------------------------------------
/**
 * Kalite ya da BT biriminin dosyası: izin verilen türler, boyut, iş emri biçimi,
 * sınıflar. Gönderen tarafta uygulanır; hangi politikanın etkin olduğu her
 * aktarımda günlüğe yazılır (site-policy.ts).
 */
const POLICY_KEY = "kionel.site-policy.v1";
let sitePolicy: SitePolicy | undefined;
try {
  const saved = localStorage.getItem(POLICY_KEY);
  if (saved) sitePolicy = parsePolicy(saved);
} catch { sitePolicy = undefined; }

function renderPolicy(): void {
  $("policy-forget").hidden = !sitePolicy;
  markFileButton("policy-file", sitePolicy ? `✓ ${policyLabel(sitePolicy)} — load a different policy` : undefined, "Load site policy");
  if (sitePolicy) $("policy-status").textContent = `${describePolicy(sitePolicy)} Files and work orders that do not match are refused before sending.`;
}
renderPolicy();

$<HTMLInputElement>("policy-file").onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await licenseReady;
  if (needsBusiness("A site policy")) return;
  try {
    const text = await file.text();
    const policy = parsePolicy(text);
    try { localStorage.setItem(POLICY_KEY, text); } catch { /* yalnız bu oturum */ }
    sitePolicy = policy;
    renderPolicy();
    notify(`${describePolicy(policy)} It now applies to every file sent from this browser.`, "ok");
  } catch (error) {
    notify(`That site policy was not loaded: ${(error as Error).message}.`, "bad");
  }
};

$("policy-forget").onclick = () => {
  if (!sitePolicy) return;
  if (!confirm(`Remove the site policy "${policyLabel(sitePolicy)}"? Files will no longer be checked against it. ` +
    "The transfer log records which policy, if any, applied to each transfer.")) return;
  const name = policyLabel(sitePolicy);
  sitePolicy = undefined;
  try { localStorage.removeItem(POLICY_KEY); } catch { /* yok */ }
  renderPolicy();
  $("policy-status").textContent = "No site policy: files are checked only against the edition's limits.";
  notify(`Site policy "${name}" removed from this browser.`, "ok");
};

// ---- aktarım günlüğü ------------------------------------------------------------------
/**
 * İşletme lisansıyla her gönderim, teslim ve mühür imzalı kaydıyla bu tarayıcıda
 * tutulur; dönemsel denetim kaydı incelemesi buradan yapılır. Silme düğmesi yok:
 * denetim kaydı kullanıcı elinde silinebilir olmamalı. Tarayıcı verisi
 * silinirse gider; imzalı kayıtlar indirildikleri yerde geçerli kalır.
 */
const LOG_KEY = "transfer-log-v1";

async function readLog(): Promise<LogEntry[]> {
  return (await readStored<LogEntry[]>(LOG_KEY).catch(() => undefined)) ?? [];
}

async function logTransfer(kind: LogKind, file: string, record: Dispatch | Receipt): Promise<void> {
  if (!isBusiness() || !identityPersistent) return;
  const append = async () => {
    const entries = await readLog();
    if (entries.length >= LOG_LIMIT) {
      notify(`The transfer log on this device is full (${LOG_LIMIT} entries). Export it for your records; new transfers ` +
        "are no longer added to it, and their signed records stay valid.", "warn");
      return;
    }
    await writeStored(LOG_KEY, [...entries, entryFor(kind, file, record, new Date(), sitePolicy && policyLabel(sitePolicy))]);
  };
  try {
    await (navigator.locks?.request ? navigator.locks.request("kionel-transfer-log", append) : append());
  } catch (error) {
    notify(`This transfer could not be added to the log: ${(error as Error).message}. Its signed record is still valid.`, "warn");
  }
}

async function logInRange(): Promise<LogEntry[]> {
  return inPeriod(await readLog(), $<HTMLInputElement>("log-from").value || undefined, $<HTMLInputElement>("log-to").value || undefined);
}

async function renderLogSummary(): Promise<void> {
  const entries = await logInRange();
  const counts = summary(entries);
  $("log-summary").textContent = entries.length
    ? `${entries.length} entries in this period: ${counts.sent} sent, ${counts.received} received, ${counts.sealed} sealed; ${counts.timestamped} with a trusted timestamp.`
    : "No transfers recorded in this period on this device.";
}
$("transfer-log").addEventListener("toggle", () => { if (($("transfer-log") as HTMLDetailsElement).open) void renderLogSummary(); });
for (const id of ["log-from", "log-to"]) $(id).addEventListener("change", () => void renderLogSummary());

async function logForExport(what: string): Promise<LogEntry[] | undefined> {
  if (needsBusiness(what)) return undefined;
  const entries = await logInRange();
  if (!entries.length) {
    notify("No transfers are recorded in this period on this device. Choose a wider period.", "warn");
    return undefined;
  }
  return entries;
}
const periodName = () => `${$<HTMLInputElement>("log-from").value || "start"}_${$<HTMLInputElement>("log-to").value || "today"}`;
const saveFile = (data: string, name: string, type: string) => {
  const link = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
};

$("log-csv").onclick = async () => {
  const entries = await logForExport("Exporting the transfer log");
  if (!entries) return;
  saveFile(toCsv(entries), `kionel-transfer-log_${periodName()}.csv`, "text/csv;charset=utf-8");
  notify(`${entries.length} entries exported as CSV. Cells that Excel could read as formulas are prefixed with an apostrophe.`, "ok");
};
$("log-json").onclick = async () => {
  const entries = await logForExport("Exporting the transfer log");
  if (!entries) return;
  saveFile(JSON.stringify(entries.map((e) => ({ kind: e.kind, at: e.at, file: e.file, record: e.record })), null, 2),
    `kionel-transfer-records_${periodName()}.json`, "application/json");
  notify(`${entries.length} signed records downloaded. Each one verifies on its own at kionel.com/verify.html.`, "ok");
};
$("log-report").onclick = async () => {
  const entries = await logForExport("The periodic review report");
  if (!entries) return;
  document.getElementById("print-report")?.remove();
  const identity = await identityPromise;
  document.body.append(reviewReport(entries, {
    from: $<HTMLInputElement>("log-from").value, to: $<HTMLInputElement>("log-to").value, device: b64(identity.pub),
  }));
  document.body.classList.add("printing-report");
  window.addEventListener("afterprint", () => document.body.classList.remove("printing-report"), { once: true });
  notify(`Review report with ${entries.length} entries is ready to print or save as PDF.`, "ok");
  window.print();
};

// ---- güvenilir zaman damgası ------------------------------------------------------
/**
 * Makbuzun zamanı cihaz saatidir; anlaşan iki taraf onu geri alabilir. İstenirse
 * teslimde DigiCert'in RFC 3161 damgası eklenir: makbuzun iki imzasıyla birlikte
 * o anda var olduğunu bağımsız otorite söyler. Giden yalnız makbuzun özeti;
 * yanıt burada DigiCert köküne kadar doğrulanır, aktaran sunucuya güvenilmez.
 */
const TSA_KEY = "kionel.timestamp.v1";
const tsaBox = $<HTMLInputElement>("tsa-enabled");
try { tsaBox.checked = localStorage.getItem(TSA_KEY) === "on"; } catch { /* yok */ }
// Paket hiçbir servise bağlanmaz: damga yalnız kionel.com sürümünde.
if (__KIONEL_OFFLINE__) {
  tsaBox.checked = false;
  // Tıklanamayan kutu hata gibi görünüyordu: pakette hiç gösterilmez, yalnız neden yazılır.
  tsaBox.closest("label")!.hidden = true;
  $("tsa-note").textContent = "Trusted timestamps are available in the website version at kionel.com; the offline " +
    "package contacts no service. Receipts made here carry the devices' own times.";
}
tsaBox.onchange = () => {
  if (tsaBox.checked && needsBusiness("Trusted timestamps")) { tsaBox.checked = false; return; }
  try { localStorage.setItem(TSA_KEY, tsaBox.checked ? "on" : "off"); } catch { /* yalnız bu oturum */ }
  notify(tsaBox.checked
    ? "Each receipt will get a trusted timestamp from DigiCert. Only the receipt's fingerprint is sent."
    : "Receipts will carry the devices' own times only.", "ok");
};

type StampedReceipt = Receipt & { tst: { token: string; at: string } };
const utc = (at: Date) => `${at.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")} UTC`;

async function stampReceipt(receipt: Receipt): Promise<{ receipt: StampedReceipt; at: string } | { error: string }> {
  try {
    const imprint = await receiptFingerprint(receipt);
    const nonce = crypto.getRandomValues(new Uint8Array(8));
    const response = await fetch("/api/timestamp", {
      method: "POST", headers: { "Content-Type": "application/timestamp-query" },
      body: buildTimestampRequest(imprint, nonce) as BodyInit,
    });
    if (!response.ok) {
      return { error: response.status === 429 ? "too many timestamp requests; the next receipt will try again" : "the timestamp service did not answer" };
    }
    const token = unwrapTimestampResponse(new Uint8Array(await response.arrayBuffer()));
    const verdict = await verifyTimestampWeb(token, imprint, [anchorBytes(DIGICERT_TRUSTED_ROOT_G4)],
      { nonce, notAfter: new Date(Date.now() + 10 * 60_000) });
    if (!verdict.ok) return { error: `the timestamp did not verify (${verdict.code})` };
    let binary = "";
    for (const byte of token) binary += String.fromCharCode(byte);
    return { receipt: { ...receipt, tst: { token: btoa(binary), at: verdict.at.toISOString() } }, at: utc(verdict.at) };
  } catch (error) {
    return { error: navigator.onLine ? (error as Error).message : "this device is offline" };
  }
}

function signedContextCard(context: DispatchContext): HTMLElement {
  const card = document.createElement("div");
  card.className = "signed-context";
  // Eski kayıtlar kaldırılmış "personal" profilini taşıyabilir; tel biçimi değişmez.
  const name = isTransferProductProfile(context.profile) ? PRODUCTS[context.profile].name : "Kionel";
  const title = document.createElement("strong");
  title.textContent = `${name} · Signed transaction context`;
  const detail = document.createElement("span");
  detail.textContent = [context.reference, context.classification, context.note, context.operator && `operator: ${context.operator}`].filter(Boolean).join(" · ");
  card.append(title, detail);
  return card;
}

// ---- ortak yardımcılar ------------------------------------------------------
async function loadIdentity(): Promise<Identity> {
  const legacyKey = "kionel.identity.v1";
  try {
    const database = await openIdentityDatabase();
    const stored = await readStoredIdentity(database);
    if (stored && validStoredIdentity(stored)) return stored;

    const legacy = localStorage.getItem(legacyKey);
    const identity = legacy
      ? await importProtectedIdentity(JSON.parse(legacy) as JsonWebKey)
      : await createProtectedIdentity();
    await writeStoredIdentity(database, identity);
    localStorage.removeItem(legacyKey); // çıkarılabilir JWK kopyasını yalnız başarılı geçişten sonra sil
    return identity;
  } catch {
    // Gizliliği düşürme: localStorage/JWK fallback YOK. Yalnız bu oturuma ait,
    // dışa aktarılamayan anahtarla çalış; kalıcı kimlik kanıtı verilemediğini bildir.
    identityPersistent = false;
    return createProtectedIdentity().catch(() => { throw new Error(OLD_BROWSER); });
  }
}

async function readStored<T>(id: string): Promise<T | undefined> {
  const database = await openIdentityDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(IDENTITY_STORE, "readonly").objectStore(IDENTITY_STORE).get(id);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function writeStored(id: string, value: unknown): Promise<void> {
  const database = await openIdentityDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(IDENTITY_STORE, "readwrite");
    transaction.objectStore(IDENTITY_STORE).put(value, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openIdentityDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDENTITY_DB, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(IDENTITY_STORE)) request.result.createObjectStore(IDENTITY_STORE);
      if (!request.result.objectStoreNames.contains(AUDIT_STORE)) request.result.createObjectStore(AUDIT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("anahtar deposu kilitli"));
  });
}

function readStoredIdentity(database: IDBDatabase): Promise<Identity | undefined> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(IDENTITY_STORE, "readonly").objectStore(IDENTITY_STORE).get(IDENTITY_KEY);
    request.onsuccess = () => resolve(request.result as Identity | undefined);
    request.onerror = () => reject(request.error);
  });
}

function writeStoredIdentity(database: IDBDatabase, identity: Identity): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(IDENTITY_STORE, "readwrite");
    transaction.objectStore(IDENTITY_STORE).put(identity, IDENTITY_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function validStoredIdentity(identity: Identity): boolean {
  return identity?.pub instanceof Uint8Array && identity.pub.length === 32 &&
    identity.priv instanceof CryptoKey && identity.priv.type === "private" &&
    identity.priv.algorithm.name === "Ed25519" && !identity.priv.extractable &&
    identity.priv.usages.includes("sign");
}

function identityNotice(): string {
  return identityPersistent ? "" : "\nWARNING: persistent secure key storage is unavailable; the identity is limited to this tab.";
}

async function appendAudit(receipt: Receipt, event: "receipt-verified" | "receipt-exported"): Promise<AuditEntry[] | undefined> {
  if (!identityPersistent) return undefined;
  const append = async () => {
    const database = await openIdentityDatabase();
    const entries = await readAuditLedger(database);
    const existing = await verifyAuditLedger(entries);
    if (!existing.ok) throw new Error(`denetim zinciri bozuk: ${existing.reason}`);
    if (entries.length >= 10_000) throw new Error("the audit chain reached its entry limit");
    const entry = await issueAuditEntry(await identityPromise, entries.at(-1) ?? null, receipt, event);
    const next = [...entries, entry];
    await writeAuditLedger(database, next);
    return next;
  };
  return navigator.locks?.request ? navigator.locks.request("kionel-audit-ledger", append) : append();
}

function readAuditLedger(database: IDBDatabase): Promise<AuditEntry[]> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(AUDIT_STORE, "readonly").objectStore(AUDIT_STORE).get(AUDIT_KEY);
    request.onsuccess = () => resolve((request.result as AuditEntry[] | undefined) ?? []);
    request.onerror = () => reject(request.error);
  });
}

function writeAuditLedger(database: IDBDatabase, entries: AuditEntry[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(AUDIT_STORE, "readwrite");
    transaction.objectStore(AUDIT_STORE).put(entries, AUDIT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function showSas(element: HTMLElement, session: Session): void {
  const digits = document.createElement("span");
  digits.className = "sas-digits";
  digits.textContent = session.sas;
  // Rakamlar tek tek okunmalı: "üç yüz on iki bin..." karşılaştırılamaz.
  digits.setAttribute("aria-label", `Rakamlar: ${[...session.sas].join(" ")}`);

  const note = document.createElement("small");
  note.textContent = "The digits AND the symbols must match on both devices";

  element.replaceChildren(digits, renderSasMarks(session.sasMarks), note);
  element.hidden = false;
}

async function scanCamera(
  video: HTMLVideoElement,
  onBytes: (bytes: Uint8Array, captured: number, decodeMs: number) => Promise<boolean>,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: cameraConstraints(rememberedCamera()) });
  // İzin verildikten SONRA cihaz adları okunabilir hâle gelir; seçici ancak
  // burada anlamlı doldurulabilir.
  void populateCameraPicker($<HTMLSelectElement>("recv-camera"));
  video.srcObject = stream;
  await video.play();
  // Görüntü ANCAK akış başladıktan sonra açılır. Önce açmak, izin beklerken ve
  // izin reddedildiğinde ekranda boş beyaz bir kutu bırakıyordu; kullanıcı bunu
  // "ekran dondu" diye okuyor.
  video.hidden = false;
  const grab = document.createElement("canvas");
  let stopped = false;
  let captured = 0;
  // Kod karenin bir kısmını kaplar; sonraki karelerde yalnız onun çevresi okunur.
  // Telefonda 1080p kareyi kopyalamak ve çözmek her karenin en pahalı işidir.
  // Bölge boş dönerse ya da her FULL_EVERY karede bir tam kare taranır: kod kayarsa kaybolmaz.
  let region: Box | undefined;
  let regionFrame = 0;
  let sinceFull = 0;
  const FULL_EVERY = 10;
  // Kareler boştaki çözücülere dağıtılır; sonuçlar sırayla işlenir, çünkü aktarım
  // çözücüsü aynı anda iki kare almaz. Havuz sayfaya aittir: kamera kapanınca yaşar.
  const pool = qrPool();
  let handling: Promise<void> = Promise.resolve();

  const stop = () => {
    if (stopped) return;
    stopped = true;
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  const schedule = () => {
    if (stopped) return;
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(tick);
    else requestAnimationFrame(tick);
  };
  const handle = async (frame: number, area: Box, boxed: { bytes: Uint8Array; box: Box }[], decodeMs: number) => {
    if (stopped) return;
    // Sonuçlar sırasız dönebilir; bölgeyi yalnız en yeni kare belirler.
    if (frame >= regionFrame) {
      regionFrame = frame;
      region = focusRegion(boxed.map(({ box }) => ({ ...box, x: box.x + area.x, y: box.y + area.y })), video.videoWidth, video.videoHeight);
    }
    for (const { bytes } of boxed) {
      if (await onBytes(bytes, frame, decodeMs)) return stop();
    }
    // Canlıda da renkli kod tanınır: QR'sız kareler boş bir çözücüye verilir,
    // hepsi meşgulse kare atlanır (yenisi zaten gelir).
    if (video === recvVideo) {
      noQrFrames = boxed.length ? 0 : noQrFrames + 1;
      // QR'sız birkaç kareden sonra renkli kod okuyucusu kurulur; kareler kuyruğa girer.
      if (noQrFrames > 3 && !colourReader && isBusiness()) void ensureColourReader();
      if (!boxed.length && colourReader?.idle) {
        const colour = await grabColourFrame(video);
        if (colour && colourReader) void colourReader.submit(colour, false);
      }
      if (colourDelivered) return stop();
    }
  };
  const tick = () => {
    if (stopped) return;
    captured++;
    // Bütün çözücüler meşgulse kare atlanır; yenisi 33 ms sonra gelir.
    if (video.videoWidth && pool.idle) {
      const full = !region || sinceFull >= FULL_EVERY;
      const area = full ? { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight } : region!;
      // İşçiler varsa kare ImageBitmap olarak devredilir ve pikselleri işçi okur;
      // yoksa (çevrimdışı paket) pikseller burada okunur.
      let frameSource: ImageData | Promise<ImageBitmap>;
      if (pool.parallel) {
        frameSource = createImageBitmap(video, area.x, area.y, area.w, area.h);
      } else {
        if (grab.width !== area.w || grab.height !== area.h) {
          grab.width = area.w;
          grab.height = area.h;
        }
        const context = grab.getContext("2d", { willReadFrequently: true })!;
        context.drawImage(video, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
        frameSource = context.getImageData(0, 0, area.w, area.h);
      }
      sinceFull = full ? 0 : sinceFull + 1;
      if (video === recvVideo) tried++;
      const frame = captured;
      // Büyük ekran profilinde gönderen birden fazla kodu yan yana gösterir;
      // tek kod aramak o karelerin çoğunu yere atmak olurdu.
      void pool.decode(frameSource, MAX_SYMBOLS_PER_FRAME).then(({ found, ms }) => {
        handling = handling.then(() => handle(frame, area, found, ms)).catch((error) => console.error(error));
      });
    }
    schedule();
  };
  schedule();
  return stop;
}

function addDownload(
  parent: HTMLElement,
  bytes: Uint8Array,
  filename: string,
  label: string,
  secondary = false,
): void {
  const link = document.createElement("a");
  link.className = `dl${secondary ? " secondary" : ""}`;
  link.href = URL.createObjectURL(new Blob([bytes as BlobPart]));
  link.download = filename;
  link.textContent = label;
  parent.append(link);
}

function safeBase(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 100) || "kionel";
}

function cameraError(error: unknown): string {
  switch ((error as Error)?.name) {
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotAllowedError":
      return "Camera access was refused. Allow the camera for this site (icon in the address bar), then reload.";
    case "NotReadableError":
      return "The camera is in use by another application. Close it, then reload.";
    default:
      return `The camera could not be opened: ${(error as Error)?.message ?? String(error)}`;
  }
}

/** Web Crypto yalnızca ArrayBuffer sahipli dizileri kabul eder. */
function owned(bytes: Uint8Array): Bytes {
  return new Uint8Array(bytes);
}
