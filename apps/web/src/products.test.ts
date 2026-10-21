import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PRODUCT_OFFERS, TRANSFER_PRODUCT_UI, createPilotBrief, isTransferProductProfile, recommendedOffer,
} from "./products.ts";

describe("Kionel satış ürün kataloğu", () => {
  it("B2B ve OEM tekliflerini benzersiz ve dürüst hazırlık durumuyla yayınlar", () => {
    expect(PRODUCT_OFFERS).toHaveLength(4);
    expect(new Set(PRODUCT_OFFERS.map((offer) => offer.id)).size).toBe(4);
    // Kionel Proof listenin başında: müşteriden iş akışını değiştirmesini
    // istemeyen tek teklif o, dolayısıyla giriş noktası da o.
    expect(PRODUCT_OFFERS[0].id).toBe("proof");
    // Ve tek ayırt edici özelliği: kamera ya da ikinci cihaz istemiyor.
    expect(PRODUCT_OFFERS[0].deployment).toMatch(/kamera ve ikinci cihaz gerekmez/);
    expect(new Set(PRODUCT_OFFERS.map((offer) => offer.segment))).toEqual(new Set(["b2b", "oem"]));
    expect(PRODUCT_OFFERS.every((offer) => offer.availability !== undefined && offer.availability !== ("ga" as never))).toBe(true);
  });

  it("her ihtiyacı doğru ürüne yönlendirir", () => {
    // Giriş noktası: iş akışını değiştirmek istemeyen kuruma Proof gider.
    expect(recommendedOffer("existing-transport").id).toBe("proof");
    expect(recommendedOffer("isolated-systems").id).toBe("lab-bridge");
    expect(recommendedOffer("chain-of-custody").id).toBe("chain-proof");
    expect(recommendedOffer("embed").id).toBe("core-sdk");
  });

  it("çalışan aktarım profillerini satış kataloğuyla birebir bağlar", () => {
    const profiles = PRODUCT_OFFERS.flatMap((offer) => offer.profile ? [offer.profile] : []);
    expect(new Set(profiles)).toEqual(new Set(Object.keys(TRANSFER_PRODUCT_UI)));
    expect(isTransferProductProfile("custody")).toBe(true);
    expect(isTransferProductProfile("core-sdk")).toBe(false);
  });

  it("kişisel veri veya içerik taşımayan deterministik pilot kapsamı üretir", () => {
    const brief = createPilotBrief({
      need: "isolated-systems", sites: 2, devices: 8, deploymentBoundary: "air-gap",
      identityTrust: "hardware-required", integration: "standalone",
    }, new Date("2026-08-12T10:00:00.000Z"));
    expect(brief).toMatchObject({ schema: "kionel-pilot-brief/v1", product: "lab-bridge", qualificationRequired: true });
    expect(JSON.stringify(brief).toLowerCase()).not.toMatch(/email|contact|customername|filecontent|payload/);
    expect(() => createPilotBrief({ ...brief.scope, devices: 1 })).toThrow(/geçersiz/);
    expect(() => createPilotBrief({ ...brief.scope, email: "operator@example.com" } as never)).toThrow(/geçersiz/);
  });

  it("satış sayfası ürün, dağıtım, pilot ve dürüst güven sınırı bölümlerini içerir", () => {
    const html = readFileSync(new URL("../products.html", import.meta.url), "utf8");
    for (const id of ["fit", "products", "technology", "deployment", "pilot-scope", "pilot-form"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("otomatik mevzuat uyumlu ilan edilmez");
    expect(html).not.toMatch(/<form[^>]+action=/i);
  });

  it("satış kataloğundaki her teklif statik HTML'de tek kart olarak bulunur", () => {
    const html = readFileSync(new URL("../products.html", import.meta.url), "utf8");
    for (const offer of PRODUCT_OFFERS) {
      expect(html.match(new RegExp(`id="${offer.id}"`, "g"))).toHaveLength(1);
      expect(html).toContain(`data-segment="${offer.segment}"`);
    }
  });

  it("hareket azaltma tercihi bütün satış animasyonlarını kapatır", () => {
    // Hareket artık tek yerde tanımlı: kionel.css. Sayfa stilleri onu içe aktarır,
    // dolayısıyla kapı da tek yerdedir — her sayfada ayrı ayrı tekrarlanmaz.
    const design = readFileSync(new URL("./kionel.css", import.meta.url), "utf8");
    expect(readFileSync(new URL("./products.css", import.meta.url), "utf8")).toContain('@import "./kionel.css"');
    expect(design).toContain("@media (prefers-reduced-motion: reduce)");
    expect(design).toContain("animation-duration: .001ms !important");
    for (const primitive of ["[data-reveal]", "[data-mask]", "[data-magnetic]"]) {
      expect(design).toContain(primitive);
    }
  });
});

describe("Kionel politika merkezi", () => {
  it("temel politikaları taşır ve hiçbirini taslak diye sunmaz", () => {
    const html = readFileSync(new URL("../policies.html", import.meta.url), "utf8");
    for (const id of ["privacy", "storage", "terms", "acceptable-use", "security", "accessibility", "sources"]) {
      expect(html).toContain(`id="${id}"`);
    }
    // Yürürlükteki bir hukuki metni "taslak" diye sunmak metnin kendisini
    // dayanaksız bırakır. Sayfa legal/ dizininden üretilir; orada taslak yoktur.
    expect(html).not.toMatch(/taslak/i);
    expect(html).not.toMatch(/bağlayıcı metin değil/i);
    // Sayfa yayına hazır olana kadar noindex'tir; tüzel alanlar doldurulup
    // indeksleme açıldığında index olur. Test edilen şey, robots etiketinin
    // yayın hazırlığı tarafından YÖNETİLDİĞİ: elle yazılmış bir etiket kalmamalı.
    expect(html).toMatch(/<!-- launch-meta --><meta name="robots" content="(index,follow|noindex,nofollow)">/);
    expect(html).not.toMatch(/<form\b/i);
    expect(html).not.toMatch(/<(?:script|img)[^>]+(?:src)=['"]https?:/i);
  });

  it("sayfa metinleri legal/ kaynağından üretilmiş olarak kalır", () => {
    const html = readFileSync(new URL("../policies.html", import.meta.url), "utf8");
    const flat = (value: string) => value.replace(/\s+/g, " ");
    for (const [file, probe] of [
      ["GIZLILIK.md", "Aktarılan içerik"],
      ["KULLANIM-SARTLARI.md", "Kullanım Şartları"],
      ["KABUL-EDILEBILIR-KULLANIM.md", "Kabul Edilebilir Kullanım"],
      ["GUVENLIK-BILDIRIMI.md", "Güvenlik Açığı"],
    ] as const) {
      const source = readFileSync(new URL(`../../../legal/${file}`, import.meta.url), "utf8");
      expect(flat(source)).toContain(probe);
      expect(flat(html)).toContain(probe);
    }
  });

  it("çerezsiz referans yapıyı ve gerçek yerel depolama envanterini açıklar", async () => {
    const { LOCAL_STORAGE_INVENTORY } = await import("./policy.ts");
    expect(LOCAL_STORAGE_INVENTORY.map((item) => item.key)).toContain("kionel-secure-identity");
    expect(LOCAL_STORAGE_INVENTORY.map((item) => item.key)).toContain("qualification.*");
  });
});
