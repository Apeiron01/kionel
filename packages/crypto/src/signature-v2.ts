// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import type { PlatformSigningIdentity } from "@kionel/platform-keys";

export type CryptoBytes = Uint8Array<ArrayBuffer>;
export type P256SigningIdentity = PlatformSigningIdentity & { algorithm: "ecdsa-p256-sha256" };

// Order of the NIST P-256 base point. Signatures use fixed-width IEEE P1363 r || s.
const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_HALF_ORDER = P256_ORDER >> 1n;

export function requireP256Identity(identity: PlatformSigningIdentity): asserts identity is P256SigningIdentity {
  if (identity.algorithm !== "ecdsa-p256-sha256") throw new Error("Kionel v2 yalnız ECDSA P-256/SHA-256 kimliği kabul eder");
  if (identity.publicKey.length !== 65 || identity.publicKey[0] !== 4) {
    throw new Error("Kionel v2 P-256 açık anahtarı 65 bayt sıkıştırılmamış SEC1 biçiminde olmalı");
  }
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(identity.keyId)) throw new Error("Kionel v2 keyId geçersiz");
}

export async function signEs256(identity: PlatformSigningIdentity, data: Uint8Array): Promise<CryptoBytes> {
  requireP256Identity(identity);
  const signature = await identity.sign(owned(data));
  return normalizeP256Signature(signature);
}

export async function verifyEs256(publicKey: Uint8Array, signature: Uint8Array, data: Uint8Array): Promise<boolean> {
  try {
    if (!validP256PublicKey(publicKey) || !isCanonicalP256Signature(signature)) return false;
    const key = await globalThis.crypto.subtle.importKey(
      "raw", owned(publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"],
    );
    return await globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" }, key, owned(signature), owned(data),
    );
  } catch {
    return false;
  }
}

export function normalizeP256Signature(value: Uint8Array): CryptoBytes {
  if (value.length !== 64) throw new Error("ES256 imzası 64 bayt IEEE P1363 biçiminde olmalı");
  const r = scalar(value.subarray(0, 32));
  let s = scalar(value.subarray(32));
  if (r <= 0n || r >= P256_ORDER || s <= 0n || s >= P256_ORDER) throw new Error("ES256 imza skalerleri aralık dışında");
  if (s > P256_HALF_ORDER) s = P256_ORDER - s;
  const out = owned(value);
  writeScalar(out.subarray(32), s);
  return out;
}

export function isCanonicalP256Signature(value: Uint8Array): boolean {
  if (value.length !== 64) return false;
  const r = scalar(value.subarray(0, 32));
  const s = scalar(value.subarray(32));
  return r > 0n && r < P256_ORDER && s > 0n && s <= P256_HALF_ORDER;
}

export function validP256PublicKey(value: Uint8Array): boolean {
  return value.length === 65 && value[0] === 4;
}

function scalar(value: Uint8Array): bigint {
  let result = 0n;
  for (const byte of value) result = (result << 8n) | BigInt(byte);
  return result;
}

function writeScalar(target: Uint8Array, value: bigint): void {
  for (let index = target.length - 1; index >= 0; index--) {
    target[index] = Number(value & 0xffn);
    value >>= 8n;
  }
}

export function owned(value: Uint8Array): CryptoBytes { return new Uint8Array(value) }
