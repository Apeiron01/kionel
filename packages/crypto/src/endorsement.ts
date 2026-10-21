// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * Onay zinciri — dosyanın kendi geçmişini taşıması.
 *
 * Makbuz "bu dosya A'dan B'ye gitti" der. Laboratuvarın gerçekte ihtiyaç duyduğu
 * cümle bu değil: **"bu sonucu X üretti, Y inceledi, Z serbest bıraktı, W teslim
 * aldı."** Bugün bu cümlenin parçaları üç ayrı yerde durur — cihazın kendi
 * kaydında, LIMS denetim izinde ve kâğıt bir formda — ve hiçbiri dosyayla
 * birlikte seyahat etmez. İzole bir cihazda ise LIMS zaten yoktur; ikinci göz
 * incelemesi omuz üstünden yapılır ve hiçbir yere yazılmaz.
 *
 * Buradaki fikir: onay, dosyanın *hakkında* tutulan bir kayıt değil, dosyanın
 * *yanında taşıdığı* bir zincir olsun. Sunucu yok, hesap yok, LIMS yok; imzalar
 * dosyayla birlikte gider ve dosyayla birlikte doğrulanır.
 *
 * Üç tasarım kararı:
 *
 *  1. **Rol serbest metin değildir.** Anlamı belirsiz bir onay, onay değildir.
 *     "Uygundur" imzası neyin uygun olduğunu söylemiyorsa denetimde hiçbir şey
 *     ifade etmez.
 *  2. **Zincir bağlıdır.** Her halka bir öncekinin imzasına bağlanır, yani sıra
 *     kanıtlanabilir. İncelemenin serbest bırakmadan ÖNCE olduğunu göstermek,
 *     incelemenin olduğunu göstermek kadar önemlidir.
 *  3. **Sevk ve teslim kayıtlarına dokunulmaz.** Onaylar ayrı taşınır; bir
 *     dosyaya sonradan onay eklemek hiçbir imzayı düşürmez. Zaman damgasında
 *     olduğu gibi: mühürlenen şeyi değiştirmeden mühürlemek.
 */

import { b64, sha256, unb64 } from "./receipt.ts";
import type { Bytes } from "./index.ts";

/**
 * Onayın ne anlama geldiği. Kapalı liste, çünkü denetçinin okuyacağı şey bu.
 *
 * `analyst`   — sonucu üreten kişi
 * `reviewer`  — ikinci göz; GxP'de kritik veride zorunludur
 * `approver`  — serbest bırakma yetkisi olan kişi
 * `custodian` — fiziksel/dijital zilyetliği devralan
 * `recipient` — teslim alan taraf
 */
export const ENDORSEMENT_ROLES = ["analyst", "reviewer", "approver", "custodian", "recipient"] as const;
export type EndorsementRole = (typeof ENDORSEMENT_ROLES)[number];

/** Rolün Türkçe karşılığı — denetim çıktısında okunan metin. */
export const ROLE_LABELS: Readonly<Record<EndorsementRole, string>> = Object.freeze({
  analyst: "üreten",
  reviewer: "inceleyen",
  approver: "serbest bırakan",
  custodian: "zilyetliği devralan",
  recipient: "teslim alan",
});

export const MAX_REFERENCE = 120;
export const MAX_NOTE = 280;
export const MAX_CHAIN = 32;

export interface Endorsement {
  v: 1;
  /** İçeriğin SHA-256'sı, base64url. Sevk kaydındaki `hash` ile aynı olmalı. */
  hash: string;
  role: EndorsementRole;
  /** Numune, vaka veya iş emri referansı. */
  reference?: string;
  /** Sınırlı serbest metin: "spektrum yeniden değerlendirildi" gibi. */
  note?: string;
  /** ISO 8601. Cihaz saatidir; bağımsız zaman için makbuz mühürlenmelidir. */
  at: string;
  /** İmzalayanın Ed25519 açık anahtarı, base64url. */
  signer: string;
  /** Bir önceki halkanın imzası. İlk halkada null. Sırayı kanıtlar. */
  previous: string | null;
  sig: string;
}

export interface EndorsementVerdict {
  ok: boolean;
  reason: string;
  /** Doğrulanmış halkalar, sırayla: "inceleyen (a1b2…)" gibi. */
  chain: string[];
}

const te = (text: string): Bytes => new TextEncoder().encode(text);

export const endorsementBytes = (body: Omit<Endorsement, "sig">): Bytes =>
  te(JSON.stringify([
    "endorsement", body.v, body.hash, body.role,
    body.reference ?? null, body.note ?? null, body.at, body.signer, body.previous,
  ]));

