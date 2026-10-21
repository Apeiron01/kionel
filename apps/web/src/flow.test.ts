import { expect, test } from "vitest";
import { pack, packSecureEnvelope, unpack, unpackSecureEnvelope } from "@kionel/core";
import { createIdentity, verifyReceipt, type Bytes, type Dispatch } from "@kionel/crypto";
import { answerOffer, createOffer, finishOffer, issueDispatch, issueReceipt } from "@kionel/issue";

const owned = (bytes: Uint8Array): Bytes => new Uint8Array(bytes);

test("web akışı el sıkışmadan çift imzalı makbuza uçtan uca çalışır", async () => {
  const receiverIdentity = await createIdentity();
  const senderIdentity = await createIdentity();
  const { offer, pending } = await createOffer(receiverIdentity);
  const answered = await answerOffer(senderIdentity, offer);
  const receiverSession = await finishOffer(pending, answered.reply);

  expect(receiverSession.sas).toBe(answered.session.sas);
  expect(receiverSession.sasMarks).toEqual(answered.session.sasMarks);

  const content = owned(new TextEncoder().encode("Kionel gizli içerik"));
  const dispatch = await issueDispatch(senderIdentity, {
    session: answered.session.sessionId,
    content,
  });
  const sealed = await answered.session.seal(owned(pack({ name: "kanıt.txt", data: content })));
  const wire = packSecureEnvelope({ metadata: JSON.stringify(dispatch), sealed });

  const outer = unpackSecureEnvelope(wire)!;
  const received = unpack(await receiverSession.open(owned(outer.sealed)))!;
  const receipt = await issueReceipt(receiverIdentity, {
    session: receiverSession.sessionId,
    content: owned(received.data),
    sender: receiverSession.peer,
    dispatch: JSON.parse(outer.metadata) as Dispatch,
  });

  expect(received.name).toBe("kanıt.txt");
  expect(received.intact).toBe(true);
  expect(await verifyReceipt(receipt, owned(received.data))).toMatchObject({
    ok: true,
    signers: ["alıcı", "gönderen"],
  });
});
