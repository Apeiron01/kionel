import { beforeAll, afterAll, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import worker from "./worker.ts";

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
