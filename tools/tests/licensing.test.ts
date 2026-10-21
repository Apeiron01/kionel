import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/**
 * Doğrulama yolu: kalıcı olarak Apache-2.0. Müşterinin kendi kaydını doğrulama
 * yeteneği bizim var olmaya devam etmemize ve AGPL yükümlülüklerine bağlı olamaz.
 * Bu liste daralırsa o söz sessizce küçülür.
 */
const APACHE_PACKAGES = [
  "packages/platform-keys", "packages/crypto", "packages/attestation-core",
  "packages/timestamp", "apps/verify", "apps/audit",
];

describe("lisans tutarlılığı", () => {
  it("her iki lisans metni de depoda", () => {
    expect(read("LICENSE")).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(read("LICENSE-APACHE")).toContain("Apache License");
    expect(read("LICENSING-MAP.md")).toContain("Apache License 2.0");
  });

  it("doğrulama yolundaki her paket Apache-2.0 ilan eder", () => {
    for (const pkg of APACHE_PACKAGES) {
      const manifest = join(pkg, "package.json");
      expect(existsSync(join(ROOT, manifest)), `${manifest} yok`).toBe(true);
      expect(JSON.parse(read(manifest)).license, `${pkg} lisansı`).toBe("Apache-2.0");
      expect(read("LICENSING-MAP.md"), `${pkg} haritada yok`).toContain(pkg);
    }
  });

  it("Apache paketlerinde tek bir üretim fonksiyonu bile yok", () => {
    // Sınırın kendisi: üretim kodu AGPL'dir, doğrulayıcı Apache. Üretim fonksiyonu
    // Apache pakete sızarsa AGPL yükümlülüğü olmadan dağıtılabilir hâle gelir.
    const production = /^export (?:async )?function (issue|endorse|approve|createOffer|answerOffer|finishOffer)/m;
    for (const pkg of APACHE_PACKAGES) {
      for (const file of readdirSync(join(ROOT, pkg, existsSync(join(ROOT, pkg, "src")) ? "src" : "."))) {
        if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
        const dir = existsSync(join(ROOT, pkg, "src")) ? `${pkg}/src` : pkg;
        expect(read(`${dir}/${file}`), `${dir}/${file}: üretim fonksiyonu Apache pakette`)
          .not.toMatch(production);
      }
    }
  });

  it("üretim çekirdeği AGPL ilan eder ve bağımlılık tek yönlüdür", () => {
    // Üretim doğrulamayı çağırabilir, doğrulama üretimi ÇAĞIRAMAZ. Ters yön,
    // Apache paketini AGPL koda bağımlı kılar.
    const issue = JSON.parse(read("packages/issue/package.json"));
    expect(issue.license).toBe("AGPL-3.0-only");
    expect(issue.dependencies["@kionel/crypto"]).toBe("workspace:*");
    expect(JSON.parse(read("packages/crypto/package.json")).dependencies ?? {})
      .not.toHaveProperty("@kionel/issue");
  });

  it("kök paket AGPL ilan eder", () => {
    expect(JSON.parse(read("package.json")).license).toBe("AGPL-3.0-only");
  });

  it("hiçbir belge hâlâ satış veya ödeme vaat etmez", () => {
    // Satış 21 Ekim 2026'da kapandı. Eski fiyat ve ödeme dili geri sızarsa
    // kullanıcı olmayan bir ürünü satın almaya çalışır.
    const sales = [/Polar/, /Lab Pilot/, /requires a paid licence/i, /İşletme kullanımı ticari lisans gerektirir/, /\/api\/checkout/];
    for (const doc of ["README.md", "legal/TERMS-EN.md", "legal/KULLANIM-SARTLARI.md", "legal/PRIVACY-EN.md", "apps/web/src/funnel.ts"]) {
      const text = read(doc);
      for (const claim of sales) expect(text, `${doc}: ${claim}`).not.toMatch(claim);
    }
  });

  it("kullanım şartları açık kaynak lisansını ve ticari lisansı iki dilde yazar", () => {
    const tr = read("legal/KULLANIM-SARTLARI.md");
    expect(tr).toMatch(/AGPL-3\.0/);
    expect(tr).toMatch(/ticari\s+lisans/i);
    const en = read("legal/TERMS-EN.md");
    expect(en).toMatch(/AGPL-3\.0/);
    expect(en).toMatch(/commercial licence/i);
    // AGPL'nin verdiği hakları geri alan eski kısıtlamalar kalmamalı.
    expect(en).not.toMatch(/reverse engineer, decompile/i);
  });

  it("açık sürüm uygulamada hiçbir özelliği lisansa bağlamaz", () => {
    expect(read("apps/web/src/app.ts")).toMatch(/const OPEN_EDITION = true;/);
  });

  it("lisans veren ve iletişim adresi yazılı; tedarikçi riski gizlenmiyor", () => {
    const map = read("LICENSING-MAP.md");
    expect(map).toMatch(/şahıs işletmesi/i);
    expect(map).toMatch(/\S+@\S+\.\S+/);
    expect(map).toMatch(/verification path is permanently Apache-2\.0/);
  });
});
