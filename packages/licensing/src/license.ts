/**
 * Lisans dosyası — çevrimdışı doğrulanan, süreli kullanım hakkı.
 *
 * Sunucu yok, o yüzden zorlama da sunucuda değil: uygulama gömülü açık anahtarla
 * dosyayı yerelde doğrular ve `entitlement` sonucuna göre YENİ aktarım ve imzayı
 * açar ya da kapatır. Süre bitince `GRACE_DAYS` kadar uyarıyla çalışır, sonra demo
 * moduna düşer.
 *
 * Asla kapanmayanlar: daha önce üretilmiş kayıtlar, doğrulama (Apache-2.0 yolu)
 * ve müşterinin kendi dosyaları. Kilitlenen yalnız yeni üretimdir; veri rehin
 * alınmaz. Air-gap laboratuvar yazılımında (ör. düğüme bağlı lisans dosyaları)
 * standart olan model budur.
 *
 * ponytail: tavan — istemci kodu yamalanabilir ve cihaz saati geri alınabilir.
 * Kaynak yayımlanmıyor ve alıcı denetlenen bir kurum; ilk müşteriler için yeterli.
 * Aşılırsa: donanım kasasında monoton sayaç veya imzalı zaman damgası.
 */

import {
  b64, owned, signEs256, unb64, validP256PublicKey, verifyEs256, type CryptoBytes,
} from "@kionel/crypto";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";

export const LICENSE_SCHEMA = "kionel-license/v1" as const;

/** Katmanlar. Hepsi süre boyunca tam kullanım açar — bkz. LICENSING.md §5. */
export const LICENSE_TIERS = ["pilot", "subscription", "oem", "enterprise"] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

export interface LicenseScope {
  /** Kaç saha. */
  sites: number;
  /** Kaç kayıtlı cihaz. */
  devices: number;
  /** Hangi ürün hatları: ör. "lab-bridge", "proof", "import-automation". */
  productLines: readonly string[];
}

export interface License {
  schema: typeof LICENSE_SCHEMA;
  v: 1;
  /** Ticari unvan. Belgenin kime ait olduğunu söyleyen tek alan. */
  licensee: string;
  tier: LicenseTier;
  scope: LicenseScope;
  issuedAt: string;
  validUntil: string;
  /** Bizim imzalama anahtarımız: 65 baytlık SEC1 P-256, base64url. */
  issuer: string;
  sig: string;
}

export type LicenseState =
  /** Geçerli ve süresi dolmamış. */
  | { state: "valid"; license: License; daysRemaining: number }
  /** İmzası doğru ama süresi geçmiş. Ek süre bitince yeni aktarım kapanır. */
  | { state: "expired"; license: License; daysExpired: number }
  /** Doğrulanamadı: biçim, imza veya otorite uyuşmuyor. */
  | { state: "invalid"; reason: string };

const MAX_LICENSEE = 200;
const MAX_PRODUCT_LINES = 16;

const te = (text: string): CryptoBytes => new TextEncoder().encode(text);

/**
 * İmzalanan baytlar.
 *
 * Alanlar açıkça ve sırayla yazılır; `JSON.stringify(license)` kullanılmaz çünkü
 * anahtar sırası ve gelecekte eklenecek alanlar imzayı sessizce değiştirirdi.
 */
const licenseBytes = (body: Omit<License, "sig">): CryptoBytes =>
  te(JSON.stringify([
    LICENSE_SCHEMA, body.v, body.licensee, body.tier,
    body.scope.sites, body.scope.devices, [...body.scope.productLines],
    body.issuedAt, body.validUntil, body.issuer,
  ]));

function validScope(value: unknown): value is LicenseScope {
  if (!value || typeof value !== "object") return false;
  const scope = value as LicenseScope;
  if (Object.keys(scope).some((key) => !["sites", "devices", "productLines"].includes(key))) return false;
  return Number.isInteger(scope.sites) && scope.sites > 0 && scope.sites <= 10_000 &&
    Number.isInteger(scope.devices) && scope.devices > 0 && scope.devices <= 1_000_000 &&
    Array.isArray(scope.productLines) && scope.productLines.length > 0 &&
    scope.productLines.length <= MAX_PRODUCT_LINES &&
    new Set(scope.productLines).size === scope.productLines.length &&
    scope.productLines.every((line) => typeof line === "string" && line.length > 0 && line.length <= 64);
}

