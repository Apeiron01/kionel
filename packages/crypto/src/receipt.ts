// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * Teslim makbuzu — ürünü "dosya aracı"ndan ayıran parça.
 *
 * İki imza taşır:
 *   sevk (dispatch) — gönderen: "bu içeriği bu oturumda gönderdim"
 *   teslim (receipt) — alıcı:   "bu içeriği teslim aldım" + sevk imzasını da kapsar
 * Sonuç tek bir JSON: iki tarafça imzalı, çevrimdışı doğrulanabilir.
 *
 * KANITLAMAZ: anahtarın arkasındaki kişinin kim olduğunu. Kimlik bağlama bu
 * katmanın dışındadır — yüz yüze teslimde bunu göz teması sağlar.
 */
import type { Bytes } from "./index.ts";

export interface Dispatch {
  v: 1;
  session: number;
  /** İçeriğin SHA-256'sı, base64url. */
  hash: string;
  bytes: number;
  /** ISO 8601. Cihaz saatidir — güvenilir zaman damgası DEĞİLDİR. */
  at: string;
  /** Gönderenin Ed25519 açık anahtarı, base64url. */
  sender: string;
  /** Kullanım amacını ve kurum referansını imzaya bağlayan sınırlı ürün bağlamı. */
  context?: DispatchContext;
  sig: string;
}

export interface DispatchContext {
  profile: "lab" | "custody" | "personal";
  reference?: string;
  classification?: "public" | "internal" | "confidential" | "restricted";
  note?: string;
  /**
   * İşlemi yapan kişinin BEYAN ettiği ad ya da kimlik. Kimlik doğrulaması değildir:
   * imza bunun o anda yazıldığını ve değişmediğini kanıtlar, kimin yazdığını değil.
   */
  operator?: string;
}

export interface Receipt extends Omit<Dispatch, "sig"> {
  /** Alıcının — yani teslimi imzalayanın — açık anahtarı. */
  receiver: string;
  /** Gönderenin sevk kaydı. Yoksa makbuz tek imzalıdır. */
  dispatch?: Dispatch;
  sig: string;
}

export interface Verdict {
  ok: boolean;
  reason: string;
  /** Doğrulanmış imzalar: "alıcı" ve varsa "gönderen". */
  signers: string[];
}

export async function sha256(data: Bytes): Promise<Bytes> {
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
}

/**
 * Üçüncü bir taraf, hiçbir sunucuya sormadan doğrular.
 * `content` verilirse hash'in gerçekten o içeriğe ait olduğu da kontrol edilir.
 */
export async function verifyReceipt(r: Receipt, content?: Bytes): Promise<Verdict> {
  const signers: string[] = [];
  if (!isReceipt(r)) return { ok: false, reason: "makbuz biçimi veya alan sınırları geçersiz", signers };

  const { sig, ...body } = r;
  if (!(await check(r.receiver, sig, receiptBytes(body)))) {
    return { ok: false, reason: "alıcı imzası geçersiz", signers };
  }
  signers.push("alıcı");

  if (r.dispatch) {
    const { sig: dsig, ...dbody } = r.dispatch;
    if (dbody.session !== r.session || dbody.hash !== r.hash || dbody.bytes !== r.bytes || dbody.sender !== r.sender) {
      return { ok: false, reason: "sevk kaydı makbuzla tutarsız", signers };
    }
    if (!(await check(r.sender, dsig, dispatchBytes(dbody)))) {
      return { ok: false, reason: "gönderen imzası geçersiz", signers };
    }
    signers.push("gönderen");
  }

  if (content) {
    if (content.length !== r.bytes) return { ok: false, reason: "boyut uyuşmuyor", signers };
    if (b64(await sha256(content)) !== r.hash) return { ok: false, reason: "içerik hash'i uyuşmuyor", signers };
  }
  return {
    ok: true,
    reason: `${signers.join(" + ")} imzası doğrulandı${content ? ", içerik eşleşti" : " (içerik verilmedi)"}`,
    signers,
  };
}

