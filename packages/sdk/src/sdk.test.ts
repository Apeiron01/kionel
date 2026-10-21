import { expect, test } from "vitest";
import { createIdentity, verifyReceipt } from "@kionel/crypto";
import { answerReceiverOffer, createReceiverOffer, finishReceiverOffer } from "./index.ts";

const bytes = (value: string) => new TextEncoder().encode(value);

test("SDK güvenli aktarımı çift imzalı makbuzla tamamlar", async () => {
  const receiverId = await createIdentity();
  const senderId = await createIdentity();
  const offer = await createReceiverOffer(receiverId);
  const answered = await answerReceiverOffer(senderId, offer.message);
  const finished = await finishReceiverOffer(offer.pending, answered.message);
  answered.sender.confirmSas(finished.verification);
  finished.receiver.confirmSas(answered.verification);
  const original = bytes("Kionel SDK laboratuvar örneği");
  const prepared = await answered.sender.prepareTransfer({
    name: "sonuc.txt", data: original, blockSize: 64,
    context: { profile: "lab", reference: "LIMS-42", classification: "restricted" },
  });
  for (const frame of prepared.systematicFrames()) finished.receiver.ingestFrame(frame);
  const received = await finished.receiver.finalize();
  expect(received.name).toBe("sonuc.txt");
  expect(received.data).toEqual(original);
  expect(received.dispatch.context).toMatchObject({ profile: "lab", reference: "LIMS-42" });
  expect(await verifyReceipt(received.receipt, original)).toMatchObject({ ok: true, signers: ["alıcı", "gönderen"] });
});

test("SAS onayı olmadan gönderim ve alım başlamaz", async () => {
  const offer = await createReceiverOffer(await createIdentity());
  const answered = await answerReceiverOffer(await createIdentity(), offer.message);
  const finished = await finishReceiverOffer(offer.pending, answered.message);
  await expect(answered.sender.prepareTransfer({ name: "x", data: bytes("x") })).rejects.toThrow("SAS");
  expect(() => finished.receiver.ingestFrame(new Uint8Array())).toThrow("SAS");
  expect(() => answered.sender.confirmSas({ digits: "000000", marks: [0, 0, 0, 0, 0] })).toThrow("SAS");
});

test("ürün içerik sınırı SDK girişinde uygulanır", async () => {
  const offer = await createReceiverOffer(await createIdentity(), { maxContentBytes: 4 });
  const answered = await answerReceiverOffer(await createIdentity(), offer.message, { maxContentBytes: 4 });
  const finished = await finishReceiverOffer(offer.pending, answered.message);
  answered.sender.confirmSas(finished.verification);
  await expect(answered.sender.prepareTransfer({ name: "x", data: bytes("12345") })).rejects.toThrow("ürün sınırını");
});
