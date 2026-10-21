// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Kionel karşı imzası — kopyalanamayan tek şey.
 *
 * Sorunun kendisi: yazılım çevrimdışı ve istemci tarafında çalışıyor, kaynağı da
 * görünür. Hiçbir lisans kontrolü teknik olarak zorlanamaz; yamalanır. Kilit
 * koymayı zaten reddediyoruz, çünkü izole bir laboratuvarda bir gün duran yazılım
 * o kurumun bir daha hiçbir şeyimizi almaması demektir.
 *
 * O hâlde geriye ne kalıyor? Şu: **kopyalanabilen şeyi satmamak.**
 *
 * Kalifikasyon raporu bugüne kadar koşan kişinin kendi anahtarıyla imzalanıyordu
 * ve doğrulaması da kaydın içindeki anahtara bakıyordu. Yani "kanıt satıyoruz"
 * derken sattığımız şeyin bize teknik bir bağı yoktu; herkes kendi raporunu
 * üretip kendi imzalayabilirdi.
 *
 * Karşı imza bu boşluğu kapatır. Laboratuvar ölçümü yapar ve kendi adına imzalar
 * — bu değişmez ve kimseye bağımlı değildir. Bunun ÜSTÜNE, lisanslı bir müşteri
 * için biz kendi otorite anahtarımızla karşı imza atarız. Bu imza:
 *
 *   - yamalanarak elde edilemez, çünkü özel anahtar hiçbir zaman istemciye gitmez;
 *   - çevrimdışı doğrulanır, çünkü doğrulayan yalnız açık anahtara ihtiyaç duyar;
 *   - hiçbir şeyi kilitlemez — karşı imzasız rapor da geçerli bir rapordur.
 *
 * Denetçi açısından fark şudur: "bu ölçümü biz yaptık" ile "bu ölçümü biz yaptık
 * ve tedarikçi bağımsız olarak karşı imzaladı" aynı cümle değildir. Satılan şey
 * yazılım değil, bu ikinci cümledir.
 */

import { owned, signEs256, validP256PublicKey, verifyEs256, type CryptoBytes } from "@kionel/crypto";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import { verifyLicense, type License, type LicenseTier } from "./license.ts";

export const COUNTERSIGN_SCHEMA = "kionel-countersign/v1" as const;

/** Karşı imzalanabilecek belge türleri. Kapalı liste: anlamı belirsiz bir karşı imza, imza değildir. */
export const COUNTERSIGN_KINDS = ["qualification", "receipt", "audit-ledger", "device-matrix"] as const;
export type CountersignKind = (typeof COUNTERSIGN_KINDS)[number];

export interface EvidenceCountersignature {
  schema: typeof COUNTERSIGN_SCHEMA;
  v: 1;
  kind: CountersignKind;
  /** Karşı imzalanan belgenin SHA-256'sı, base64url. */
  document: string;
  /** Hangi lisans yetki verdi. Karşı imza lisanstan bağımsız üretilmez. */
  licensee: string;
  tier: LicenseTier;
  at: string;
  /** Kionel otorite anahtarı: 65 baytlık SEC1 P-256, base64url. */
  issuer: string;
  sig: string;
}

export type CountersignState =
  | { state: "verified"; countersignature: EvidenceCountersignature }
  /** Belge geçerli olabilir; yalnız Kionel karşı imzası taşımıyor. */
  | { state: "absent" }
  | { state: "rejected"; reason: string };

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string): CryptoBytes => new Uint8Array(Buffer.from(text, "base64url"));
const te = (text: string): CryptoBytes => new TextEncoder().encode(text);

const countersignBytes = (body: Omit<EvidenceCountersignature, "sig">): CryptoBytes =>
  te(JSON.stringify([
    COUNTERSIGN_SCHEMA, body.v, body.kind, body.document,
    body.licensee, body.tier, body.at, body.issuer,
  ]));

