// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * L4 — doğrulama çekirdeği. YALNIZCA Web Crypto; kendi primitifi yok.
 *
 * Bu paket bir Kionel kaydını ÜRETMEZ, DOĞRULAR. Kayıt üretimi ve oturum
 * kurulumu @kionel/issue paketindedir ve kapalı ticari lisans altındadır.
 * Ayrım kasıtlıdır: müşterinin kendi kaydını doğrulama yeteneği bizim var
 * olmaya devam etmemize bağlı olamaz, o yüzden doğrulama yolu kalıcı olarak
 * Apache-2.0'dır. Bkz. LICENSING-MAP.md.
 *
 * Burada kalanlar: kayıt tipleri, biçim kontrolleri, imzalanan kanonik baytları
 * üreten kodlayıcılar, tüm verify* fonksiyonları ve kimlik anahtarı taşıma.
 *
 * Doğrulamanın KANITLAMADIĞI şey: anahtarın arkasındaki kişinin kim olduğu.
 * Kimlik bağlama bu katmanın dışındadır. Ayrıntı için THREAT-MODEL.md.
 */
const subtle = globalThis.crypto.subtle;

/**
 * Web Crypto'nun `BufferSource`'u SharedArrayBuffer destekli dizileri kabul
 * etmez; paket boyunca tek bayt tipi kullanmak nokta nokta cast'tan temiz.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export interface Identity {
  /** Ed25519 açık anahtar, 32 bayt. Kalıcı kimlik — makbuzun anlamı buna bağlı. */
  pub: Bytes;
  priv: CryptoKey;
}

export interface Session {
  /** Birinci faktör: iki ekranda karşılaştırılan 6 hane. */
  sas: string;
  /** İkinci faktör: aynı el sıkışmadan bağımsız türetilen 5 sembol indeksi (0-31). */
  sasMarks: readonly number[];
  /** Karşı tarafın Ed25519 açık anahtarı. */
  peer: Bytes;
  sessionId: number;
  seal(plain: Bytes): Promise<Bytes>;
  open(sealed: Bytes): Promise<Bytes>;
}

/**
 * İkinci SAS faktörü glif değil, INDEKS taşır (0-31, beş adet).
 *
 * Önce emoji kullanılıyordu ve bu bir stil tercihi değil, bir doğruluk hatasıydı:
 * aynı kod noktası Apple, Google ve Samsung'da farklı çizilir. Karşılaştırılması
 * gereken iki cihazda farklı görünen bir karşılaştırma kodu, karşılaştırma kodu
 * değildir. Kripto katmanı artık gliflerle hiç ilgilenmiyor; nasıl çizileceği
 * render katmanının işi. Entropi aynı: sembol başına 5 bit.
 */
export const SAS_MARK_COUNT = 32;
export const SAS_MARK_LENGTH = 5;

export async function createIdentity(): Promise<Identity> {
  const kp = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return { pub: new Uint8Array(await subtle.exportKey("raw", kp.publicKey)), priv: kp.privateKey };
}

/** Üretim/web kimliği: özel anahtar Web Crypto dışına çıkarılamaz. */
export async function createProtectedIdentity(): Promise<Identity> {
  const kp = (await subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"])) as CryptoKeyPair;
  return { pub: new Uint8Array(await subtle.exportKey("raw", kp.publicKey)), priv: kp.privateKey };
}

/** Kalıcı kimlik saklamak için. Oturum anahtarları ASLA saklanmaz, her seferinde yenidir. */
export async function exportIdentity(id: Identity): Promise<JsonWebKey> {
  return subtle.exportKey("jwk", id.priv);
}

export async function importIdentity(jwk: JsonWebKey): Promise<Identity> {
  const priv = await subtle.importKey("jwk", jwk, { name: "Ed25519" }, true, ["sign"]);
  const pub = await subtle.importKey("jwk", { ...jwk, d: undefined, key_ops: ["verify"] }, { name: "Ed25519" }, true, ["verify"]);
  return { pub: new Uint8Array(await subtle.exportKey("raw", pub)), priv };
}

/** Eski JWK kimliğini aynı anahtarı koruyarak dışa aktarılamaz CryptoKey'e yükseltir. */
export async function importProtectedIdentity(jwk: JsonWebKey): Promise<Identity> {
  const priv = await subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
  const pub = await subtle.importKey("jwk", { ...jwk, d: undefined, key_ops: ["verify"] }, { name: "Ed25519" }, true, ["verify"]);
  return { pub: new Uint8Array(await subtle.exportKey("raw", pub)), priv };
}

export interface Pending {
  id: Identity;
  kxPriv: CryptoKey;
  offer: Bytes;
  /** Tek kullanımlık: aynı teklif ikinci kez tamamlanamaz. */
  used: boolean;
}

export * from "./receipt.ts";
export * from "./audit.ts";
export * from "./qualification-evidence.ts";
export * from "./signature-v2.ts";
export * from "./evidence-v2.ts";
export * from "./audit-v2.ts";
export * from "./qualification-evidence-v2.ts";
export * from "./endorsement.ts";
export * from "./method.ts";

export function concat(a: Bytes, b: Bytes): Bytes {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
