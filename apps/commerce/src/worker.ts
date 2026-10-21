// SPDX-License-Identifier: AGPL-3.0-only
/**
 * kionel.com site worker: static assets, the RFC 3161 timestamp relay and the contact form.
 *
 * Kionel is open source (AGPL-3.0 with a commercial licence on request), so nothing is sold here:
 * the Polar checkout, licence delivery and price lookup that used to live in this worker were
 * removed when the code was published. The folder keeps its historical name.
 */
import type { Response as WorkerResponse } from "@cloudflare/workers-types";
import { parseContact, saveContact } from "./contact.ts";

export type SiteEnv = Env;
// Worker'ın kendi ürettiği yanıtlar _headers'tan geçmez; HSTS burada da olmalı
// (kök adresin yönlendirmesi dahil — HSTS preload denetimi oraya bakar).
const HSTS = "max-age=63072000; includeSubDomains; preload";
const json = (value: unknown, status = 200, extra: HeadersInit = {}) => new Response(JSON.stringify(value), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Strict-Transport-Security": HSTS, ...extra },
});

/**
 * RFC 3161 aktarıcısı: tarayıcı zaman damgası otoritesine doğrudan bağlanamaz
 * (CORS yok), bu yüzden istek buradan geçer. Gelen yalnız makbuzun SHA-256
 * izini taşıyan ~70 baytlık bir TimeStampReq'tir; dosya, ad veya kayıt değil.
 * Hiçbir şey saklanmaz ve günlüğe yazılmaz. Yanıt tarayıcıda DigiCert köküne
 * kadar doğrulanır: bu aktarıcıya güvenmek gerekmez.
 */
const TSA_URL = "http://timestamp.digicert.com";
async function timestamp(request: Request, env: SiteEnv): Promise<Response> {
  if (request.headers.get("Origin") !== env.SITE_URL) return json({ error: "Invalid origin" }, 403);
  if (!(await env.RATE_LIMITER.limit({ key: `tsa:${request.headers.get("CF-Connecting-IP") ?? "local"}` })).success) {
    return json({ error: "Too many timestamp requests. Try again in a minute." }, 429);
  }
  if (request.headers.get("Content-Type") !== "application/timestamp-query") return json({ error: "Expected a timestamp query" }, 415);
  const body = new Uint8Array(await request.arrayBuffer());
  // TimeStampReq: SEQUENCE, SHA-256 OID'i taşır, küçük. Başka her şey reddedilir.
  const sha256Oid = [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];
  const hasOid = body.some((_, i) => sha256Oid.every((byte, j) => body[i + j] === byte));
  if (body.length < 40 || body.length > 256 || body[0] !== 0x30 || !hasOid) return json({ error: "Not a SHA-256 timestamp query" }, 400);
  const reply = await fetch(TSA_URL, {
    method: "POST", headers: { "Content-Type": "application/timestamp-query" }, body, signal: AbortSignal.timeout(10_000),
  });
  if (!reply.ok || reply.headers.get("Content-Type") !== "application/timestamp-reply") {
    return json({ error: "The timestamp authority did not answer. Try again later." }, 502);
  }
  return new Response(await reply.arrayBuffer(), {
    headers: { "Content-Type": "application/timestamp-reply", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Strict-Transport-Security": HSTS },
  });
}

export default {
  async scheduled(_controller: unknown, env: SiteEnv): Promise<void> {
    const now = new Date();
    const cutoff = new Date(now); cutoff.setUTCMonth(cutoff.getUTCMonth() - 13);
    // Enquiries are personal data with no accounting reason to keep them: twelve
    // months is long enough to remember a conversation and short enough that the
    // privacy notice can promise deletion rather than "we keep it".
    const enquiries = new Date(now); enquiries.setUTCMonth(enquiries.getUTCMonth() - 12);
    // The checkout/order/subscription tables are left over from the closed-source period; they are
    // still emptied on the same schedule so no licensee name outlives the privacy notice.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM checkouts WHERE expires_at<?").bind(now.toISOString()),
      env.DB.prepare("DELETE FROM orders WHERE updated_at<?").bind(cutoff.toISOString()),
      env.DB.prepare("DELETE FROM contact_messages WHERE created_at<?").bind(enquiries.toISOString()),
      env.DB.prepare("DELETE FROM subscriptions WHERE updated_at<?").bind(cutoff.toISOString()),
    ]);
  },
  async fetch(request: Request, env: SiteEnv): Promise<Response | WorkerResponse> {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/") return new Response(null, { status: 302, headers: { Location: "/index.html", "Cache-Control": "no-store", "Strict-Transport-Security": HSTS } });
      if (path === "/api/timestamp" && request.method === "POST") return await timestamp(request, env);
      if (path === "/api/contact" && request.method === "POST") {
        const parsed = parseContact(await request.json().catch(() => null));
        if ("error" in parsed) return json({ error: parsed.error }, 400);
        // Cloudflare gerçek istemci IP'sini bu başlıkta verir; yoksa hız sınırı
        // tek bir kovaya düşer ve formu herkes için sıkılaştırır — açık kalmasından iyidir.
        const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
        const saved = await saveContact(env, parsed, ip);
        if (!saved.ok) return json({ error: saved.error }, saved.status);
        return json({ ok: true });
      }
      if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);
      if (!["GET", "HEAD"].includes(request.method)) return json({ error: "Method not allowed" }, 405);
      return await env.ASSETS.fetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers) });
    } catch (error) {
      // Type only: enough to tell failures apart without writing anything a support transcript should not contain.
      console.error(JSON.stringify({ event: "site_request_failed", path, requestId: crypto.randomUUID(),
        kind: error instanceof Error ? error.name : typeof error }));
      return json({ error: "The request could not be completed. Please try again." }, 503);
    }
  },
};
