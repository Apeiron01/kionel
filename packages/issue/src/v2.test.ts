// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import {
  auditV2BodyBytes,
  b64,
  dispatchV2Bytes,
  isCanonicalP256Signature,
  normalizeP256Signature,
  p256KeyReference,
  sha256,
  verifyAuditLedgerV2,
  verifyDispatchV2,
  verifyEs256,
  verifyQualificationEvidenceV2,
  verifyReceipt,
  verifyReceiptV2,
  type DispatchV2,
  type Receipt,
} from "@kionel/crypto";
import {
  V2_HANDSHAKE_RECORD_BYTES,
  answerOfferV2,
  createOfferV2,
  finishOfferV2,
  issueAuditEntryV2,
  issueDispatchV2,
  issueQualificationEvidenceV2,
  issueReceiptV2,
} from "./index.ts";

const text = (value: string) => new TextEncoder().encode(value);

describe("Kionel v2 P-256 wire", () => {
  it("establishes the same transcript-bound session and encrypted channel", async () => {
    const [receiverIdentity, senderIdentity] = await Promise.all([identity("receiver"), identity("sender")]);
    const { offer, pending } = await createOfferV2(receiverIdentity);
    const answered = await answerOfferV2(senderIdentity, offer);
    const receiver = await finishOfferV2(pending, answered.reply);

    expect(offer).toHaveLength(V2_HANDSHAKE_RECORD_BYTES);
    expect(answered.reply).toHaveLength(V2_HANDSHAKE_RECORD_BYTES);
    expect(receiver.wireVersion).toBe(2);
    expect(receiver.sas).toBe(answered.session.sas);
    expect(receiver.sasMarks).toEqual(answered.session.sasMarks);
    expect(receiver.sessionId).toBe(answered.session.sessionId);
    expect([...receiver.peer]).toEqual([...senderIdentity.publicKey]);
    const sealed = await answered.session.seal(bytes(text("global enterprise payload")));
    await expect(receiver.open(sealed)).resolves.toEqual(text("global enterprise payload"));
  });

  it("rejects version, algorithm, role and replay downgrade paths", async () => {
    const receiver = await identity("receiver");
    const sender = await identity("sender");
    const { offer, pending } = await createOfferV2(receiver);

    const versionDowngrade = bytes(offer);
    versionDowngrade[0] = 1;
    await expect(answerOfferV2(sender, versionDowngrade)).rejects.toThrow("v2");

    const algorithmDowngrade = bytes(offer);
    algorithmDowngrade[2] = 1;
    await expect(answerOfferV2(sender, algorithmDowngrade)).rejects.toThrow("algoritma");

    const roleReflection = bytes(offer);
    roleReflection[1] = 2;
    await expect(answerOfferV2(sender, roleReflection)).rejects.toThrow("rol");

    const answered = await answerOfferV2(sender, offer);
    await finishOfferV2(pending, answered.reply);
    await expect(finishOfferV2(pending, answered.reply)).rejects.toThrow("zaten kullanıldı");
  });

  it("uses canonical low-S IEEE P1363 signatures and rejects high-S twins", async () => {
    const signer = await identity("canonical");
    const message = text("Kionel v2 canonical signature");
    const signature = normalizeP256Signature(await signer.sign(message));
    expect(signature).toHaveLength(64);
    expect(isCanonicalP256Signature(signature)).toBe(true);
    expect(await verifyEs256(signer.publicKey, signature, message)).toBe(true);

    const high = highSTwin(signature);
    expect(isCanonicalP256Signature(high)).toBe(false);
    expect(await verifyEs256(signer.publicKey, high, message)).toBe(false);
  });

  it("issues globally stable key references and double-signed v2 receipts", async () => {
    const [sender, receiver] = await Promise.all([identity("sender"), identity("receiver")]);
    const content = bytes(text("ISO 17025 ölçüm sonucu"));
    const senderReference = await p256KeyReference(sender);
    const dispatch = await issueDispatchV2(sender, {
      session: 42,
      content,
      at: new Date("2026-08-03T10:00:00.000Z"),
      context: { profile: "lab", reference: "İSTANBUL-LAB-42", classification: "restricted" },
    });
    const receipt = await issueReceiptV2(receiver, {
      session: 42, content, sender: senderReference, dispatch, at: new Date("2026-08-03T10:01:00.000Z"),
    });

    expect(senderReference.kid).toMatch(/^urn:kionel:key:sha256:/);
    expect(await verifyDispatchV2(dispatch, content)).toMatchObject({ ok: true, signers: ["gönderen"] });
    expect(await verifyReceiptV2(receipt, content)).toMatchObject({ ok: true, signers: ["alıcı", "gönderen"] });

    const changedKid = structuredClone(receipt);
    changedKid.sender.kid = changedKid.receiver.kid;
    expect((await verifyReceiptV2(changedKid)).ok).toBe(false);
    expect((await verifyReceiptV2({ ...receipt, unexpected: true })).ok).toBe(false);
    expect((await verifyReceiptV2({ ...receipt, protocol: "kionel-v1" })).ok).toBe(false);
    expect((await verifyReceipt(receipt as unknown as Receipt)).ok).toBe(false);
  });

  it("refuses to countersign an invalid or foreign dispatch", async () => {
    const [sender, receiver, foreign] = await Promise.all([identity("sender"), identity("receiver"), identity("foreign")]);
    const content = bytes(text("chain of custody"));
    const dispatch = await issueDispatchV2(sender, { session: 7, content });
    await expect(issueReceiptV2(receiver, {
      session: 7, content, sender: await p256KeyReference(foreign), dispatch,
    })).rejects.toThrow("geçersiz sevk");
    await expect(issueReceiptV2(receiver, {
      session: 7, content: bytes(text("changed")), sender: await p256KeyReference(sender), dispatch,
    })).rejects.toThrow("geçersiz sevk");
  });

  it("chains v2 receipts in a tamper-evident audit ledger", async () => {
    const [sender, receiver] = await Promise.all([identity("sender"), identity("receiver")]);
    const content = bytes(text("laboratory evidence"));
    const dispatch = await issueDispatchV2(sender, { session: 9, content });
    const receipt = await issueReceiptV2(receiver, {
      session: 9, content, sender: await p256KeyReference(sender), dispatch,
    });
    const first = await issueAuditEntryV2(receiver, null, receipt, "receipt-verified", new Date("2026-08-03T11:00:00.000Z"));
    const second = await issueAuditEntryV2(receiver, first, receipt, "receipt-exported", new Date("2026-08-03T11:01:00.000Z"));
    expect(await verifyAuditLedgerV2([first, second], [receipt])).toMatchObject({ ok: true, entries: 2 });
    expect((await verifyAuditLedgerV2([first, { ...second, receipt: "A".repeat(43) }])).ok).toBe(false);
    expect((await verifyAuditLedgerV2([second])).ok).toBe(false);
    await expect(verifyAuditLedgerV2([first], [{ ...receipt, sig: "x" } as typeof receipt]))
      .resolves.toMatchObject({ ok: false });
  });

  it("signs v2 physical qualification evidence and rejects metric changes", async () => {
    const signer = await identity("qualification");
    const evidence = await issueQualificationEvidenceV2(signer, {
      sender: "pixel-10", receiver: "lab-terminal-4", browser: "native-android", transport: "qr-v1",
      attempts: 1000, successes: 999, silentCorruptions: 0, meanGoodputKBs: 25.4,
      startedAt: "2026-08-03T10:00:00.000Z", endedAt: "2026-08-03T12:00:00.000Z",
    });
    expect((await verifyQualificationEvidenceV2(evidence)).ok).toBe(true);
    expect((await verifyQualificationEvidenceV2({ ...evidence, successes: 1000 })).ok).toBe(false);
  });

  it("keeps canonical evidence bytes stable as a golden vector", async () => {
    const rawKey = new Uint8Array(65);
    rawKey[0] = 4;
    for (let index = 1; index < rawKey.length; index++) rawKey[index] = index;
    const key = {
      alg: "ES256" as const,
      kid: `urn:kionel:key:sha256:${"C".repeat(43)}`,
      key: b64(bytes(rawKey)),
    };
    const body: Omit<DispatchV2, "sig"> = {
      v: 2,
      protocol: "kionel-v2",
      session: 0x01020304,
      hash: "A".repeat(43),
      bytes: 1234,
      at: "2026-08-03T12:34:56.789Z",
      sender: key,
      context: { profile: "custody", reference: "CASE-42", classification: "confidential", note: "Tokyo 東京" },
    };
    const digest = b64(await sha256(dispatchV2Bytes(body)));
    const auditDigest = b64(await sha256(auditV2BodyBytes({
      v: 2, protocol: "kionel-v2", seq: 0, previous: null, receipt: "B".repeat(43),
      event: "receipt-verified", at: "2026-08-03T12:34:56.789Z", actor: key,
    })));
    expect(digest).toBe("ufFJG8ShdUzSWEN_PboTwaBVi3YOQlxXk-SX7LAhU5s");
    expect(auditDigest).toBe("7COTjrz_WkGfZR4Y-pVHnO6_TcvkGAd9v0eMDTDrzjg");
  });
});

async function identity(keyId: string): Promise<PlatformSigningIdentity> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as CryptoKeyPair;
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    providerId: "test-webcrypto",
    keyId: `test:${keyId}`,
    algorithm: "ecdsa-p256-sha256",
    publicKey,
    securityLevel: "software-protected",
    persistence: "session",
    attestation: { status: "not-available" },
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, bytes(data)));
    },
  };
}

const P256_ORDER = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
function highSTwin(signature: Uint8Array): Uint8Array {
  const output = bytes(signature);
  let low = 0n;
  for (const byte of signature.subarray(32)) low = (low << 8n) | BigInt(byte);
  let high = P256_ORDER - low;
  for (let index = 63; index >= 32; index--) { output[index] = Number(high & 0xffn); high >>= 8n }
  return output;
}
function bytes(value: Uint8Array): Uint8Array<ArrayBuffer> { return new Uint8Array(value) }