const isoDate = (value: unknown): value is string =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

/** Calendar months in UTC, clamped to the last day of the destination month. */
export function licenseExpiry(issuedAt: Date, months: number): Date {
  if (!Number.isFinite(issuedAt.getTime()) || !Number.isInteger(months) || months < 1 || months > 120) {
    throw new Error("valid date and 1..120 whole months required");
  }
  const result = new Date(issuedAt);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const last = new Date(result);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  result.setUTCDate(Math.min(day, last.getUTCDate()));
  return result;
}

export function isLicense(value: unknown): value is License {
  if (!value || typeof value !== "object") return false;
  const item = value as License;
  const allowed = ["schema", "v", "licensee", "tier", "scope", "issuedAt", "validUntil", "issuer", "sig"];
  if (Object.keys(item).some((key) => !allowed.includes(key))) return false;
  return item.schema === LICENSE_SCHEMA && item.v === 1 &&
    typeof item.licensee === "string" && item.licensee.length > 0 && item.licensee.length <= MAX_LICENSEE &&
    (LICENSE_TIERS as readonly string[]).includes(item.tier) &&
    validScope(item.scope) && isoDate(item.issuedAt) && isoDate(item.validUntil) &&
    typeof item.issuer === "string" && /^[A-Za-z0-9_-]{87}$/.test(item.issuer) &&
    typeof item.sig === "string" && /^[A-Za-z0-9_-]{86}$/.test(item.sig);
}

/**
 * Lisans imzalar. Yalnız biz çağırırız — ödeme tamamlandığında.
 *
 * Polar kasa; lisans otoritesi biziz. Polar'ın kendi anahtar özelliği kullanılmaz
 * çünkü doğrulaması çevrimiçidir ve onların API'sine bağlıdır; bu, müşterinin
 * bizim ve Polar'ın ayakta olmasına bağımlı olması demekti.
 */
export async function issueLicense(
  issuer: PlatformSigningIdentity,
  input: {
    licensee: string;
    tier: LicenseTier;
    scope: LicenseScope;
    validUntil: Date;
    issuedAt?: Date;
  },
): Promise<License> {
  if (!validP256PublicKey(issuer.publicKey)) throw new Error("lisans otoritesi P-256 anahtarı gerektirir");
  if (!input.licensee.trim() || input.licensee.length > MAX_LICENSEE) throw new Error("lisans sahibi unvanı geçersiz");
  if (!validScope(input.scope)) throw new Error("lisans kapsamı geçersiz");
  if (!(LICENSE_TIERS as readonly string[]).includes(input.tier)) throw new Error("lisans katmanı geçersiz");

  const issuedAt = input.issuedAt ?? new Date();
  if (!Number.isFinite(issuedAt.getTime()) || !Number.isFinite(input.validUntil.getTime())) {
    throw new Error("lisans tarihi geçersiz");
  }
  if (input.validUntil.getTime() <= issuedAt.getTime()) {
    throw new Error("lisans bitiş tarihi başlangıçtan sonra olmalı");
  }

  const body: Omit<License, "sig"> = {
    schema: LICENSE_SCHEMA,
    v: 1,
    licensee: input.licensee.trim(),
    tier: input.tier,
    scope: { ...input.scope, productLines: [...input.scope.productLines] },
    issuedAt: issuedAt.toISOString(),
    validUntil: input.validUntil.toISOString(),
    issuer: b64(owned(issuer.publicKey)),
  };
  return { ...body, sig: b64(await signEs256(issuer, licenseBytes(body))) };
}

