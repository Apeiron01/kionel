import { describe, expect, it } from "vitest";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import {
  GRACE_DAYS, coversProductLine, entitlement, licenseSeverity, monotonicNow, issueLicense, licenseExpiry, licenseNotice, verifyLicense, type License,
} from "./license.ts";

async function authority(name: string): Promise<PlatformSigningIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    providerId: "test-webcrypto",
    keyId: `test:${name}`,
    algorithm: "ecdsa-p256-sha256",
    publicKey,
    securityLevel: "software-protected",
    persistence: "session",
    attestation: { status: "not-available" },
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as BufferSource));
    },
  };
}

const SCOPE = { sites: 3, devices: 40, productLines: ["lab-bridge", "proof"] };
const NOW = new Date("2026-09-08T12:00:00.000Z");
const UNTIL = new Date("2027-09-08T12:00:00.000Z");

describe("lisans dosyası", () => {
  it("UTC ay sonunu korur, kesirli ve sınırsız süreyi reddeder", () => {
    expect(licenseExpiry(new Date("2028-01-31T12:34:56.000Z"), 1).toISOString()).toBe("2028-02-29T12:34:56.000Z");
    expect(licenseExpiry(new Date("2028-02-29T12:34:56.000Z"), 12).toISOString()).toBe("2029-02-28T12:34:56.000Z");
    for (const months of [0, 0.5, 121, NaN]) expect(() => licenseExpiry(NOW, months)).toThrow();
  });

  it("bitiş anında sona erer; bozuk saat ve imzasız iç alanları reddeder", async () => {
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot", scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });
    expect((await verifyLicense(license, issuer.publicKey, UNTIL)).state).toBe("expired");
    expect((await verifyLicense(license, issuer.publicKey, new Date(NaN))).state).toBe("invalid");
    expect((await verifyLicense({ ...license, scope: { ...license.scope, unlimited: true } }, issuer.publicKey, NOW)).state).toBe("invalid");
    expect((await verifyLicense({ ...license, sig: license.sig + "=" }, issuer.publicKey, NOW)).state).toBe("invalid");
    await expect(issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot", scope: SCOPE, issuedAt: NOW, validUntil: new Date(NaN),
    })).rejects.toThrow(/tarihi/);
  });
  it("imzalanır ve gömülü otorite anahtarıyla çevrimdışı doğrulanır", async () => {
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Analiz Laboratuvarı A.Ş.", tier: "enterprise",
      scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });

    const state = await verifyLicense(license, issuer.publicKey, NOW);
    expect(state.state).toBe("valid");
    if (state.state !== "valid") return;
    expect(state.daysRemaining).toBe(365);
    expect(licenseNotice(state)).toContain("Örnek Analiz Laboratuvarı");
    expect(coversProductLine(state, "lab-bridge")).toBe(true);
    expect(coversProductLine(state, "chain-proof")).toBe(false);
  });

  it("süresi dolmuş lisans GEÇERSİZ değil, SÜRESİ DOLMUŞ sayılır", async () => {
    // Aradaki fark ürünün tamamı: biri "bu belge sahte", diğeri "yenilenmeli".
    // Ek süre içinde çalışır, sonra demo; eski kayıtların etkilenmediği yazılır.
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot", scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });

    const later = new Date("2027-10-08T12:00:00.000Z");
    const state = await verifyLicense(license, issuer.publicKey, later);
    expect(state.state).toBe("expired");
    if (state.state !== "expired") return;
    expect(state.daysExpired).toBe(30);
    expect(entitlement(state)).toBe("demo");
    expect(licenseNotice(state)).toMatch(/personal edition.*stay verifiable/);
  });

  it("yeni aktarım hakkı: geçerli → ek süre → demo; sahte veya eksik lisans demo", async () => {
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot", scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });
    const day = 86_400_000;
    const at = async (ms: number) => entitlement(await verifyLicense(license, issuer.publicKey, new Date(ms)));
    expect(await at(UNTIL.getTime() - 1)).toBe("licensed");
    expect(await at(UNTIL.getTime())).toBe("grace");
    expect(await at(UNTIL.getTime() + (GRACE_DAYS - 1) * day)).toBe("grace");
    expect(await at(UNTIL.getTime() + GRACE_DAYS * day)).toBe("demo");
    expect(entitlement(undefined)).toBe("demo");
    expect(entitlement(await verifyLicense({ ...license, licensee: "Başka" }, issuer.publicKey, NOW))).toBe("demo");
  });

  it("başka bir otoritenin imzaladığı lisansı kabul etmez", async () => {
    const real = await authority("kionel");
    const fake = await authority("sahte");
    const license = await issueLicense(fake, {
      licensee: "Örnek Lab", tier: "enterprise", scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });
    expect(await verifyLicense(license, real.publicKey, NOW))
      .toMatchObject({ state: "invalid", reason: expect.stringContaining("authority") });
  });

  it("tek alan değişse imza düşer", async () => {
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot", scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });

    for (const tampered of [
      { ...license, licensee: "Başka Lab" },
      { ...license, tier: "enterprise" as const },
      { ...license, scope: { ...SCOPE, devices: 4000 } },
      { ...license, validUntil: "2030-01-01T00:00:00.000Z" },
    ]) {
      expect(await verifyLicense(tampered, issuer.publicKey, NOW))
        .toMatchObject({ state: "invalid" });
    }
  });

  it("henüz başlamamış lisans geçerli sayılmaz", async () => {
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "oem", scope: SCOPE,
      issuedAt: new Date("2027-01-01T00:00:00.000Z"), validUntil: new Date("2028-01-01T00:00:00.000Z"),
    });
    expect(await verifyLicense(license, issuer.publicKey, NOW))
      .toMatchObject({ state: "invalid", reason: expect.stringContaining("not started") });
  });

  it("bilinmeyen alan taşıyan dosya reddedilir", async () => {
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot", scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });
    const extended = { ...license, unlockEverything: true } as unknown as License;
    expect(await verifyLicense(extended, issuer.publicKey, NOW)).toMatchObject({ state: "invalid" });
  });

  it("otorite anahtarı verilmezse hiçbir şey doğrulanmaz", async () => {
    // Dosyanın kendi `issuer` alanına güvenmek, kendi imzasını kendi doğrulayan
    // bir belge üretmek olurdu.
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot", scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });
    expect(await verifyLicense(license, new Uint8Array(0), NOW)).toMatchObject({ state: "invalid" });
  });

  it("geçersiz kapsam ve tarih aralığı imzalanmaz", async () => {
    const issuer = await authority("kionel");
    await expect(issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot",
      scope: { sites: 0, devices: 10, productLines: ["proof"] }, issuedAt: NOW, validUntil: UNTIL,
    })).rejects.toThrow(/kapsam/);

    await expect(issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "pilot", scope: SCOPE, issuedAt: UNTIL, validUntil: NOW,
    })).rejects.toThrow(/bitiş tarihi/);
  });
});

