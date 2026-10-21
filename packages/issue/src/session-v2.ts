// SPDX-License-Identifier: AGPL-3.0-only
/** v2 el sıkışma — ÜRETİM. Bkz. LICENSING-MAP.md. */
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import {
  SAS_MARK_LENGTH, owned, requireP256Identity, signEs256, verifyEs256, type CryptoBytes,
} from "@kionel/crypto";

const VERSION = 2;
const ALGORITHM_ES256 = 2;
const ROLE_OFFER = 1;
const ROLE_REPLY = 2;
const OFF = { ver: 0, role: 1, alg: 2, identity: 3, x: 68, nonce: 100, time: 116, confirm: 124, sig: 140 } as const;
export const V2_HANDSHAKE_RECORD_BYTES = 204;
export const MAX_V2_RECORD_AGE_MS = 120_000;
const textEncoder = new TextEncoder();


export interface SessionV2 {
  wireVersion: 2;
  algorithm: "ecdsa-p256-sha256";
  sas: string;
  /** Beş sembol indeksi (0-31). Glif değil — bkz. @kionel/crypto SAS_MARK_COUNT. */
  sasMarks: readonly number[];
  peer: CryptoBytes;
  sessionId: number;
  seal(plain: CryptoBytes): Promise<CryptoBytes>;
  open(sealed: CryptoBytes): Promise<CryptoBytes>;
}

export interface PendingV2 {
  identity: PlatformSigningIdentity;
  kxPriv: CryptoKey;
  offer: CryptoBytes;
  used: boolean;
}

export async function createOfferV2(
  identity: PlatformSigningIdentity,
): Promise<{ offer: CryptoBytes; pending: PendingV2 }> {
  requireP256Identity(identity);
  const kx = await x25519Pair();
  const offer = await writeRecordV2(
    ROLE_OFFER, identity, kx.publicKey, globalThis.crypto.getRandomValues(new Uint8Array(16)), false,
  );
  return { offer, pending: { identity, kxPriv: kx.privateKey, offer, used: false } };
}

export async function answerOfferV2(
  identity: PlatformSigningIdentity,
  offer: CryptoBytes,
): Promise<{ reply: CryptoBytes; session: SessionV2 }> {
  requireP256Identity(identity);
  const peer = await readRecordV2(offer, ROLE_OFFER);
  const kx = await x25519Pair();
  const shared = await sharedSecret(kx.privateKey, peer.xPub);
  const draft = await writeRecordV2(
    ROLE_REPLY, identity, kx.publicKey, offer.subarray(OFF.nonce, OFF.time), true,
  );
  const confirm = await derive(shared, handshakeTranscript(offer, draft), "kionel/v2/confirm", 128);
  draft.set(confirm, OFF.confirm);
  const reply = await signRecordV2(draft, identity);
  return { reply, session: await makeSessionV2(shared, offer, reply, peer.identityPub) };
}

export async function finishOfferV2(pending: PendingV2, reply: CryptoBytes): Promise<SessionV2> {
  if (pending.used) throw new Error("Kionel v2 teklifi zaten kullanıldı");
  const peer = await readRecordV2(reply, ROLE_REPLY);
  if (!equal(reply.subarray(OFF.nonce, OFF.time), pending.offer.subarray(OFF.nonce, OFF.time))) {
    throw new Error("Kionel v2 nonce uyuşmuyor: cevap bu teklife ait değil");
  }
  const shared = await sharedSecret(pending.kxPriv, peer.xPub);
  const expected = await derive(shared, handshakeTranscript(pending.offer, reply), "kionel/v2/confirm", 128);
  if (!equal(expected, reply.subarray(OFF.confirm, OFF.sig))) {
    throw new Error("Kionel v2 anahtar teyidi başarısız");
  }
  pending.used = true;
  return makeSessionV2(shared, pending.offer, reply, peer.identityPub);
}