/**
 * Lisansı çevrimdışı doğrular.
 *
 * `authority` uygulamaya gömülü açık anahtarımızdır. Verilmezse doğrulama
 * yapılmaz — dosyanın kendi içindeki `issuer` alanına güvenmek, kendi imzasını
 * kendi doğrulayan bir belge üretmek olurdu.
 *
 * Süresi dolmuş lisans `invalid` değil `expired` döner. Aradaki fark ürünün
 * tamamı: biri "bu belge sahte", diğeri "bu belgenin yenilenmesi gerekiyor".
 */
export async function verifyLicense(
  value: unknown,
  authority: Uint8Array,
  now = new Date(),
): Promise<LicenseState> {
  if (!Number.isFinite(now.getTime())) return { state: "invalid", reason: "the device clock is invalid" };
  if (!validP256PublicKey(authority)) return { state: "invalid", reason: "the licence authority key is invalid" };
  if (!isLicense(value)) return { state: "invalid", reason: "the file is not a Kionel licence, or it was edited" };

  const license = value;
  if (license.issuer !== b64(owned(authority))) {
    return { state: "invalid", reason: "it was signed by a different authority than Kionel" };
  }

  const { sig, ...body } = license;
  if (!(await verifyEs256(authority, unb64(sig), licenseBytes(body)))) {
    return { state: "invalid", reason: "its signature does not verify (the file was changed)" };
  }

  const issued = Date.parse(license.issuedAt);
  const until = Date.parse(license.validUntil);
  if (until <= issued) return { state: "invalid", reason: "its validity dates are inconsistent" };
  // Gelecekte başlayan bir lisans henüz geçerli değildir; "valid" demek yanlış olur.
  if (now.getTime() < issued) return { state: "invalid", reason: "it has not started yet (check the device clock)" };

  const day = 24 * 60 * 60 * 1000;
  if (now.getTime() >= until) {
    return { state: "expired", license, daysExpired: Math.floor((now.getTime() - until) / day) };
  }
  return { state: "valid", license, daysRemaining: Math.floor((until - now.getTime()) / day) };
}

/** Süre bitiminden sonra yenileme için tanınan uyarılı çalışma süresi. */
export const GRACE_DAYS = 14;

/**
 * Bu günden azı kaldıysa kullanıcı uyarılır.
 *
 * Yenilemeyi satın alma süreci olan bir kurumda ayarlamak günler sürer; süre
 * dolduğu gün haber vermek, kurumu hazırlıksız yakalamak olur.
 */
export const RENEWAL_WARNING_DAYS = 30;

/** Arayüzün göstereceği durum: sakin, uyarı ya da durdu. */
export type LicenseSeverity = "ok" | "warn" | "stopped";

export function licenseSeverity(state: LicenseState | undefined): LicenseSeverity {
  const access = entitlement(state);
  if (access === "demo") return "stopped";
  if (access === "grace") return "warn";
  return state?.state === "valid" && state.daysRemaining <= RENEWAL_WARNING_DAYS ? "warn" : "ok";
}

/**
 * Yazılımın ne yapabileceği. Tek karar noktası: uygulamalar kendi kuralını yazmaz.
 *
 * - `licensed`: tam kullanım.
 * - `grace`: süre doldu, `GRACE_DAYS` içinde; tam kullanım + yenileme uyarısı.
 * - `demo`: lisans yok, geçersiz veya ek süre bitti; yalnız örnek veriyle gösterim.
 */
export type Entitlement = "licensed" | "grace" | "demo";

export function entitlement(state: LicenseState | undefined): Entitlement {
  if (!state || state.state === "invalid") return "demo";
  if (state.state === "valid") return "licensed";
  return state.daysExpired < GRACE_DAYS ? "grace" : "demo";
}

