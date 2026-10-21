// SPDX-License-Identifier: AGPL-3.0-only
/**
 * v1 el sıkışma — ÜRETİM. Bkz. LICENSING-MAP.md.
 *
 * El sıkışma sürekli çift yönlü kanal İSTEMEZ. Alıcı tek bir sabit kare
 * (teklif) gösterir, gönderen onu bir kez okur. Bundan sonrası tek yönlü akış.
 *
 * Sertleştirmeler:
 *  - her oturumda yeni geçici X25519 çifti  -> ileri gizlilik
 *  - kayıtta rol alanı                      -> teklifi cevap diye yansıtma engeli
 *  - kayıtta zaman + tek kullanım           -> fotoğraflanan karenin sonra oynatılması engeli
 *  - anahtar teyit etiketi                  -> yanlış eş, akış başlamadan yakalanır
 *  - İKİ bağımsız SAS faktörü               -> ortadaki adamın ikisini birden tutturması gerekir
 *
 * Korumadıkları: ele geçirilmiş cihaz, kilitsiz telefon, ekranı filme alan
 * üçüncü bir kamera. Ayrıntı için THREAT-MODEL.md.
 */
import { SAS_MARK_LENGTH, concat, type Bytes, type Identity, type Pending, type Session } from "@kionel/crypto";

const VERSION = 1;
const te = new TextEncoder();
const subtle = globalThis.crypto.subtle;

/** El sıkışma kaydı — küçük bir QR'a sığar (170 bayt, v9-L kapasitesi 230). */
const OFF = { ver: 0, role: 1, ed: 2, x: 34, nonce: 66, time: 82, confirm: 90, sig: 106 } as const;
const RECORD_BYTES = 170;
const Role = { Offer: 1, Reply: 2 } as const;

/**
 * Fotoğraflanan bir teklif karesinin saatler sonra cevaplanmasını engeller.
 * Cihaz saatlerinin kabaca doğru olduğunu varsayar (bkz. THREAT-MODEL).
 */
export const MAX_RECORD_AGE_MS = 120_000;

