import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker from "./worker.ts";
import { saveContact } from "./contact.ts";

let platform: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Parameters<typeof worker.fetch>[1];
beforeAll(async () => {
  platform = await getPlatformProxy<Env>({ configPath: fileURLToPath(new URL("../wrangler.jsonc", import.meta.url)), persist: false });
  // D1'in `exec` metodu tek satır ister; yorum satırları atılmazsa arkalarındaki
  // DDL de yorumun içinde kalır ve tablo sessizce oluşmaz.
  for (const migration of ["0001", "0002", "0003", "0004", "0005"]) {
    const sql = readFileSync(fileURLToPath(new URL(`../migrations/${migration}.sql`, import.meta.url)), "utf8");
    await platform.env.DB.exec(sql.split("\n").filter((line) => !line.trim().startsWith("--")).join(" "));
  }
  // SITE_URL is pinned so the origin check is tested, not the deployed domain.
  env = { ...platform.env, SITE_URL: "http://localhost:8787" };
}, 30_000);
afterAll(async () => { await platform?.dispose(); });
afterEach(() => { vi.unstubAllGlobals(); });

const allowed = () => ({ ...env, RATE_LIMITER: { limit: async () => ({ success: true }) } });
const contactRequest = (body: string, contentType = "application/json") => new Request("http://localhost:8787/api/contact", {
  method: "POST", headers: { "Content-Type": contentType, "CF-Connecting-IP": "192.0.2.10" }, body,
});

it("enforces the contact quota under concurrent D1 writes", async () => {
  const input = { name: "Audit", email: "audit@example.test", message: "Hello" };
  const time = new Date();
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => saveContact(env, input, "192.0.2.200", time)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.status === 429)).toHaveLength(7);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM contact_messages WHERE email=?")
      .bind(input.email).first("count")).toBe(3);
    // The quota expires and is independent for other sources.
    expect(await saveContact(env, input, "192.0.2.200", new Date(time.getTime() + 601_000))).toEqual({ ok: true });
    expect(await saveContact(env, input, "192.0.2.201", time)).toEqual({ ok: true });
  } finally {
    await env.DB.prepare("DELETE FROM contact_messages WHERE email=?").bind(input.email).run();
  }
});

it("rate limits contact requests before reading or parsing their bodies", async () => {
  const request = contactRequest("not json");
  const response = await worker.fetch(request, { ...env, RATE_LIMITER: { limit: async () => ({ success: false }) } });
  expect(response.status).toBe(429);
  expect(request.bodyUsed).toBe(false);
});

it("rejects oversized contact JSON and accepts a normal UTF-8 message", async () => {
  expect((await worker.fetch(contactRequest(" ".repeat(32 * 1024 + 1)), allowed())).status).toBe(413);
  expect((await worker.fetch(contactRequest("not json"), allowed())).status).toBe(400);
  expect((await worker.fetch(contactRequest("{}", "text/plain"), allowed())).status).toBe(415);
  const input = { name: "Ayşe", email: "utf8@example.test", message: "Merhaba 🌍" };
  try {
    expect((await worker.fetch(contactRequest(JSON.stringify(input), "application/json; charset=utf-8"), allowed())).status).toBe(200);
    expect(await env.DB.prepare("SELECT message FROM contact_messages WHERE email=?").bind(input.email).first("message")).toBe(input.message);
  } finally {
    await env.DB.prepare("DELETE FROM contact_messages WHERE email=?").bind(input.email).run();
  }
});

it("rejects oversized timestamp requests before contacting the authority", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  const response = await worker.fetch(new Request("http://localhost:8787/api/timestamp", {
    method: "POST", headers: { Origin: env.SITE_URL, "Content-Type": "application/timestamp-query" }, body: new Uint8Array(257),
  }), allowed());
  expect(response.status).toBe(413);
  expect(fetch).not.toHaveBeenCalled();
});

it("caps timestamp replies and cancels an oversized upstream stream", async () => {
  const query = new Uint8Array(64); query[0] = 0x30;
  query.set([0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01], 2);
  let cancelled = false;
  const upstream = new ReadableStream<Uint8Array>({
    pull(c) { c.enqueue(new Uint8Array(1024)); }, cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const fetch = vi.fn().mockResolvedValueOnce(new Response(upstream, { headers: { "Content-Type": "application/timestamp-reply" } }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "application/timestamp-reply" } }));
  vi.stubGlobal("fetch", fetch);
  const request = () => new Request("http://localhost:8787/api/timestamp", {
    method: "POST", headers: { Origin: env.SITE_URL, "Content-Type": "application/timestamp-query" }, body: query,
  });
  expect((await worker.fetch(request(), allowed())).status).toBe(502);
  expect(cancelled).toBe(true);
  const reply = await worker.fetch(request(), allowed());
  expect(reply.status).toBe(200);
  expect(new Uint8Array(await reply.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
});

it("no longer exposes the removed checkout, licence or price endpoints", async () => {
  for (const [method, path] of [["POST", "/api/checkout"], ["POST", "/api/polar/webhook"], ["GET", "/api/purchase"],
    ["GET", "/api/license"], ["GET", "/api/offer"], ["GET", "/api/license-authority"]] as const) {
    const response = await worker.fetch(new Request(`http://localhost:8787${path}`, { method, body: method === "POST" ? "{}" : undefined }), env);
    expect(response.status, path).toBe(404);
  }
});

it("relays timestamp queries only from the site's own origin", async () => {
  const response = await worker.fetch(new Request("http://localhost:8787/api/timestamp",
    { method: "POST", headers: { Origin: "https://evil.test", "Content-Type": "application/timestamp-query" }, body: new Uint8Array(64) }), env);
  expect(response.status).toBe(403);
});

it("deletes old enquiries and leftover commerce rows on the daily job", async () => {
  // Kişisel veriyi süresiz saklamak gizlilik metninde savunulamaz; temizlik işi
  // sessizce çalışmayı bırakırsa bunu kimse fark etmez, bu yüzden test edilir.
  const old = new Date(Date.now() - 400 * 86400_000).toISOString();
  const recent = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO contact_messages(id,name,email,organisation,message,source_hash,created_at) VALUES('old','A','a@b.test',NULL,'m','h',?)").bind(old),
    env.DB.prepare("INSERT INTO contact_messages(id,name,email,organisation,message,source_hash,created_at) VALUES('new','B','b@b.test',NULL,'m','h',?)").bind(recent),
    env.DB.prepare("INSERT INTO orders(id,checkout_id,state,license_json,updated_at) VALUES('old-order',NULL,'paid','{}',?)").bind(old),
    env.DB.prepare("INSERT INTO checkouts(id,token_hash,licensee,source,created_at,expires_at,plan) VALUES('old-checkout','hash-old','Lab','direct',?,?,'pilot')").bind(old, old),
  ]);
  await worker.scheduled(null, env);
  const ids = async (sql: string) => (await env.DB.prepare(sql).all()).results.map((r) => r.id);
  expect(await ids("SELECT id FROM contact_messages")).toEqual(["new"]);
  expect(await ids("SELECT id FROM orders WHERE id='old-order'")).toEqual([]);
  expect(await ids("SELECT id FROM checkouts WHERE id='old-checkout'")).toEqual([]);
});