/** Sevk kaydını, teslim makbuzu üretilmeden önce bağımsız olarak doğrular. */
export async function verifyDispatch(d: Dispatch, content?: Bytes): Promise<Verdict> {
  if (!isDispatch(d)) return { ok: false, reason: "sevk kaydı biçimi veya alan sınırları geçersiz", signers: [] };
  const { sig, ...body } = d;
  if (!(await check(d.sender, sig, dispatchBytes(body)))) {
    return { ok: false, reason: "gönderen imzası geçersiz", signers: [] };
  }
  if (content) {
    if (content.length !== d.bytes) return { ok: false, reason: "boyut uyuşmuyor", signers: ["gönderen"] };
    if (b64(await sha256(content)) !== d.hash) {
      return { ok: false, reason: "içerik hash'i uyuşmuyor", signers: ["gönderen"] };
    }
  }
  return {
    ok: true,
    reason: `gönderen imzası doğrulandı${content ? ", içerik eşleşti" : " (içerik verilmedi)"}`,
    signers: ["gönderen"],
  };
}

export function isReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== "object") return false;
  const r = value as Receipt;
  return r.v === 1 && uint32(r.session) && Number.isSafeInteger(r.bytes) && r.bytes >= 0 && r.bytes <= 1024 * 1024 * 1024 &&
    digest(r.hash) && timestamp(r.at) && publicKey(r.sender) && publicKey(r.receiver) && signature(r.sig) &&
    (r.dispatch === undefined || isDispatch(r.dispatch));
}

function isDispatch(value: unknown): value is Dispatch {
  if (!value || typeof value !== "object") return false;
  const d = value as Dispatch;
  return d.v === 1 && uint32(d.session) && Number.isSafeInteger(d.bytes) && d.bytes >= 0 && d.bytes <= 1024 * 1024 * 1024 &&
    digest(d.hash) && timestamp(d.at) && publicKey(d.sender) && signature(d.sig) &&
    (d.context === undefined || validContext(d.context));
}

export function validContext(value: DispatchContext): boolean {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  if (keys.some((key) => !["profile", "reference", "classification", "note", "operator"].includes(key))) return false;
  if (!["lab", "custody", "personal"].includes(value.profile)) return false;
  if (value.reference !== undefined && (typeof value.reference !== "string" || value.reference.length > 120)) return false;
  if (value.note !== undefined && (typeof value.note !== "string" || value.note.length > 240)) return false;
  if (value.operator !== undefined && (typeof value.operator !== "string" || !value.operator.trim() || value.operator.length > 80)) return false;
  return value.classification === undefined || ["public", "internal", "confidential", "restricted"].includes(value.classification);
}

const uint32 = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const digest = (value: string) => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const publicKey = digest;
const signature = (value: string) => typeof value === "string" && /^[A-Za-z0-9_-]{86}$/.test(value);
const timestamp = (value: string) => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));

// İmzalanan baytlar sabit alan sırasıyla üretilir: JSON anahtar sırası değişse bile imza tutar.
// Makbuz, sevk imzasını da kapsar — iki kayıt birbirinden koparılamaz.
export const dispatchBytes = (b: Omit<Dispatch, "sig">) => {
  const base: unknown[] = ["dispatch", b.v, b.session, b.hash, b.bytes, b.at, b.sender];
  // Bağlamsız eski v1 kayıtlarının imza baytlarını değiştirme.
  if (b.context) {
    const context: unknown[] = [b.context.profile, b.context.reference ?? null, b.context.classification ?? null, b.context.note ?? null];
    // Operatör yalnız varsa eklenir: operatörsüz kayıtların imza baytları değişmez.
    if (b.context.operator !== undefined) context.push(b.context.operator);
    base.push(context);
  }
  return te(JSON.stringify(base));
};

export const receiptBytes = (b: Omit<Receipt, "sig">) =>
  te(JSON.stringify(["receipt", b.v, b.session, b.hash, b.bytes, b.at, b.sender, b.receiver, b.dispatch?.sig ?? null]));

function te(s: string): Bytes {
  return new TextEncoder().encode(s);
}

async function check(pubB64: string, sigB64: string, data: Bytes): Promise<boolean> {
  try {
    const key = await globalThis.crypto.subtle.importKey("raw", unb64(pubB64), { name: "Ed25519" }, true, ["verify"]);
    return await globalThis.crypto.subtle.verify({ name: "Ed25519" }, key, unb64(sigB64), data);
  } catch {
    return false;
  }
}

export function b64(bytes: Bytes): string {
  // Parça parça: tüm baytları tek çağrıya yaymak, yüz KB'ı aşan dosyada
  // "Maximum call stack size exceeded" ile düşüyordu.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function unb64(s: string): Bytes {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
}