/** ADIM 1 — alıcı: gösterilecek teklif karesini üretir. */
export async function createOffer(id: Identity): Promise<{ offer: Bytes; pending: Pending }> {
  const kx = (await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const offer = await writeRecord(Role.Offer, id, kx.publicKey, globalThis.crypto.getRandomValues(new Uint8Array(16)));
  return { offer, pending: { id, kxPriv: kx.privateKey, offer, used: false } };
}

/** ADIM 2 — gönderen: teklifi doğrular, cevabını üretir, oturumu kurar. */
export async function answerOffer(id: Identity, offer: Bytes): Promise<{ reply: Bytes; session: Session }> {
  const peer = await readRecord(offer, Role.Offer);
  const kx = (await subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const shared = await sharedSecret(kx.privateKey, peer.xPub);

  // Teyit etiketi cevabın kendisine bağlı olduğu için önce imzasız gövde yazılır.
  const draft = await writeRecord(Role.Reply, id, kx.publicKey, offer.subarray(OFF.nonce, OFF.time), true);
  const confirm = await derive(shared, transcript(offer, draft), "kionel/confirm", 128);
  draft.set(confirm, OFF.confirm);
  const reply = await sign(draft, id);

  return { reply, session: await makeSession(shared, offer, reply, peer.edPub) };
}

/** ADIM 3 — alıcı: cevabı okur, teyit eder, aynı oturumu kurar. SAS iki tarafta aynı çıkmalı. */
export async function finishOffer(pending: Pending, reply: Bytes): Promise<Session> {
  if (pending.used) throw new Error("bu teklif zaten kullanıldı");
  const peer = await readRecord(reply, Role.Reply);
  if (!eq(reply.subarray(OFF.nonce, OFF.time), pending.offer.subarray(OFF.nonce, OFF.time))) {
    throw new Error("nonce uyuşmuyor: cevap bu teklife ait değil");
  }
  const shared = await sharedSecret(pending.kxPriv, peer.xPub);
  const expected = await derive(shared, transcript(pending.offer, reply), "kionel/confirm", 128);
  if (!eq(expected, reply.subarray(OFF.confirm, OFF.sig))) {
    throw new Error("anahtar teyidi başarısız: karşı taraf aynı anahtarı türetmedi");
  }
  pending.used = true;
  return makeSession(shared, pending.offer, reply, peer.edPub);
}

// ---- kayıt biçimi ----------------------------------------------------------

async function writeRecord(
  role: number, id: Identity, xPub: CryptoKey, nonce: Uint8Array, draft = false,
): Promise<Bytes> {
  const rec = new Uint8Array(RECORD_BYTES);
  rec[OFF.ver] = VERSION;
  rec[OFF.role] = role; // rol alanı: teklifin cevap diye yansıtılmasını engeller
  rec.set(id.pub, OFF.ed);
  rec.set(new Uint8Array(await subtle.exportKey("raw", xPub)), OFF.x);
  rec.set(nonce, OFF.nonce);
  new DataView(rec.buffer).setBigUint64(OFF.time, BigInt(Date.now()));
  return draft ? rec : sign(rec, id);
}

async function sign(rec: Bytes, id: Identity): Promise<Bytes> {
  rec.set(new Uint8Array(await subtle.sign({ name: "Ed25519" }, id.priv, rec.subarray(0, OFF.sig))), OFF.sig);
  return rec;
}

async function readRecord(rec: Bytes, role: number): Promise<{ edPub: Bytes; xPub: Bytes }> {
  if (rec.length !== RECORD_BYTES || rec[OFF.ver] !== VERSION) throw new Error("geçersiz el sıkışma kaydı");
  if (rec[OFF.role] !== role) throw new Error("rol uyuşmuyor: kayıt yansıtılmış olabilir");

  const age = Date.now() - Number(new DataView(rec.buffer, rec.byteOffset).getBigUint64(OFF.time));
  if (Math.abs(age) > MAX_RECORD_AGE_MS) throw new Error("kayıt süresi dolmuş veya saatler uyuşmuyor");

  const edPub = rec.subarray(OFF.ed, OFF.x);
  const key = await subtle.importKey("raw", edPub, { name: "Ed25519" }, true, ["verify"]);
  if (!(await subtle.verify({ name: "Ed25519" }, key, rec.subarray(OFF.sig), rec.subarray(0, OFF.sig)))) {
    throw new Error("imza doğrulanmadı");
  }
  return { edPub: new Uint8Array(edPub), xPub: rec.subarray(OFF.x, OFF.nonce) };
}

// ---- anahtar türetme -------------------------------------------------------

async function sharedSecret(priv: CryptoKey, peerXPub: Bytes): Promise<ArrayBuffer> {
  const pub = await subtle.importKey("raw", peerXPub, { name: "X25519" }, false, []);
  return subtle.deriveBits({ name: "X25519", public: pub }, priv, 256);
}

/** Transkript imzasız gövdelerdir: iki taraf da imzayı görmeden aynı değeri üretebilir. */
function transcript(offer: Bytes, reply: Bytes): Bytes {
  return concat(offer.subarray(0, OFF.confirm), reply.subarray(0, OFF.confirm));
}

async function derive(shared: ArrayBuffer, salt: Bytes, label: string, bits: number): Promise<Bytes> {
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info: te.encode(label) }, hk, bits),
  );
}

async function makeSession(shared: ArrayBuffer, offer: Bytes, reply: Bytes, peer: Bytes): Promise<Session> {
  // Salt olarak tam transkript: anahtar, gerçekten görülen el sıkışmaya bağlanır.
  const salt = concat(offer, reply);
  const keyBytes = await derive(shared, salt, "kionel/content", 256);
  const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);

  // İki faktör AYRI türetilir: ortadaki adamın ikisini aynı anda tutturması gerekir
  // (~20 bit + ~25 bit). Tek uzun kod yerine iki kısa kod, çünkü uzun kodu kimse karşılaştırmaz.
  const d = await derive(shared, salt, "kionel/sas", 32);
  // HKDF etiketi kasıtlı olarak DEĞİŞTİRİLMEDİ. Artık emoji üretmiyoruz ama bu
  // dize türetilen baytların içine giriyor: kozmetik bir yeniden adlandırma, v1
  // istemcilerinin birbiriyle farklı SAS üretmesine yol açardı. v2 zaten doğru
  // adı kullanıyor ("kionel/v2/sas-symbols").
  const e = await derive(shared, salt, "kionel/sas-emoji", 64);
  const idBytes = await derive(shared, salt, "kionel/session", 32);

  return {
    sas: String(new DataView(d.buffer).getUint32(0) % 1_000_000).padStart(6, "0"),
    sasMarks: Array.from(e.subarray(0, SAS_MARK_LENGTH), (b) => b & 31),
    peer,
    sessionId: new DataView(idBytes.buffer).getUint32(0),
    async seal(plain) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      return concat(iv, new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, plain)));
    },
    async open(sealed) {
      const iv = sealed.subarray(0, 12);
      return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv }, key, sealed.subarray(12)));
    },
  };
}

/** Sabit zamanlı: karşılaştırma süresinden bilgi sızmasın. */
function eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

