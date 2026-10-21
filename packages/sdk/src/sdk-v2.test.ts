import { describe, expect, it } from "vitest";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import { PERSONAL_KEY_POLICY, ENTERPRISE_KEY_POLICY } from "@kionel/platform-keys";
import { p256KeyReference, verifyReceiptV2 } from "@kionel/crypto";
import {
  answerReceiverOfferV2, createReceiverOfferV2, enterpriseSdkV2Options, finishReceiverOfferV2,
  type PeerTrustResolver,
} from "./v2.ts";

describe("Kionel SDK v2 enterprise flow", () => {
  it("completes a mutually enrolled P-256 transfer with a double-signed receipt", async () => {
    const [senderIdentity, receiverIdentity] = await Promise.all([enterpriseIdentity("sender"), enterpriseIdentity("receiver")]);
    const trusted = new Set([
      (await p256KeyReference(senderIdentity)).kid,
      (await p256KeyReference(receiverIdentity)).kid,
    ]);
    const resolver: PeerTrustResolver = async (peer) => ({
      trusted: trusted.has(peer.kid), reason: trusted.has(peer.kid) ? "enrolled" : "unknown",
    });
    const options = enterpriseSdkV2Options(resolver);
    const offer = await createReceiverOfferV2(receiverIdentity, options);
    const answered = await answerReceiverOfferV2(senderIdentity, offer.message, options);
    const finished = await finishReceiverOfferV2(offer.pending, answered.message);
    answered.sender.confirmSas(finished.verification);
    finished.receiver.confirmSas(answered.verification);

    const original = new TextEncoder().encode("global laboratory result");
    const prepared = await answered.sender.prepareTransfer({
      name: "result.txt",
      data: original,
      context: { profile: "lab", reference: "GLOBAL-LAB-42", classification: "restricted" },
    });
    for (const frame of prepared.systematicFrames()) finished.receiver.ingestFrame(frame);
    const received = await finished.receiver.finalize();

    expect(received.name).toBe("result.txt");
    expect(received.data).toEqual(original);
    expect(received.dispatch.v).toBe(2);
    expect(await verifyReceiptV2(received.receipt, new Uint8Array(original))).toMatchObject({
      ok: true, signers: ["alıcı", "gönderen"],
    });
  });

  it("fails closed for a software identity under enterprise policy", async () => {
    const software = await enterpriseIdentity("software");
    software.securityLevel = "software-protected";
    software.attestation = { status: "not-available" };
    await expect(createReceiverOfferV2(software, {
      localKeyPolicy: ENTERPRISE_KEY_POLICY, requireTrustedPeer: true,
      verifyPeer: async () => ({ trusted: true, reason: "test" }),
    })).rejects.toThrow("donanım destekli");
  });

  it("requires and enforces the peer enrollment resolver", async () => {
    const [sender, receiver] = await Promise.all([enterpriseIdentity("sender"), enterpriseIdentity("receiver")]);
    const offer = await createReceiverOfferV2(receiver, {
      localKeyPolicy: ENTERPRISE_KEY_POLICY, requireTrustedPeer: true,
      verifyPeer: async () => ({ trusted: true, reason: "receiver enrolled" }),
    });
    await expect(answerReceiverOfferV2(sender, offer.message, {
      localKeyPolicy: ENTERPRISE_KEY_POLICY, requireTrustedPeer: true,
    })).rejects.toThrow("peer enrollment doğrulayıcısı");
    await expect(answerReceiverOfferV2(sender, offer.message, {
      localKeyPolicy: ENTERPRISE_KEY_POLICY, requireTrustedPeer: true,
      verifyPeer: async () => ({ trusted: false, reason: "revoked" }),
    })).rejects.toThrow("revoked");
  });

  it("allows an explicit non-enterprise P-256 policy without claiming hardware trust", async () => {
    const identity = await enterpriseIdentity("personal");
    identity.securityLevel = "software-protected";
    identity.attestation = { status: "not-available" };
    await expect(createReceiverOfferV2(identity, { localKeyPolicy: PERSONAL_KEY_POLICY })).resolves.toBeDefined();
  });
});

async function enterpriseIdentity(name: string): Promise<PlatformSigningIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    providerId: "mock-tpm",
    keyId: `mock:${name}`,
    algorithm: "ecdsa-p256-sha256",
    publicKey,
    securityLevel: "tpm",
    persistence: "persistent",
    attestation: { status: "verified", verifiedBy: "mock-enrollment", verifiedAt: "2026-08-03T12:00:00.000Z" },
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign(
        { name: "ECDSA", hash: "SHA-256" }, pair.privateKey, new Uint8Array(data),
      ));
    },
  };
}
