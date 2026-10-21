import { describe, expect, it } from "vitest";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import { issueLicense } from "./license.ts";
import { countersignEvidence, countersignNotice, verifyCountersignature } from "./countersign.ts";

async function authority(name: string): Promise<PlatformSigningIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as CryptoKeyPair;
  return {
    providerId: "test", keyId: `test:${name}`, algorithm: "ecdsa-p256-sha256",
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    securityLevel: "software-protected", persistence: "session", attestation: { status: "not-available" },
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as BufferSource));
    },
  };
}

const SCOPE = { sites: 1, devices: 10, productLines: ["lab-bridge"] };
const NOW = new Date("2026-09-09T12:00:00.000Z");
const UNTIL = new Date("2027-09-09T12:00:00.000Z");
const REPORT = { schema: "kionel-qualification/v1", trials: 1000, success: 0.994, devicePair: "A↔B" };

const licenseFor = async (issuer: PlatformSigningIdentity, validUntil = UNTIL) =>
  issueLicense(issuer, { licensee: "Örnek Lab", tier: "enterprise", scope: SCOPE, issuedAt: NOW, validUntil });

describe("Kionel karşı imzası", () => {
  it("lisanslı müşteri için atılır ve çevrimdışı doğrulanır", async () => {
    const kionel = await authority("kionel");
    const mark = await countersignEvidence(kionel, {
      kind: "qualification", document: REPORT, license: await licenseFor(kionel), at: NOW,
    });

    const state = await verifyCountersignature(mark, REPORT, kionel.publicKey);
    expect(state.state).toBe("verified");
    expect(countersignNotice(state)).toContain("Örnek Lab");
  });

  it("YAMALANARAK elde edilemez: başka anahtarın imzası kabul edilmez", async () => {
    // Ürünün tek gerçek zorlama noktası bu. Özel anahtar istemciye hiç gitmediği
    // için kaynağı değiştirmek bu imzayı üretmeye yetmez.
    const kionel = await authority("kionel");
    const saldirgan = await authority("saldirgan");
    const sahte = await countersignEvidence(saldirgan, {
      kind: "qualification", document: REPORT, license: await licenseFor(saldirgan), at: NOW,
    });
    expect(await verifyCountersignature(sahte, REPORT, kionel.publicKey))
      .toMatchObject({ state: "rejected", reason: expect.stringContaining("otorite") });
  });

  it("başka bir belgeye taşınamaz", async () => {
    const kionel = await authority("kionel");
    const mark = await countersignEvidence(kionel, {
      kind: "qualification", document: REPORT, license: await licenseFor(kionel), at: NOW,
    });
    expect(await verifyCountersignature(mark, { ...REPORT, success: 0.999 }, kionel.publicKey))
      .toMatchObject({ state: "rejected", reason: expect.stringContaining("başka bir belgeye") });
  });

  it("süresi dolmuş lisansla YENİ karşı imza atılmaz", async () => {
    const kionel = await authority("kionel");
    const expired = await licenseFor(kionel, new Date("2026-09-10T00:00:00.000Z"));
    await expect(countersignEvidence(kionel, {
      kind: "qualification", document: REPORT, license: expired, at: new Date("2027-01-01T00:00:00.000Z"),
    })).rejects.toThrow(/süresi dolmuş/);
  });

  it("daha önce atılmış karşı imza, lisans bittikten sonra da geçerli kalır", async () => {
    // Zorlama yeni imzadadır, geçmişte değil. Müşterinin elindeki belgeyi
    // sonradan geçersiz kılmak, ürünün tüm sözünü bozardı.
    const kionel = await authority("kionel");
    const mark = await countersignEvidence(kionel, {
      kind: "qualification", document: REPORT, license: await licenseFor(kionel), at: NOW,
    });
    expect((await verifyCountersignature(mark, REPORT, kionel.publicKey)).state).toBe("verified");
  });

  it("karşı imzasız belge REDDEDİLMEZ, 'yok' sayılır", async () => {
    const kionel = await authority("kionel");
    const state = await verifyCountersignature(undefined, REPORT, kionel.publicKey);
    expect(state.state).toBe("absent");
    expect(countersignNotice(state)).toMatch(/kendi imzasıyla geçerlidir/);
  });

  it("tek alanı değişen karşı imza düşer", async () => {
    const kionel = await authority("kionel");
    const mark = await countersignEvidence(kionel, {
      kind: "qualification", document: REPORT, license: await licenseFor(kionel), at: NOW,
    });
    for (const tampered of [
      { ...mark, licensee: "Bedava Lab" },
      { ...mark, tier: "pilot" as const },
      { ...mark, kind: "receipt" as const },
    ]) {
      expect(await verifyCountersignature(tampered, REPORT, kionel.publicKey))
        .toMatchObject({ state: "rejected" });
    }
  });
});