/**
 * Cihaz saatine tek başına güvenilmez: süresi dolmuş bir lisansı yeniden
 * geçerli yapmanın en kolay yolu saati geri almaktır.
 *
 * Bu yüzden yazılım GÖRDÜĞÜ EN İLERİ ZAMANI saklar ve bir daha geriye gitmez.
 * Saat geri alınırsa lisans kontrolü saklanan zamanla yapılır; ileri alınırsa
 * zaten lisansın aleyhine çalışır, engellemeye gerek yok.
 *
 * `skewMs` gerçek dünyaya bırakılan pay: yaz saati, NTP düzeltmesi ve pilli
 * saatin birkaç dakikalık kayması sahtekârlık değildir.
 *
 * ponytail: tavan — saklanan durum da silinebilir (tarayıcı verisini temizlemek,
 * dosyayı silmek). Bu, kontrolü atlatmayı ucuzdan zora taşır, imkânsız kılmaz;
 * asıl zorlama karşı imza ve yenilemede. Yükseltme yolu: donanım kasasında
 * monoton sayaç veya imzalı zaman damgası.
 */
export const CLOCK_SKEW_MS = 5 * 60_000;

export interface ClockState {
  /** Bugüne kadar görülen en ileri zaman. */
  seenAt: string;
}

export interface ClockCheck {
  /** Lisans kontrolünde kullanılacak zaman. */
  now: Date;
  /** Cihaz saati saklanan zamandan belirgin şekilde geride mi? */
  rolledBack: boolean;
  /** Saklanacak yeni durum. */
  next: ClockState;
}

export function monotonicNow(stored: ClockState | undefined, now = new Date(), skewMs = CLOCK_SKEW_MS): ClockCheck {
  const seen = stored?.seenAt ? Date.parse(stored.seenAt) : NaN;
  const current = now.getTime();
  if (!Number.isFinite(current)) throw new Error("geçersiz saat");
  if (!Number.isFinite(seen)) return { now, rolledBack: false, next: { seenAt: now.toISOString() } };
  const rolledBack = current < seen - skewMs;
  const effective = new Date(Math.max(current, seen));
  return { now: effective, rolledBack, next: { seenAt: effective.toISOString() } };
}

/** Saat geri alındığında kullanıcıya gösterilecek satır. */
export const CLOCK_WARNING =
  "Device clock is behind the last recorded time; the licence is checked against the recorded time.";

/** Uygulamada gösterilecek tek satır. */
/**
 * Her durumda üç şeyi söyler: şu an ne çalışıyor, ne yapılmalı, eski kayıtlara
 * ne olur. Son cümle hiçbir durumda değişmez: doğrulama lisansa bağlı değildir
 * ve bu söz, satışta en çok sorulan sorunun cevabıdır.
 */
export const RECORDS_STAY_VALID = "Records you already have stay verifiable, with or without a licence.";

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export function licenseNotice(state: LicenseState): string {
  if (state.state === "invalid") {
    return `Licence not accepted: ${state.reason}. You are using the free personal edition. ` +
      `Load the licence file you received after purchase, or contact support. ${RECORDS_STAY_VALID}`;
  }
  const { licensee, tier, validUntil } = state.license;
  const date = validUntil.slice(0, 10);
  const base = `Licence: ${licensee} · ${tier}`;
  if (state.state === "valid") {
    if (state.daysRemaining <= RENEWAL_WARNING_DAYS) {
      return `${base} · expires ${date} — ${days(state.daysRemaining)} left. ` +
        `Renew now to avoid an interruption; transfers keep working until then.`;
    }
    return `${base} · active until ${date} (${days(state.daysRemaining)}). Your own files can be transferred.`;
  }
  const left = GRACE_DAYS - state.daysExpired;
  return left > 0
    ? `${base} · expired on ${date}. Grace period: new transfers stop in ${days(left)} unless renewed. ${RECORDS_STAY_VALID}`
    : `${base} · expired on ${date}. Business features are stopped and the app runs as the free personal edition. Renew to resume. ${RECORDS_STAY_VALID}`;
}

/**
 * Bir ürün hattının lisans kapsamında olup olmadığı.
 *
 * Bilgi amaçlıdır; kilit `entitlement` ile kurulur. Ürün hattı ayrımı sözleşme
 * konusudur, her hattı ayrı kilitlemek destek yükünü gelirden hızlı büyütür.
 */
export function coversProductLine(state: LicenseState, productLine: string): boolean {
  return state.state !== "invalid" && state.license.scope.productLines.includes(productLine);
}
