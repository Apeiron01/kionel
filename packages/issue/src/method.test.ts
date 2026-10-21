// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from "vitest";
import {
  b64,
  createIdentity,
  verifyMethodRelease,
  type Identity,
  type MethodPolicy,
  type MethodRelease,
} from "@kionel/crypto";
import { approveMethodRelease, issueMethodRelease } from "./index.ts";

const content = new TextEncoder().encode("method=HPLC-42; temperature=25; flow=1.0");
const now = new Date("2026-09-07T12:00:00.000Z");
let publisher: Identity, reviewer: Identity, approver: Identity;
let release: MethodRelease, policy: MethodPolicy;
beforeAll(async () => {
  [publisher, reviewer, approver] = await Promise.all([createIdentity(), createIdentity(), createIdentity()]);
  let pending = await issueMethodRelease(publisher, content, {
    methodId: "HPLC-42", target: "LAB-01", revision: 3,
    notBefore: "2026-09-01T00:00:00.000Z", expiresAt: "2026-10-01T00:00:00.000Z",
  });
  pending = await approveMethodRelease(reviewer, pending, content);
  release = await approveMethodRelease(approver, pending, content);
  policy = {
    schema: "kionel-method-policy/v1", methodId: "HPLC-42", target: "LAB-01", minimumRevision: 3,
    publishers: [b64(publisher.pub)], reviewers: [b64(reviewer.pub)], approvers: [b64(approver.pub)],
  };
});

describe("metot kabul kontrolü", () => {
  it("dosyayı ve sıralı yetkili onayları doğrular", async () => {
    expect((await verifyMethodRelease(release, content, policy, now)).ok).toBe(true);
  });
  it.each(["target", "revision", "hash", "expiresAt", "releaseId"] as const)("imzalı %s değiştirilirse reddeder", async field => {
    const copy = structuredClone(release);
    if (field === "revision") copy.manifest.revision++;
    else copy.manifest[field] = field === "expiresAt" ? "2027-01-01T00:00:00.000Z" : "B".repeat(43);
    expect((await verifyMethodRelease(copy, content, policy, now)).ok).toBe(false);
  });
  it("değişmiş dosyayı reddeder", async () => {
    expect((await verifyMethodRelease(release, new TextEncoder().encode("wrong"), policy, now)).ok).toBe(false);
  });
  it("başka cihazı ve eski sürümü reddeder", async () => {
    expect((await verifyMethodRelease(release, content, { ...policy, target: "LAB-02" }, now)).ok).toBe(false);
    expect((await verifyMethodRelease(release, content, { ...policy, minimumRevision: 4 }, now)).ok).toBe(false);
  });
  it.each(["2026-08-31T23:59:59Z", "2026-10-01T00:00:00Z"])("geçerlilik aralığı dışında reddeder: %s", async time => {
    expect((await verifyMethodRelease(release, content, policy, new Date(time))).ok).toBe(false);
  });
  it.each(["publishers", "reviewers", "approvers"] as const)("%s için kriptografik geçerlilik yetki sayılmaz", async role => {
    const stranger = await createIdentity();
    expect((await verifyMethodRelease(release, content, { ...policy, [role]: [b64(stranger.pub)] }, now)).ok).toBe(false);
  });
  it("son onayın silinmesini ve tüm onayların silinmesini reddeder", async () => {
    for (const length of [0, 1]) {
      expect((await verifyMethodRelease({ ...release, endorsements: release.endorsements.slice(0, length) }, content, policy, now)).ok).toBe(false);
    }
  });
  it("yayınlayan kendi paketine inceleme onayı veremez", async () => {
    await expect(approveMethodRelease(publisher, { ...release, endorsements: [] }, content)).rejects.toThrow(/farklı/);
    await expect(approveMethodRelease(reviewer, { ...release, endorsements: release.endorsements.slice(0, 1) }, content)).rejects.toThrow(/farklı/);
  });
  it("başka sevk imzasına onay taşınamaz", async () => {
    const other = await issueMethodRelease(publisher, content, release.manifest);
    expect((await verifyMethodRelease({ ...other, endorsements: release.endorsements }, content, policy, now)).ok).toBe(false);
  });
  it("bozuk ve bilinmeyen alanlı paketleri hata fırlatmadan reddeder", async () => {
    for (const value of [null, [], {}, { ...release, manifest: null }, { ...release, extra: true }]) {
      expect((await verifyMethodRelease(value, content, policy, now)).ok).toBe(false);
    }
    expect((await verifyMethodRelease(release, content, {}, now)).ok).toBe(false);
    expect((await verifyMethodRelease(release, content, policy, new Date(NaN))).ok).toBe(false);
  });
});
