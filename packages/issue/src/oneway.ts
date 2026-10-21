// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Tek yönlü aktarım — gönderen tarafta kamera olmadan.
 *
 * Laboratuvarın gerçeği şu: cihaz bilgisayarında kamera yoktur ve takılamaz.
 * Çift yönlü el sıkışma iki tarafta da kamera ister, çünkü alıcının ANLIK
 * anahtarı gönderene optik yoldan ulaşmak zorundadır. Burada o gereklilik,
 * alıcının KALICI anahtarını gönderen cihaza bir kez kurarak kaldırılıyor:
 * gönderen yalnız gösterir, alıcı yalnız okur.
 *
 * Bedeli açıkça yazalım:
 *  - Alıcının anahtarı kalıcıdır, yani o anahtar sızarsa ONUNLA mühürlenmiş
 *    geçmiş aktarımlar da açılabilir. Çift yönlü akıştaki ileri gizlilik burada
 *    yoktur. Gönderen tarafın anahtarı her aktarımda yeni üretilir, bu yüzden
 *    iki aktarım birbirinden bağımsız kalır.
 *  - SAS karşılaştırması yoktur; karşılaştıracak ikinci kanal yoktur. Ortadaki
 *    adama karşı güvence, kartın gönderen cihaza GÜVENİLİR biçimde kurulmuş
 *    olmasından gelir. Kart yanlışsa aktarım yanlış alıcıya gider.
 *
 * Bu yüzden kart kurulumu bir kerelik ve kasıtlı bir işlemdir: kurumun kendi
 * cihaz kaydı neyse odur.
 */
import {
  b64, concat, unb64, verifyDispatch, type Bytes, type Dispatch, type DispatchContext, type Identity,
} from "@kionel/crypto";
import { issueDispatch } from "./evidence.ts";
import { expand, shrink } from "./compress.ts";

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();

export const RECEIVER_CARD_SCHEMA = "kionel-receiver-card/v1" as const;
/** Tek yönlü zarfın ilk baytları; yanlış biçimi erken ve net reddetmek için. */
const WIRE_MAGIC = te.encode("KIONEL-1WAY-V2");
/** Önceki sürümün sihri: eski sayfadan gelen akışa net bir mesaj vermek için. */
const OLD_MAGICS = [te.encode("KIONEL-1WAY-V1"), te.encode("KIONEL-CODE-V1")];
/** Açılan içerik sınırı: protokolün 64 MiB dosya sınırı + bağlam payı. */
const BODY_LIMIT = 64 * 1024 * 1024 + 64 * 1024;

const startsWith = (wire: Bytes, magic: Uint8Array) => wire.length >= magic.length && magic.every((b, i) => wire[i] === b);
const rejectOld = (wire: Bytes) => {
  if (OLD_MAGICS.some((magic) => startsWith(wire, magic))) {
    throw new Error("the sender runs an older version of Kionel — reload the page on both devices");
  }
};

/**
 * Gövde: [u32 kayıt uzunluğu][sevk kaydı JSON][u8 ad uzunluğu][ad][dosya], sonra
 * sıkıştırılır. Önceki sürüm dosyayı base64 ile JSON'a gömüyordu: yalnız bu,
 * ekrana çıkan veriyi üçte bir büyütüyordu.
 */
async function encodeBody(dispatch: Dispatch, file: { name: string; data: Bytes }): Promise<Bytes> {
  const record = te.encode(JSON.stringify(dispatch));
  const name = te.encode(file.name).subarray(0, 255);
  const raw = new Uint8Array(4 + record.length + 1 + name.length + file.data.length);
  new DataView(raw.buffer).setUint32(0, record.length);
  raw.set(record, 4);
  raw[4 + record.length] = name.length;
  raw.set(name, 5 + record.length);
  raw.set(file.data, 5 + record.length + name.length);
  return (await shrink(raw)) as Bytes;
}

