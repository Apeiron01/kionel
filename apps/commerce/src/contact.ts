/**
 * İletişim formu.
 *
 * İşletmeci gerçek posta kutusunu sitede yayımlamak istemiyor ve bu makul: açıkta
 * duran bir adres spam toplar ve geri alınamaz. Form, mesajı veritabanına yazar;
 * işletmeci kendi kutusundan cevap verir, böylece adresi ilk yanıta kadar
 * görünmez kalır.
 *
 * Bunun hukuki disclosure'ın YERİNE geçmediğini açıkça söylemek gerekir: KVKK
 * aydınlatması ve e-ticaret mevzuatı yayımlanmış bir başvuru kanalı ister ve bir
 * form tek başına onu karşılamaz. O yüzden politika sayfalarında `privacy@`,
 * `security@` ve `abuse@` takma adları yayımlanıyor — bunlar Cloudflare Email
 * Routing üzerinden yönlendiği için kişisel adres yine görünmüyor. Form, satış
 * soruları için ek bir kanaldır; zorunlu kanalların yerini almaz.
 *
 * Sunucu tarafında hiçbir e-posta gönderilmez. Giden posta eklemek yeni bir
 * sağlayıcı, yeni bir alt işleyen ve yeni bir gizlilik açıklaması demektir;
 * mesajı okumak için panelde bir satır yeterliyken bu bedel ödenmez.
 */

import type { SiteEnv } from "./worker.ts";

const MAX_NAME = 120;
const MAX_EMAIL = 200;
const MAX_MESSAGE = 4000;
const MAX_ORG = 200;

/** Aynı IP'den kısa sürede gelen mesaj sayısı. Form açık bir kapıdır. */
const WINDOW_MINUTES = 10;
const MAX_PER_WINDOW = 3;

export interface ContactInput {
  name: string;
  email: string;
  organisation?: string;
  message: string;
  /** Bot tuzağı: insanlar bu alanı görmez, doldurulmuşsa gönderi sessizce yutulur. */
  website?: string;
}

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : undefined;
};

/** RFC'ye tam uyan bir kontrol değil; amacı yazım hatasını yakalamak. */
const emailish = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);

export function parseContact(body: unknown): ContactInput | { error: string } {
  if (!body || typeof body !== "object") return { error: "Invalid request." };
  const input = body as Record<string, unknown>;

  const name = text(input.name, MAX_NAME);
  const email = text(input.email, MAX_EMAIL);
  const message = text(input.message, MAX_MESSAGE);

  if (!name) return { error: "Name is required." };
  if (!email || !emailish(email)) return { error: "A valid email address is required." };
  if (!message) return { error: "Message is required." };

  return {
    name,
    email,
    organisation: text(input.organisation, MAX_ORG),
    message,
    website: typeof input.website === "string" ? input.website : undefined,
  };
}

/**
 * Mesajı kaydeder.
 *
 * Tuzak alanı doluysa `true` döner ama hiçbir şey yazılmaz. Bota "yakalandın"
 * demek, onu daha iyi denemeye iter; sessizce başarılı görünmek daha ucuzdur.
 */
export async function saveContact(
  env: SiteEnv,
  input: ContactInput,
  clientIp: string,
  now = new Date(),
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (input.website) return { ok: true };

  // IP doğrudan saklanmaz: amaç kimliği tutmak değil, hız sınırı uygulamak.
  // Özet, aynı kaynağı tanımaya yeter ve ziyaretçiyi kaydın kendisinde açık etmez.
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${clientIp}:${env.SITE_URL}`),
  );
  const sourceHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const since = new Date(now.getTime() - WINDOW_MINUTES * 60_000).toISOString();
  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM contact_messages WHERE source_hash = ? AND created_at > ?",
  ).bind(sourceHash, since).first<{ count: number }>();

  if ((recent?.count ?? 0) >= MAX_PER_WINDOW) {
    return { ok: false, status: 429, error: "Too many messages sent. Please try again later." };
  }

  await env.DB.prepare(
    "INSERT INTO contact_messages (id, name, email, organisation, message, source_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    crypto.randomUUID(),
    input.name,
    input.email,
    input.organisation ?? null,
    input.message,
    sourceHash,
    now.toISOString(),
  ).run();

  return { ok: true };
}
