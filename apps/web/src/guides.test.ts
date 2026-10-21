import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GUIDES, GUIDE_DISCLAIMER } from "./guides.ts";

describe("rehber içeriği", () => {
  it("her rehber soruyu ilk paragrafta cevaplar", () => {
    // "Devamı aşağıda" diyen bir giriş hem okuyanı hem özetleyeni kaybeder.
    for (const guide of GUIDES) {
      expect(guide.answer.length, `${guide.slug}: cevap çok kısa`).toBeGreaterThan(120);
      expect(guide.answer).not.toMatch(/aşağıda|devamında|okumaya devam/i);
    }
  });

  it("mevzuattan söz eden her rehber kaynak gösterir", () => {
    for (const guide of GUIDES) {
      expect(guide.sources.length, `${guide.slug}: kaynak yok`).toBeGreaterThan(0);
      for (const source of guide.sources) expect(source.href).toMatch(/^https:\/\//);
    }
  });

  it("uyum garantisi veya sertifika iddiası içermez", () => {
    // Bu sayfaların değeri dürüstlükte. Bir uyum vaadi hem yanlış hem de
    // sayfanın alıntılanabilirliğini bitirir.
    const forbidden = [
      /uyumlu olursunuz/i, /uyumu garanti/i, /sertifika (?:veririz|sağlar)/i,
      /denetimden geçmenizi (?:sağlar|garanti)/i, /yasal (?:zorunluluk|gereklilik) yerine geçer/i,
    ];
    for (const guide of GUIDES) {
      const text = JSON.stringify(guide);
      for (const pattern of forbidden) {
        expect(text, `${guide.slug}: yasak iddia — ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("ürünü öne çıkarmak yerine alternatifleri de anlatır", () => {
    // Yalnız kendini öven bir sayfayı ne insan paylaşır ne model alıntılar.
    const pillar = GUIDES.find((guide) => guide.slug === "air-gap-dosya-aktarimi")!;
    const text = JSON.stringify(pillar).toLowerCase();
    for (const alternative of ["usb", "diyot", "kiosk", "baskı"]) {
      expect(text, `pillar sayfası ${alternative} seçeneğini anlatmalı`).toContain(alternative);
    }
    // Ürün adı geçse bile sayfanın merkezi olmamalı.
    expect((text.match(/kionel/g) ?? []).length).toBeLessThan(3);
  });

  it("slug'lar benzersiz ve ilgili bağlantılar gerçek sayfalara gider", () => {
    const slugs = new Set(GUIDES.map((guide) => guide.slug));
    expect(slugs.size).toBe(GUIDES.length);
    for (const guide of GUIDES) {
      for (const related of guide.related) {
        expect(slugs, `${guide.slug} → ${related} yok`).toContain(related);
      }
    }
  });

  it("üretilen sayfa yapısal veri ve feragat taşır", () => {
    const html = readFileSync(new URL("../air-gap-dosya-aktarimi.html", import.meta.url), "utf8");
    expect(html).toContain(String.raw`"@type":"FAQPage"`);
    expect(html).toContain(String.raw`"@type":"Article"`);
    expect(html).toContain(GUIDE_DISCLAIMER.slice(0, 40));
    // Rehber ürün sayfası değil: içine serpiştirilmiş çağrı olmamalı, tek CTA yeter.
    expect((html.match(/guide-cta/g) ?? []).length).toBeLessThanOrEqual(2);
  });
});