async function decodeBody(plain: Uint8Array): Promise<OpenedOneWay> {
  const raw = await expand(plain, BODY_LIMIT);
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const recordLength = raw.length >= 4 ? view.getUint32(0) : Infinity;
  if (5 + recordLength > raw.length) throw new Error("the transfer content is damaged");
  const dispatch = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw.subarray(4, 4 + recordLength))) as Dispatch;
  const nameLength = raw[4 + recordLength];
  const start = 5 + recordLength + nameLength;
  if (start > raw.length) throw new Error("the transfer content is damaged");
  const name = new TextDecoder().decode(raw.subarray(5 + recordLength, start));
  const data = raw.slice(start) as Bytes;
  // Şifre çözülmesi yetmez: sevk kaydı GERÇEKTEN bu içeriğe mi ait?
  const verdict = await verifyDispatch(dispatch, data);
  if (!verdict.ok) throw new Error("the dispatch record inside does not match the file");
  return { name, data, dispatch };
}

export interface ReceiverCard {
  schema: typeof RECEIVER_CARD_SCHEMA;
  /** İnsanın tanıması için: "Merkez lab tableti". Kanıt değeri yoktur. */
  label: string;
  /** Alıcının kalıcı Ed25519 kimliği, base64url. */
  ed: string;
  /** Alıcının kalıcı X25519 anahtarı, base64url. */
  x: string;
  /** Kartın kendi Ed25519 anahtarıyla imzası: kart yolda değiştirilemesin. */
  sig: string;
}

/** Kalıcı alıcı anahtarı. Özel kısmı cihazdan hiç çıkmaz. */
export interface ReceiverKey {
  priv: CryptoKey;
  pub: Bytes;
}

export async function createReceiverKey(): Promise<ReceiverKey> {
  const pair = (await subtle.generateKey({ name: "X25519" }, false, ["deriveBits"])) as CryptoKeyPair;
  return { priv: pair.privateKey, pub: new Uint8Array(await subtle.exportKey("raw", pair.publicKey)) };
}

const cardBytes = (label: string, ed: Bytes, x: Bytes): Bytes =>
  te.encode(JSON.stringify([RECEIVER_CARD_SCHEMA, label, b64(ed), b64(x)]));

/** Alıcı kendi kartını üretir; bu dosya gönderen cihaza bir kez kurulur. */
export async function issueReceiverCard(identity: Identity, key: ReceiverKey, label: string): Promise<ReceiverCard> {
  const clean = label.trim();
  if (!clean || clean.length > 120) throw new Error("the card name must be 1–120 characters");
  const body = cardBytes(clean, identity.pub, key.pub);
  const sig = new Uint8Array(await subtle.sign({ name: "Ed25519" }, identity.priv, body as BufferSource));
  return { schema: RECEIVER_CARD_SCHEMA, label: clean, ed: b64(identity.pub), x: b64(key.pub), sig: b64(sig) };
}

/**
 * Kartı doğrular. Kendi imzasını kendi taşıyan bir belgedir: bu, kartın
 * kaynağını kanıtlamaz, yalnız yolda değiştirilmediğini gösterir. Kartın doğru
 * alıcıya ait olduğu, kurulum anında kurum tarafından bilinir.
 */
export async function verifyReceiverCard(value: unknown): Promise<ReceiverCard | null> {
  if (!value || typeof value !== "object") return null;
  const card = value as ReceiverCard;
  const allowed = ["schema", "label", "ed", "x", "sig"];
  if (Object.keys(card).some((key) => !allowed.includes(key))) return null;
  if (card.schema !== RECEIVER_CARD_SCHEMA) return null;
  if (typeof card.label !== "string" || !card.label.trim() || card.label.length > 120) return null;
  if (!/^[A-Za-z0-9_-]{43}$/.test(card.ed) || !/^[A-Za-z0-9_-]{43}$/.test(card.x)) return null;
  if (!/^[A-Za-z0-9_-]{86}$/.test(card.sig)) return null;
  try {
    const ed = await subtle.importKey("raw", unb64(card.ed), { name: "Ed25519" }, false, ["verify"]);
    const ok = await subtle.verify({ name: "Ed25519" }, ed,
      unb64(card.sig) as BufferSource, cardBytes(card.label, unb64(card.ed), unb64(card.x)) as BufferSource);
    return ok ? card : null;
  } catch { return null; }
}

