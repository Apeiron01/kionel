import { describe, expect, it } from "vitest";
import { parseContact, saveContact } from "./contact.ts";
import type { CommerceEnv } from "./worker.ts";

/** Sadece bu testin ihtiyaç duyduğu kadar D1. */
function fakeDb(rows: { count: number } = { count: 0 }) {
  const inserted: unknown[][] = [];
  const env = {
    SITE_URL: "https://example.test",
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              first: async () => (sql.startsWith("SELECT") ? rows : null),
              run: async () => { inserted.push(args); return { success: true }; },
            };
          },
        };
      },
    },
  } as unknown as CommerceEnv;
  return { env, inserted };
}

const VALID = { name: "Ayşe Yılmaz", email: "ayse@lab.example", message: "İzole cihazdan veri çıkarma konusunda görüşebilir miyiz?" };

describe("iletişim formu", () => {
  it("geçerli mesajı kabul eder", () => {
    expect(parseContact(VALID)).toMatchObject({ name: "Ayşe Yılmaz", email: "ayse@lab.example" });
  });

  it("eksik veya hatalı alanları reddeder", () => {
    expect(parseContact({ ...VALID, name: "  " })).toMatchObject({ error: expect.stringContaining("Name") });
    expect(parseContact({ ...VALID, email: "nokta-yok" })).toMatchObject({ error: expect.stringContaining("email") });
    expect(parseContact({ ...VALID, message: "" })).toMatchObject({ error: expect.stringContaining("Message") });
    expect(parseContact(null)).toMatchObject({ error: expect.any(String) });
  });

  it("aşırı uzun girdiyi kabul etmez", () => {
    expect(parseContact({ ...VALID, message: "x".repeat(4001) })).toMatchObject({ error: expect.any(String) });
    expect(parseContact({ ...VALID, name: "x".repeat(121) })).toMatchObject({ error: expect.any(String) });
  });

  it("mesajı kaydeder ve ham IP saklamaz", async () => {
    const { env, inserted } = fakeDb();
    expect(await saveContact(env, parseContact(VALID) as never, "203.0.113.9")).toEqual({ ok: true });
    expect(inserted).toHaveLength(1);
    // Kayıtta IP'nin kendisi bulunmamalı: amaç hız sınırı, kimlik değil.
    expect(JSON.stringify(inserted[0])).not.toContain("203.0.113.9");
  });

  it("bot tuzağı dolduğunda sessizce yutar", async () => {
    const { env, inserted } = fakeDb();
    const trapped = { ...(parseContact(VALID) as never), website: "http://spam.example" };
    expect(await saveContact(env, trapped, "203.0.113.9")).toEqual({ ok: true });
    // Bota "yakalandın" demek onu daha iyi denemeye iter; başarılı görünüp
    // hiçbir şey yazmamak daha ucuz.
    expect(inserted).toHaveLength(0);
  });

  it("aynı kaynaktan gelen seli durdurur", async () => {
    const { env, inserted } = fakeDb({ count: 3 });
    expect(await saveContact(env, parseContact(VALID) as never, "203.0.113.9"))
      .toMatchObject({ ok: false, status: 429 });
    expect(inserted).toHaveLength(0);
  });
});