async function writeRecordV2(
  role: number,
  identity: PlatformSigningIdentity,
  xPub: CryptoKey,
  nonce: Uint8Array,
  draft: boolean,
): Promise<CryptoBytes> {
  requireP256Identity(identity);
  if (nonce.length !== 16) throw new Error("Kionel v2 nonce 16 bayt olmalı");
  const record = new Uint8Array(V2_HANDSHAKE_RECORD_BYTES);
  record[OFF.ver] = VERSION;
  record[OFF.role] = role;
  record[OFF.alg] = ALGORITHM_ES256;
  record.set(identity.publicKey, OFF.identity);
  record.set(new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", xPub)), OFF.x);
  record.set(nonce, OFF.nonce);
  new DataView(record.buffer).setBigUint64(OFF.time, BigInt(Date.now()));
  return draft ? record : signRecordV2(record, identity);
}

async function signRecordV2(record: CryptoBytes, identity: PlatformSigningIdentity): Promise<CryptoBytes> {
  record.set(await signEs256(identity, record.subarray(0, OFF.sig)), OFF.sig);
  return record;
}

async function readRecordV2(
  record: CryptoBytes,
  expectedRole: number,
): Promise<{ identityPub: CryptoBytes; xPub: CryptoBytes }> {
  if (record.length !== V2_HANDSHAKE_RECORD_BYTES || record[OFF.ver] !== VERSION) {
    throw new Error("geçersiz Kionel v2 el sıkışma kaydı");
  }
  if (record[OFF.role] !== expectedRole) throw new Error("Kionel v2 rol uyuşmuyor");
  if (record[OFF.alg] !== ALGORITHM_ES256) throw new Error("Kionel v2 algoritma uyuşmuyor veya downgrade denemesi");
  const age = Date.now() - Number(new DataView(record.buffer, record.byteOffset, record.byteLength).getBigUint64(OFF.time));
  if (Math.abs(age) > MAX_V2_RECORD_AGE_MS) throw new Error("Kionel v2 kaydının süresi dolmuş veya saatler uyuşmuyor");
  const identityPub = owned(record.subarray(OFF.identity, OFF.x));
  if (!(await verifyEs256(identityPub, record.subarray(OFF.sig), record.subarray(0, OFF.sig)))) {
    throw new Error("Kionel v2 imzası doğrulanmadı");
  }
  return { identityPub, xPub: owned(record.subarray(OFF.x, OFF.nonce)) };
}

async function x25519Pair(): Promise<CryptoKeyPair> {
  return await globalThis.crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]) as CryptoKeyPair;
}

async function sharedSecret(privateKey: CryptoKey, peerPublic: CryptoBytes): Promise<ArrayBuffer> {
  const publicKey = await globalThis.crypto.subtle.importKey("raw", peerPublic, { name: "X25519" }, false, []);
  return globalThis.crypto.subtle.deriveBits({ name: "X25519", public: publicKey }, privateKey, 256);
}

function handshakeTranscript(offer: CryptoBytes, reply: CryptoBytes): CryptoBytes {
  return join(
    textEncoder.encode("KIONEL-V2-HANDSHAKE\0"),
    offer.subarray(0, OFF.confirm),
    reply.subarray(0, OFF.confirm),
  );
}

async function derive(
  shared: ArrayBuffer,
  salt: CryptoBytes,
  label: string,
  bits: number,
): Promise<CryptoBytes> {
  const key = await globalThis.crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits({
    name: "HKDF", hash: "SHA-256", salt, info: textEncoder.encode(label),
  }, key, bits));
}

async function makeSessionV2(
  shared: ArrayBuffer,
  offer: CryptoBytes,
  reply: CryptoBytes,
  peer: CryptoBytes,
): Promise<SessionV2> {
  const transcript = join(textEncoder.encode("KIONEL-V2-SESSION\0"), offer, reply);
  const contentKeyBytes = await derive(shared, transcript, "kionel/v2/content", 256);
  const contentKey = await globalThis.crypto.subtle.importKey("raw", contentKeyBytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  const digits = await derive(shared, transcript, "kionel/v2/sas-digits", 32);
  const symbols = await derive(shared, transcript, "kionel/v2/sas-symbols", 64);
  const session = await derive(shared, transcript, "kionel/v2/session-id", 32);
  return {
    wireVersion: 2,
    algorithm: "ecdsa-p256-sha256",
    sas: String(new DataView(digits.buffer).getUint32(0) % 1_000_000).padStart(6, "0"),
    sasMarks: Array.from(symbols.subarray(0, SAS_MARK_LENGTH), (byte) => byte & 31),
    peer: owned(peer),
    sessionId: new DataView(session.buffer).getUint32(0),
    async seal(plain) {
      const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
      return join(iv, new Uint8Array(await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: textEncoder.encode("KIONEL-V2-CONTENT") }, contentKey, plain,
      )));
    },
    async open(sealed) {
      if (sealed.length < 28) throw new Error("Kionel v2 mühürlü içerik çok kısa");
      const iv = sealed.subarray(0, 12);
      return new Uint8Array(await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: textEncoder.encode("KIONEL-V2-CONTENT") },
        contentKey,
        sealed.subarray(12),
      ));
    },
  };
}

function join(...parts: Uint8Array[]): CryptoBytes {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length }
  return output;
}

function equal(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}