async function contentKey(shared: ArrayBuffer, salt: Bytes): Promise<CryptoKey> {
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: te.encode("kionel/oneway/v1/content") }, hk, 256);
  return subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/**
 * Zarf: [sihir | gönderen X25519 (32) | nonce (12) | şifreli gövde].
 * Gövde, sevk kaydı ve dosyanın kendisidir; ikisi birlikte mühürlenir ki
 * bağlamı ayırıp başka bir dosyaya iliştirmek mümkün olmasın.
 */
export async function sealOneWay(
  sender: Identity, card: ReceiverCard, file: { name: string; data: Bytes }, context: DispatchContext,
): Promise<{ wire: Bytes; dispatch: Dispatch }> {
  const verified = await verifyReceiverCard(card);
  if (!verified) throw new Error("the receiver card could not be verified — load it again from the receiver");

  const ephemeral = (await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const ephemeralPub = new Uint8Array(await subtle.exportKey("raw", ephemeral.publicKey));
  const peer = await subtle.importKey("raw", unb64(verified.x), { name: "X25519" }, false, []);
  const shared = await subtle.deriveBits({ name: "X25519", public: peer }, ephemeral.privateKey, 256);

  // Oturum numarası içerikten türetiliyor: alıcı da aynı numarayı hesaplar ve
  // sevk kaydıyla teslim makbuzu aynı numarada buluşur.
  const digest = new Uint8Array(await subtle.digest("SHA-256", file.data as BufferSource));
  const session = new DataView(digest.buffer).getUint32(0) >>> 0;
  const dispatch = await issueDispatch(sender, { session, content: file.data, context });

  const body = await encodeBody(dispatch, file);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  // Salt alıcının kalıcı anahtarını da kapsar: aynı gönderen, farklı alıcı için
  // farklı anahtar türetir.
  const key = await contentKey(shared, concat(ephemeralPub, unb64(verified.x)));
  const sealed = new Uint8Array(await subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: WIRE_MAGIC as BufferSource }, key, body as BufferSource));

  return { wire: concat(concat(WIRE_MAGIC, concat(ephemeralPub, nonce)), sealed), dispatch };
}

export interface OpenedOneWay {
  name: string;
  data: Bytes;
  dispatch: Dispatch;
}

/** Alıcı tarafı: zarfı açar ve sevk kaydını içeriğe karşı doğrular. */
export async function openOneWay(key: ReceiverKey, wire: Bytes): Promise<OpenedOneWay> {
  const head = WIRE_MAGIC.length;
  rejectOld(wire);
  if (wire.length < head + 32 + 12 + 16) throw new Error("the one-way transfer is incomplete");
  for (let i = 0; i < head; i++) if (wire[i] !== WIRE_MAGIC[i]) throw new Error("not a one-way transfer");

  const ephemeralPub = wire.subarray(head, head + 32) as Bytes;
  const nonce = wire.subarray(head + 32, head + 44);
  const sealed = wire.subarray(head + 44);
  const peer = await subtle.importKey("raw", ephemeralPub, { name: "X25519" }, false, []);
  const shared = await subtle.deriveBits({ name: "X25519", public: peer }, key.priv, 256);
  const aes = await contentKey(shared, concat(ephemeralPub, key.pub));

  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: WIRE_MAGIC as BufferSource }, aes, sealed as BufferSource));
  } catch {
    throw new Error("this transfer was sealed for a different receiver card");
  }
  return decodeBody(plain);
}