export async function documentDigest(document: unknown): Promise<string> {
  // Belgenin kendi kanonik gösterimi yoksa JSON'u kullanılır; karşı imza belgenin
  // TAM hâline bağlanır, alt kümesine değil.
  const bytes = typeof document === "string" ? te(document) : te(JSON.stringify(document));
  return b64(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}

export function isCountersignature(value: unknown): value is EvidenceCountersignature {
  if (!value || typeof value !== "object") return false;
  const item = value as EvidenceCountersignature;
  const allowed = ["schema", "v", "kind", "document", "licensee", "tier", "at", "issuer", "sig"];
  if (Object.keys(item).some((key) => !allowed.includes(key))) return false;
  return item.schema === COUNTERSIGN_SCHEMA && item.v === 1 &&
    (COUNTERSIGN_KINDS as readonly string[]).includes(item.kind) &&
    typeof item.document === "string" && item.document.length === 43 &&
    typeof item.licensee === "string" && item.licensee.length > 0 &&
    typeof item.tier === "string" &&
    typeof item.at === "string" && !Number.isNaN(Date.parse(item.at)) &&
    typeof item.issuer === "string" && typeof item.sig === "string" && item.sig.length > 0;
}

/**
 * Karşı imza atar. Yalnız Kionel çağırır ve **geçerli bir lisans şarttır.**
 *
 * Süresi dolmuş lisansla karşı imza atılmaz. Bu, ürünün tek gerçek zorlama
 * noktasıdır ve bilinçlidir: yazılım süresiz çalışır, karşı imza çalışmaz.
 * Müşteri hiçbir şeyini kaybetmez; yenilemediğinde yalnız yeni karşı imza almaz.
 */
export async function countersignEvidence(
  authority: PlatformSigningIdentity,
  input: { kind: CountersignKind; document: unknown; license: License; at?: Date },
): Promise<EvidenceCountersignature> {
  if (!validP256PublicKey(authority.publicKey)) throw new Error("karşı imza P-256 otorite anahtarı gerektirir");

  const at = input.at ?? new Date();
  const state = await verifyLicense(input.license, authority.publicKey, at);
  if (state.state !== "valid") {
    throw new Error(
      state.state === "expired"
        ? "Lisansın süresi dolmuş; karşı imza atılamaz. Mevcut belgeler geçerliliğini korur."
        : `Lisans geçerli değil: ${state.reason}`,
    );
  }

  const body: Omit<EvidenceCountersignature, "sig"> = {
    schema: COUNTERSIGN_SCHEMA,
    v: 1,
    kind: input.kind,
    document: await documentDigest(input.document),
    licensee: state.license.licensee,
    tier: state.license.tier,
    at: at.toISOString(),
    issuer: b64(owned(authority.publicKey)),
  };
  return { ...body, sig: b64(await signEs256(authority, countersignBytes(body))) };
}

/**
 * Karşı imzayı çevrimdışı doğrular.
 *
 * Üç sonuç var ve "yok" bir hata değildir: karşı imzasız bir kalifikasyon raporu
 * hâlâ geçerli bir rapordur, yalnız bağımsız bir karşı imza taşımaz. İkisini
 * karıştırmak, dürüst bir müşterinin belgesini sahte göstermek olurdu.
 */
export async function verifyCountersignature(
  value: unknown,
  document: unknown,
  authority: Uint8Array,
): Promise<CountersignState> {
  if (value === undefined || value === null) return { state: "absent" };
  if (!validP256PublicKey(authority)) return { state: "rejected", reason: "otorite anahtarı geçersiz" };
  if (!isCountersignature(value)) return { state: "rejected", reason: "karşı imza biçimi geçersiz" };

  if (value.issuer !== b64(owned(authority))) {
    return { state: "rejected", reason: "karşı imzayı atan otorite beklenen otorite değil" };
  }
  if (value.document !== await documentDigest(document)) {
    return { state: "rejected", reason: "karşı imza başka bir belgeye ait" };
  }

  const { sig, ...body } = value;
  if (!(await verifyEs256(authority, unb64(sig), countersignBytes(body)))) {
    return { state: "rejected", reason: "karşı imza doğrulanamadı" };
  }
  return { state: "verified", countersignature: value };
}

/** Denetim çıktısında okunan satır. */
export function countersignNotice(state: CountersignState): string {
  switch (state.state) {
    case "verified":
      return `Kionel karşı imzası: ${state.countersignature.licensee} · ` +
        `${state.countersignature.tier} · ${state.countersignature.at.slice(0, 10)}`;
    case "absent":
      return "Kionel karşı imzası yok — belge kendi imzasıyla geçerlidir, bağımsız karşı imza taşımaz.";
    case "rejected":
      return `Kionel karşı imzası REDDEDİLDİ — ${state.reason}`;
  }
}