describe("saat sayacı", () => {
  it("saat geri alınınca saklanan zamanı kullanır, ileri alınınca yenisini saklar", () => {
    const seen = { seenAt: "2027-01-10T00:00:00.000Z" };
    // Bir saat geri: kabul edilmez, kontrol saklanan zamanla yapılır.
    const back = monotonicNow(seen, new Date("2027-01-09T23:00:00.000Z"));
    expect(back.rolledBack).toBe(true);
    expect(back.now.toISOString()).toBe(seen.seenAt);
    expect(back.next.seenAt).toBe(seen.seenAt);
    // Aylarca geri: süresi dolmuş lisans böyle diriltilemez.
    const year = monotonicNow(seen, new Date("2026-01-09T00:00:00.000Z"));
    expect(year.now.toISOString()).toBe(seen.seenAt);
    // İki dakika geri: NTP düzeltmesi sahtekârlık değil.
    const skew = monotonicNow(seen, new Date("2027-01-09T23:58:00.000Z"));
    expect(skew.rolledBack).toBe(false);
    expect(skew.now.toISOString()).toBe(seen.seenAt);
    // İleri: yeni zaman saklanır ve zaten lisansın aleyhine çalışır.
    const forward = monotonicNow(seen, new Date("2027-02-01T00:00:00.000Z"));
    expect(forward.rolledBack).toBe(false);
    expect(forward.next.seenAt).toBe("2027-02-01T00:00:00.000Z");
    // İlk çalıştırma: saklanan durum yok.
    expect(monotonicNow(undefined, new Date("2027-01-01T00:00:00.000Z")).next.seenAt).toBe("2027-01-01T00:00:00.000Z");
  });

  it("geri alınmış saatle süresi dolmuş lisans demo modunda kalır", () => {
    // Asıl sınanan senaryo: lisans bitti, kullanıcı saati geri aldı.
    const expiredState = { state: "expired", daysExpired: 40 } as const;
    expect(entitlement({ ...expiredState, license: {} as License })).toBe("demo");
  });
});

describe("yenileme uyarısı", () => {
  it("son 30 günde uyarır, ek sürede uyarıda kalır, sonrasında durur", async () => {
    const issuer = await authority("kionel");
    const license = await issueLicense(issuer, {
      licensee: "Örnek Lab", tier: "subscription", scope: SCOPE, issuedAt: NOW, validUntil: UNTIL,
    });
    const day = 86_400_000;
    const at = async (ms: number) => licenseSeverity(await verifyLicense(license, issuer.publicKey, new Date(ms)));
    expect(await at(UNTIL.getTime() - 60 * day)).toBe("ok");
    expect(await at(UNTIL.getTime() - 20 * day)).toBe("warn");
    expect(await at(UNTIL.getTime() + 3 * day)).toBe("warn");
    expect(await at(UNTIL.getTime() + 40 * day)).toBe("stopped");
    expect(licenseSeverity(undefined)).toBe("stopped");
    // Uyarı metni de sayıyı söylemeli; renk tek başına yeterli değildir.
    const state = await verifyLicense(license, issuer.publicKey, new Date(UNTIL.getTime() - 5 * day));
    expect(licenseNotice(state)).toMatch(/5 days left/);
  });
});