// ---- yazılan kodla gönderim ---------------------------------------------------
/*
 * Kartsız, anlık yol: alıcı (kameralı telefon) rastgele bir kod gösterir,
 * operatör onu gönderen bilgisayarın klavyesiyle yazar. Klavye, kamerası
 * olmayan cihaza giden tek geri kanaldır ve yeterlidir.
 *
 *  - Kod her aktarımda yenidir: kartın kalıcı anahtar bedeli (ileri gizlilik
 *    kaybı) burada yoktur.
 *  - 12 karakter × 5 bit = 60 bit. Ekranı çeken biri şifreli akışı ve tuzu
 *    görür; kodu kaba kuvvetle bulmak her deneme için 600.000 PBKDF2 turu ister,
 *    yani pratikte imkânsızdır.
 *  - Kodu bilmeyen biri alıcıya kendi akışını da gösteremez: GCM etiketi tutmaz.
 *  - Güvence, kodun yalnız alıcının ekranında görülmesine dayanır. Telefon
 *    ekranını da çeken bir kamera, iki yolda da oyunu kazanır.
 */
const CODE_MAGIC = te.encode("KIONEL-CODE-V2");
/** Crockford base32: 0/O ve 1/I/L karışmaz, yazarken hata payı düşer. */
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const TRANSFER_CODE_LENGTH = 12;
const CODE_ITERATIONS = 600_000;

export function createTransferCode(): string {
  // 256, 32'ye tam bölünür: alt 5 bit düzgün dağılır.
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(TRANSFER_CODE_LENGTH)),
    (byte) => CODE_ALPHABET[byte & 31]).join("");
}

export const formatTransferCode = (code: string): string => code.match(/.{1,4}/g)!.join("-");

/** Kullanıcının yazdığını kanonik koda çevirir; tire, boşluk, küçük harf, O/I/L hoş görülür. */
export function normalizeTransferCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return code.length === TRANSFER_CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c)) ? code : null;
}

async function codeKey(code: string, salt: Bytes): Promise<CryptoKey> {
  const base = await subtle.importKey("raw", te.encode(code), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: concat(CODE_MAGIC, salt), iterations: CODE_ITERATIONS }, base, 256);
  return subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export const isCodeWire = (wire: Bytes): boolean =>
  wire.length > CODE_MAGIC.length && CODE_MAGIC.every((byte, i) => wire[i] === byte);

/** Zarf: [sihir | tuz (16) | nonce (12) | şifreli gövde]. Gövde kart yoluyla aynı. */
export async function sealWithCode(
  sender: Identity, code: string, file: { name: string; data: Bytes }, context: DispatchContext,
): Promise<{ wire: Bytes; dispatch: Dispatch }> {
  const canonical = normalizeTransferCode(code);
  if (!canonical) throw new Error("the transfer code must have 12 characters");
  const digest = new Uint8Array(await subtle.digest("SHA-256", file.data as BufferSource));
  const session = new DataView(digest.buffer).getUint32(0) >>> 0;
  const dispatch = await issueDispatch(sender, { session, content: file.data, context });
  const body = await encodeBody(dispatch, file);
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await codeKey(canonical, salt);
  const sealed = new Uint8Array(await subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: CODE_MAGIC as BufferSource }, key, body as BufferSource));
  return { wire: concat(concat(CODE_MAGIC, concat(salt, nonce)), sealed), dispatch };
}

export async function openWithCode(code: string, wire: Bytes): Promise<OpenedOneWay> {
  const head = CODE_MAGIC.length;
  rejectOld(wire);
  if (!isCodeWire(wire) || wire.length < head + 16 + 12 + 16) throw new Error("not a code-sealed transfer");
  const key = await codeKey(code, wire.subarray(head, head + 16) as Bytes);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: wire.subarray(head + 16, head + 28),
      additionalData: CODE_MAGIC as BufferSource }, key, wire.subarray(head + 28) as BufferSource));
  } catch {
    throw new Error("the code does not open this transfer — check the code typed on the sender, or the code entered here");
  }
  return decodeBody(plain);
}
