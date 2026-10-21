// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createIdentity, type Bytes } from "@kionel/crypto";
import { hasRole, rolePrecedes, verifyEndorsements, type Endorsement } from "@kionel/crypto";
import { endorse } from "./index.ts";

const bytes = (text: string): Bytes => new TextEncoder().encode(text);
const RESULT = bytes("Numune 2026-0042 · 4.21 mg/L");

describe("onay zinciri", () => {
  it("üreten → inceleyen → serbest bırakan sırasını taşır ve doğrular", async () => {
    const analyst = await createIdentity();
    const reviewer = await createIdentity();
    const approver = await createIdentity();

    const chain: Endorsement[] = [];
    chain.push(await endorse(analyst, { content: RESULT, role: "analyst", reference: "CASE-42" }));
    chain.push(await endorse(reviewer, { content: RESULT, role: "reviewer", chain, note: "Spektrum yeniden değerlendirildi" }));
    chain.push(await endorse(approver, { content: RESULT, role: "approver", chain }));

    const verdict = await verifyEndorsements(chain, RESULT);
    expect(verdict.ok).toBe(true);
    expect(verdict.chain).toEqual([
      expect.stringContaining("üreten"),
      expect.stringContaining("inceleyen"),
      expect.stringContaining("serbest bırakan"),
    ]);

    // Kurumun kendi kuralı: serbest bırakma incelemeden sonra olmalı.
    expect(hasRole(chain, "reviewer")).toBe(true);
    expect(rolePrecedes(chain, "reviewer", "approver")).toBe(true);
  });

  it("bir halka çıkarılırsa zincir düşer — tek tek imzalar geçerli olsa bile", async () => {
    const analyst = await createIdentity();
    const reviewer = await createIdentity();
    const approver = await createIdentity();

    const chain: Endorsement[] = [];
    chain.push(await endorse(analyst, { content: RESULT, role: "analyst" }));
    chain.push(await endorse(reviewer, { content: RESULT, role: "reviewer", chain }));
    chain.push(await endorse(approver, { content: RESULT, role: "approver", chain }));

    // İnceleme halkasını sil: kalan iki imza kendi başına hâlâ geçerli, ama
    // sıranın kanıtı gitti. Asıl korumak istediğimiz şey buydu.
    const tampered = [chain[0], chain[2]];
    const verdict = await verifyEndorsements(tampered, RESULT);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/zincire bağlanmıyor/);
  });

  it("sıra değiştirilirse fark edilir", async () => {
    const a = await createIdentity();
    const b = await createIdentity();
    const chain: Endorsement[] = [];
    chain.push(await endorse(a, { content: RESULT, role: "analyst" }));
    chain.push(await endorse(b, { content: RESULT, role: "approver", chain }));
    expect((await verifyEndorsements([chain[1], chain[0]], RESULT)).ok).toBe(false);
  });

  it("başka bir dosyaya ait onay kabul edilmez", async () => {
    const analyst = await createIdentity();
    const link = await endorse(analyst, { content: RESULT, role: "analyst" });
    const verdict = await verifyEndorsements([link], bytes("başka sonuç"));
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/başka bir içeriğe ait/);
  });

  it("imza sonradan bozulursa reddedilir", async () => {
    const analyst = await createIdentity();
    const link = await endorse(analyst, { content: RESULT, role: "analyst", note: "uygundur" });
    const lied = { ...link, note: "uygun değildir" };
    expect((await verifyEndorsements([lied], RESULT)).ok).toBe(false);
  });

  it("farklı içeriğe onay eklemeye çalışmak reddedilir", async () => {
    const analyst = await createIdentity();
    const chain = [await endorse(analyst, { content: RESULT, role: "analyst" })];
    await expect(endorse(analyst, { content: bytes("farklı"), role: "reviewer", chain }))
      .rejects.toThrow(/başka bir içeriğe ait/);
  });

  it("boş zincir geçerli ama boş olduğunu söyler", async () => {
    const verdict = await verifyEndorsements([], RESULT);
    expect(verdict.ok).toBe(true);
    expect(verdict.reason).toMatch(/boş/);
  });
  it("bozuk geçmişin üstüne yeni imza atmaz", async () => {
    const identity = await createIdentity();
    const link = await endorse(identity, { content: RESULT, role: "analyst" });
    await expect(endorse(identity, { content: RESULT, role: "reviewer", chain: [{ ...link, note: "tampered" }] }))
      .rejects.toThrow(/imzası geçersiz/);
  });
});