async function check(signerB64: string, sigB64: string, data: Bytes): Promise<boolean> {
  try {
    const key = await globalThis.crypto.subtle.importKey("raw", unb64(signerB64), { name: "Ed25519" }, true, ["verify"]);
    return await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, unb64(sigB64), data);
  } catch {
    return false;
  }
}

export function validEndorsementText(value: string | undefined, limit: number): boolean {
  return value === undefined || (typeof value === "string" && value.length > 0 && value.length <= limit);
}

export function isEndorsement(value: unknown): value is Endorsement {
  if (!value || typeof value !== "object") return false;
  const item = value as Endorsement;
  const keys = new Set(Object.keys(item));
  for (const key of keys) {
    if (!["v", "hash", "role", "reference", "note", "at", "signer", "previous", "sig"].includes(key)) return false;
  }
  return item.v === 1 &&
    typeof item.hash === "string" && item.hash.length === 43 &&
    (ENDORSEMENT_ROLES as readonly string[]).includes(item.role) &&
    validEndorsementText(item.reference, MAX_REFERENCE) && validEndorsementText(item.note, MAX_NOTE) &&
    typeof item.at === "string" && !Number.isNaN(Date.parse(item.at)) &&
    typeof item.signer === "string" && item.signer.length === 43 &&
    (item.previous === null || (typeof item.previous === "string" && item.previous.length === 86)) &&
    typeof item.sig === "string" && item.sig.length === 86;
}

/**
 * Zinciri baştan sona doğrular.
 *
 * Tek tek imzaları doğrulamak yetmez: bir halkanın çıkarılmış ya da yeniden
 * sıralanmış olmadığını da göstermek gerekir. `previous` alanı tam olarak bunun
 * içindir ve burada zorunlu tutulur.
 */
export async function verifyEndorsements(
  chain: readonly unknown[],
  content?: Bytes,
): Promise<EndorsementVerdict> {
  const verified: string[] = [];
  if (!Array.isArray(chain)) return { ok: false, reason: "onay zinciri bir dizi değil", chain: verified };
  if (chain.length > MAX_CHAIN) return { ok: false, reason: "onay zinciri sınırı aşıyor", chain: verified };

  let expectedHash = content ? b64(await sha256(content)) : undefined;
  let previous: string | null = null;

  for (const [index, item] of chain.entries()) {
    if (!isEndorsement(item)) {
      return { ok: false, reason: `${index + 1}. onay biçimi geçersiz`, chain: verified };
    }
    expectedHash ??= item.hash;
    if (expectedHash && item.hash !== expectedHash) {
      return { ok: false, reason: `${index + 1}. onay başka bir içeriğe ait`, chain: verified };
    }
    if (item.previous !== previous) {
      // Sıranın kanıtı burada. Bir halkayı çıkarmak ya da yer değiştirmek bu
      // kontrolü düşürür; imzaların tek tek geçerli olması yetmez.
      return { ok: false, reason: `${index + 1}. onay zincire bağlanmıyor — halka çıkarılmış veya sıra değişmiş`, chain: verified };
    }

    const { sig, ...body } = item;
    if (!(await check(item.signer, sig, endorsementBytes(body)))) {
      return { ok: false, reason: `${index + 1}. onay imzası geçersiz`, chain: verified };
    }

    verified.push(`${ROLE_LABELS[item.role]} (${item.signer.slice(0, 8)}…)`);
    previous = sig;
  }

  return {
    ok: true,
    reason: verified.length ? `${verified.length} onay doğrulandı` : "onay zinciri boş",
    chain: verified,
  };
}

/**
 * Bir rolün zincirde bulunup bulunmadığı.
 *
 * Kurumun kendi kuralını uygulaması için: "serbest bırakılmadan önce inceleme
 * imzası olmalı" gibi bir kural bu iki yardımcıyla ifade edilir. Kuralı ürüne
 * gömmüyoruz çünkü hangi rolün zorunlu olduğu kurumdan kuruma değişir.
 */
export function hasRole(chain: readonly Endorsement[], role: EndorsementRole): boolean {
  return chain.some((link) => link.role === role);
}

/** `before` rolü `after` rolünden önce geliyor mu? Sıra kanıtlanabilir olduğu için sorulabilir. */
export function rolePrecedes(chain: readonly Endorsement[], before: EndorsementRole, after: EndorsementRole): boolean {
  const first = chain.findIndex((link) => link.role === before);
  const second = chain.findIndex((link) => link.role === after);
  return first !== -1 && second !== -1 && first < second;
}
