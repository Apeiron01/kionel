import { describe, expect, it } from "vitest";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import { p256KeyReference, verifyReceiptV2 } from "@kionel/crypto";
import {
  answerReceiverOfferV2, createReceiverOfferV2, finishReceiverOfferV2,
} from "@kionel/sdk";
import {
  createEnrolledDevice, createEnterprisePeerResolver, enterpriseRuntimeOptions,
  issueEnterpriseTrustBundle, verifyEnterpriseTrustBundle,
  type DeviceRevocation, type EnrolledDevice, type EnterpriseTransferPolicy,
  type EnterpriseTrustBundle, type VerifiedEnterpriseBundle,
} from "./index.ts";

const NOW = new Date("2026-08-04T12:00:00.000Z");
const ISSUED = "2026-08-03T12:00:00.000Z";
const EXPIRES = "2026-09-01T12:00:00.000Z";

describe("Kionel enterprise offline trust bundle", () => {
  it("signs and verifies a tenant-bound canonical enrollment snapshot", async () => {
    const fixture = await createFixture();
    const result = await verifyEnterpriseTrustBundle(fixture.bundle, fixture.anchor, {
      expectedTenantId: "tenant-global-1", minimumSequence: 7, now: NOW,
    });
    expect(result).toMatchObject({ ok: true, verified: { bundle: { sequence: 7 } } });
    if (!result.ok) throw new Error(result.reason);
    expect(result.verified.digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.verified.bundle.devices.map((device) => device.key.kid)).toEqual(
      [...result.verified.bundle.devices.map((device) => device.key.kid)].sort((a, b) => a.localeCompare(b)),
    );
    expect(() => { result.verified.bundle.policy.maxContentBytes = 1 }).toThrow();
  });

  it("rejects tampering, a foreign root, tenant mismatch, rollback and expiry", async () => {
    const fixture = await createFixture();
    const tampered = structuredClone(fixture.bundle);
    tampered.policy.maxContentBytes++;
    await expect(verifyEnterpriseTrustBundle(tampered, fixture.anchor, {
      expectedTenantId: "tenant-global-1", minimumSequence: 7, now: NOW,
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("imzası") });

    const foreignAnchor = await p256KeyReference(await enterpriseIdentity("foreign-root", "tpm"));
    await expect(verifyEnterpriseTrustBundle(fixture.bundle, foreignAnchor, {
      expectedTenantId: "tenant-global-1", minimumSequence: 7, now: NOW,
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("sabitlenmiş") });
    await expect(verifyEnterpriseTrustBundle(fixture.bundle, fixture.anchor, {
      expectedTenantId: "other-tenant", minimumSequence: 7, now: NOW,
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("tenant") });
    await expect(verifyEnterpriseTrustBundle(fixture.bundle, fixture.anchor, {
      expectedTenantId: "tenant-global-1", minimumSequence: 8, now: NOW,
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("rollback") });
    await expect(verifyEnterpriseTrustBundle(fixture.bundle, fixture.anchor, {
      expectedTenantId: "tenant-global-1", minimumSequence: 7, now: new Date(EXPIRES),
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining("süresi") });
  });

  it("enforces site, role, enrollment lifetime and time-effective revocation", async () => {
    const fixture = await createFixture();
    const senderKid = (await p256KeyReference(fixture.sender)).kid;
    const bundle = await issueBundle(fixture.authority, fixture.devices, [{
      kid: senderKid, effectiveAt: "2026-08-05T00:00:00.000Z", reason: "device-lost",
    }]);
    const verified = await checked(bundle, fixture.anchor);
    const senderRef = await p256KeyReference(fixture.sender);

    await expect(createEnterprisePeerResolver(verified, {
      siteId: "site-tr", requiredAnyRole: ["lab-terminal"], now: NOW,
    })(senderRef)).resolves.toMatchObject({ trusted: true });
    await expect(createEnterprisePeerResolver(verified, {
      siteId: "site-us", now: NOW,
    })(senderRef)).resolves.toMatchObject({ trusted: false, reason: expect.stringContaining("site") });
    await expect(createEnterprisePeerResolver(verified, {
      requiredAnyRole: ["auditor"], now: NOW,
    })(senderRef)).resolves.toMatchObject({ trusted: false, reason: expect.stringContaining("role") });
    await expect(createEnterprisePeerResolver(verified, {
      now: new Date("2026-08-05T00:00:00.000Z"),
    })(senderRef)).resolves.toMatchObject({ trusted: false, reason: expect.stringContaining("device-lost") });
  });

  it("derives mutually trusted SDK policy and completes an enterprise transfer", async () => {
    const fixture = await createFixture();
    const verified = await checked(fixture.bundle, fixture.anchor);
    const constraints = { siteId: "site-tr", requiredAnyRole: ["lab-terminal"] as const, now: NOW };
    const [senderOptions, receiverOptions] = await Promise.all([
      enterpriseRuntimeOptions(fixture.sender, verified, constraints),
      enterpriseRuntimeOptions(fixture.receiver, verified, constraints),
    ]);
    expect(senderOptions.maxContentBytes).toBe(8 * 1024 * 1024);
    expect(senderOptions.requireContext).toBe(true);

    const offer = await createReceiverOfferV2(fixture.receiver, receiverOptions);
    const answered = await answerReceiverOfferV2(fixture.sender, offer.message, senderOptions);
    const finished = await finishReceiverOfferV2(offer.pending, answered.message);
    answered.sender.confirmSas(finished.verification);
    finished.receiver.confirmSas(answered.verification);
    await expect(answered.sender.prepareTransfer({ name: "missing.txt", data: new Uint8Array([1]) }))
      .rejects.toThrow("işlem bağlamı");
    await expect(answered.sender.prepareTransfer({
      name: "personal.txt", data: new Uint8Array([1]), context: { profile: "personal" },
    })).rejects.toThrow("engellendi");

    const content = new TextEncoder().encode("validated global laboratory payload");
    const prepared = await answered.sender.prepareTransfer({
      name: "lab.txt", data: content,
      context: { profile: "lab", reference: "LIMS-GLOBAL-42", classification: "restricted" },
    });
    for (const frame of prepared.systematicFrames()) finished.receiver.ingestFrame(frame);
    const received = await finished.receiver.finalize();
    expect(received.data).toEqual(content);
    expect(await verifyReceiptV2(received.receipt, new Uint8Array(content))).toMatchObject({ ok: true });
  });

  it("rejects software keys and unsafe global display identifiers before enrollment", async () => {
    const software = await enterpriseIdentity("software", "tpm");
    software.securityLevel = "software-protected";
    software.attestation = { status: "not-available" };
    await expect(createEnrolledDevice(software, enrollment("software"))).rejects.toThrow("donanım destekli");
    const hardware = await enterpriseIdentity("bidi", "strongbox");
    await expect(createEnrolledDevice(hardware, {
      ...enrollment("bidi"), displayName: "Lab\u202eexe",
    })).rejects.toThrow("alanları geçersiz");
    await expect(createEnrolledDevice(hardware, {
      ...enrollment("stale"), enrolledAt: new Date("2026-08-03T00:00:00.000Z"),
    })).rejects.toThrow("alanları geçersiz");
  });
});

async function createFixture() {
  const [authority, sender, receiver] = await Promise.all([
    enterpriseIdentity("authority", "tpm"),
    enterpriseIdentity("sender", "strongbox"),
    enterpriseIdentity("receiver", "secure-enclave"),
  ]);
  const devices = await Promise.all([
    createEnrolledDevice(sender, enrollment("sender")),
    createEnrolledDevice(receiver, enrollment("receiver")),
  ]);
  const bundle = await issueBundle(authority, devices, []);
  return { authority, sender, receiver, devices, bundle, anchor: await p256KeyReference(authority) };
}

async function issueBundle(
  authority: PlatformSigningIdentity,
  devices: EnrolledDevice[],
  revocations: DeviceRevocation[],
): Promise<EnterpriseTrustBundle> {
  return issueEnterpriseTrustBundle(authority, {
    tenantId: "tenant-global-1",
    sequence: 7,
    issuedAt: ISSUED,
    expiresAt: EXPIRES,
    policy: policy(),
    devices,
    revocations,
  });
}

async function checked(bundle: EnterpriseTrustBundle, anchor: Awaited<ReturnType<typeof p256KeyReference>>): Promise<VerifiedEnterpriseBundle> {
  const result = await verifyEnterpriseTrustBundle(bundle, anchor, {
    expectedTenantId: "tenant-global-1", minimumSequence: 7, now: NOW,
  });
  if (!result.ok) throw new Error(result.reason);
  return result.verified;
}

function enrollment(name: string) {
  return {
    deviceId: `device-${name}`,
    siteId: "site-tr",
    displayName: `Kionel ${name}`,
    roles: ["lab-terminal" as const],
    enrolledAt: new Date("2026-08-01T00:00:00.000Z"),
    expiresAt: new Date("2027-08-01T00:00:00.000Z"),
  };
}

function policy(): EnterpriseTransferPolicy {
  return {
    version: 3,
    allowedProfiles: ["lab", "custody"],
    requireContext: true,
    maxContentBytes: 8 * 1024 * 1024,
    transports: ["qr-v1"],
    maxFrameBytes: 1465,
    maxFps: 30,
    duplex: true,
    arq: true,
    resume: true,
  };
}

async function enterpriseIdentity(
  name: string,
  securityLevel: "tpm" | "strongbox" | "secure-enclave",
): Promise<PlatformSigningIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as CryptoKeyPair;
  return {
    providerId: `mock-${securityLevel}`,
    keyId: `mock:${name}`,
    algorithm: "ecdsa-p256-sha256",
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    securityLevel,
    persistence: "persistent",
    attestation: {
      status: "verified",
      format: securityLevel === "strongbox" ? "android-key-attestation" : securityLevel === "tpm" ? "windows-tpm" : "vendor-managed",
      verifiedBy: "kionel-enrollment-v1",
      verifiedAt: "2026-08-01T00:00:00.000Z",
    },
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new Uint8Array(data),
      ));
    },
  };
}
