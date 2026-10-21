// SPDX-License-Identifier: AGPL-3.0-only
import { expect, test } from "vitest";
import {
  createIdentity,
  createProtectedIdentity,
  dispatchBytes,
  exportIdentity,
  importIdentity,
  importProtectedIdentity,
  verifyDispatch,
  verifyQualificationEvidence,
  verifyReceipt,
  type Receipt,
} from "@kionel/crypto";
import {
  answerOffer,
  createOffer,
  finishOffer,
  issueDispatch,
  issueQualificationEvidence,
  issueReceipt,
} from "./index.ts";

const bytes = (s: string) => new TextEncoder().encode(s);

async function pair() {
  const [alice, bob] = await Promise.all([createIdentity(), createIdentity()]); // alice=alıcı, bob=gönderen
  const { offer, pending } = await createOffer(alice);
  const { reply, session: sender } = await answerOffer(bob, offer);
  const receiver = await finishOffer(pending, reply);
  return { alice, bob, offer, reply, pending, sender, receiver };
}

// ---- el sıkışma ------------------------------------------------------------

test("iki taraf aynı SAS rakamlarını, işaretlerini ve oturum kimliğini üretir", async () => {
  const { sender, receiver, alice, bob } = await pair();
  expect(sender.sas).toBe(receiver.sas);
  expect(sender.sasMarks).toEqual(receiver.sasMarks);
  expect(sender.sas).toMatch(/^\d{6}$/);
  expect(sender.sasMarks).toHaveLength(5);
  // Glif değil indeks: hangi cihazda çizildiğinden bağımsız olmalı.
  expect(sender.sasMarks.every((mark) => Number.isInteger(mark) && mark >= 0 && mark < 32)).toBe(true);
  expect(sender.sessionId).toBe(receiver.sessionId);
  expect([...sender.peer]).toEqual([...alice.pub]);
  expect([...receiver.peer]).toEqual([...bob.pub]);
});

test("iki SAS faktörü bağımsız: aynı değerin iki gösterimi değil", async () => {
  const a = await pair();
  const b = await pair();
  expect(a.sender.sas).not.toBe(b.sender.sas);
  expect(a.sender.sasMarks).not.toEqual(b.sender.sasMarks);
});

test("her oturum yeni geçici anahtar kullanır (ileri gizlilik)", async () => {
  const alice = await createIdentity();
  const o1 = await createOffer(alice);
  const o2 = await createOffer(alice);
  const x1 = o1.offer.subarray(34, 66);
  const x2 = o2.offer.subarray(34, 66);
  expect([...x1]).not.toEqual([...x2]);
});

test("içerik gidiş-dönüş şifreleniyor", async () => {
  const { sender, receiver } = await pair();
  const plain = crypto.getRandomValues(new Uint8Array(5000));
  const sealed = await sender.seal(plain);
  expect([...sealed.subarray(12, 100)]).not.toEqual([...plain.subarray(0, 88)]);
  expect([...(await receiver.open(sealed))]).toEqual([...plain]);
});

test("ortadaki adam: araya giren anahtar İKİ faktörü birden değiştirir", async () => {
  const [alice, mallory, bob] = await Promise.all([createIdentity(), createIdentity(), createIdentity()]);
  const { pending } = await createOffer(alice);
  const { offer: fake } = await createOffer(mallory);
  const { session: tricked } = await answerOffer(bob, fake);
  const { reply } = await answerOffer(bob, pending.offer);
  const real = await finishOffer(pending, reply);
  expect(tricked.sas).not.toBe(real.sas);
  expect(tricked.sasMarks).not.toEqual(real.sasMarks);
});

test("kurcalanmış kayıt reddedilir", async () => {
  const { pending } = await createOffer(await createIdentity());
  const bob = await createIdentity();
  const tampered = pending.offer.slice();
  tampered[40] ^= 0x01; // geçici anahtarın bir biti
  await expect(answerOffer(bob, tampered)).rejects.toThrow(/imza/);
});

test("teklif cevap diye yansıtılamaz (rol alanı)", async () => {
  const { pending } = await createOffer(await createIdentity());
  await expect(finishOffer(pending, pending.offer)).rejects.toThrow(/rol/);
});

test("süresi dolmuş kayıt reddedilir", async () => {
  const alice = await createIdentity();
  const bob = await createIdentity();
  const { offer } = await createOffer(alice);
  // 10 dakika öncesine ait bir kare (fotoğraflanıp sonra oynatılmış)
  new DataView(offer.buffer).setBigUint64(82, BigInt(Date.now() - 600_000));
  await expect(answerOffer(bob, offer)).rejects.toThrow(/süresi dolmuş|imza/);
});

test("teklif tek kullanımlıktır", async () => {
  const { pending, reply } = await pair();
  await expect(finishOffer(pending, reply)).rejects.toThrow(/zaten kullanıldı/);
});

test("başka oturumun cevabı anahtar teyidinde yakalanır", async () => {
  const alice = await createIdentity();
  const bob = await createIdentity();
  const { pending } = await createOffer(alice);
  // Saldırgan aynı nonce'u taşıyan ama farklı anahtarlı bir cevap uydurur.
  const { reply: other } = await answerOffer(bob, (await createOffer(alice)).offer);
  other.set(pending.offer.subarray(66, 82), 66);
  await expect(finishOffer(pending, other)).rejects.toThrow(/imza|teyid/);
});

test("kalıcı kimlik dışa/içe aktarılabiliyor", async () => {
  const id = await createIdentity();
  const again = await importIdentity(await exportIdentity(id));
  expect([...again.pub]).toEqual([...id.pub]);
});

test("korumalı kimliğin özel anahtarı dışa aktarılamaz ama imzalayabilir", async () => {
  const protectedId = await createProtectedIdentity();
  expect(protectedId.priv.extractable).toBe(false);
  await expect(crypto.subtle.exportKey("jwk", protectedId.priv)).rejects.toThrow();
  const { offer } = await createOffer(protectedId);
  expect(offer.length).toBe(170);
});

test("eski JWK kimliği anahtar değiştirmeden korumalı depoya geçirilebilir", async () => {
  const old = await createIdentity();
  const migrated = await importProtectedIdentity(await exportIdentity(old));
  expect([...migrated.pub]).toEqual([...old.pub]);
  expect(migrated.priv.extractable).toBe(false);
});

// ---- makbuz ----------------------------------------------------------------

test("çift imzalı makbuz üçüncü tarafça doğrulanabiliyor", async () => {
  const { receiver, alice, bob } = await pair();
  const content = bytes("teslim edilen içerik");
  const dispatch = await issueDispatch(bob, { session: receiver.sessionId, content });
  const r = await issueReceipt(alice, { session: receiver.sessionId, content, sender: bob.pub, dispatch });

  const v = await verifyReceipt(r, content);
  expect(v.ok).toBe(true);
  expect(v.signers).toEqual(["alıcı", "gönderen"]);

  // yalnızca JSON'dan, hiçbir sunucuya sormadan
  const wire: Receipt = JSON.parse(JSON.stringify(r));
  expect((await verifyReceipt(wire)).signers).toEqual(["alıcı", "gönderen"]);
});

test("sevk kaydı sökülüp başka makbuza takılamaz", async () => {
  const a = await pair();
  const b = await pair();
  const content = bytes("sözleşme");
  const foreign = await issueDispatch(b.bob, { session: b.receiver.sessionId, content });
  const r = await issueReceipt(a.alice, {
    session: a.receiver.sessionId, content, sender: a.bob.pub, dispatch: foreign,
  });
  expect((await verifyReceipt(r)).reason).toMatch(/tutarsız|geçersiz/);
});

test("makbuzda tek alan değişirse doğrulama düşer", async () => {
  const { receiver, alice, bob } = await pair();
  const content = bytes("sözleşme v1");
  const dispatch = await issueDispatch(bob, { session: receiver.sessionId, content });
  const r = await issueReceipt(alice, { session: receiver.sessionId, content, sender: bob.pub, dispatch });

  expect((await verifyReceipt({ ...r, bytes: r.bytes + 1 })).ok).toBe(false);
  expect((await verifyReceipt({ ...r, at: new Date(0).toISOString() })).ok).toBe(false);
  expect((await verifyReceipt({ ...r, dispatch: undefined })).ok).toBe(false); // imza sevke bağlı
  expect((await verifyReceipt(r, bytes("sözleşme v2"))).reason).toMatch(/hash|boyut/);
});

test("ürün bağlamı sevk imzasına bağlıdır", async () => {
  const { receiver, bob } = await pair();
  const content = bytes("numune sonucu");
  const dispatch = await issueDispatch(bob, {
    session: receiver.sessionId,
    content,
    context: { profile: "custody", reference: "SAMPLE-42", classification: "restricted" },
  });
  expect((await verifyDispatch(dispatch, content)).ok).toBe(true);
  expect((await verifyDispatch({
    ...dispatch,
    context: { ...dispatch.context!, reference: "SAMPLE-43" },
  }, content)).ok).toBe(false);
});

test("fiziksel cihaz ölçümü imzalanır ve değişiklik reddedilir", async () => {
  const identity = await createIdentity();
  const evidence = await issueQualificationEvidence(identity, {
    sender: "phone-a", receiver: "lab-b", browser: "Chromium 140", transport: "qr-v1",
    attempts: 1000, successes: 997, silentCorruptions: 0, meanGoodputKBs: 24.5,
    startedAt: "2026-08-03T10:00:00.000Z", endedAt: "2026-08-03T12:00:00.000Z",
  });
  expect((await verifyQualificationEvidence(evidence)).ok).toBe(true);
  expect((await verifyQualificationEvidence({ ...evidence, successes: 1000 })).ok).toBe(false);
});

test("tek imzalı makbuz da geçerli, ama öyle raporlanır", async () => {
  const { receiver, alice, bob } = await pair();
  const content = bytes("tek taraflı");
  const v = await verifyReceipt(
    await issueReceipt(alice, { session: receiver.sessionId, content, sender: bob.pub }),
    content,
  );
  expect(v.ok).toBe(true);
  expect(v.signers).toEqual(["alıcı"]);
});

test("aşırı büyük veya biçimsiz makbuz alanları imza kontrolünden önce reddedilir", async () => {
  const malformed = {
    v: 1, session: 1, hash: "x".repeat(10_000_000), bytes: 0xffffffff,
    at: "sonsuz", sender: "x", receiver: "x", sig: "x",
  } as unknown as Receipt;
  expect(await verifyReceipt(malformed)).toMatchObject({ ok: false, reason: expect.stringMatching(/biçimi|sınır/) });
});

test("beyan edilen operatör imzalanır; değiştirilir ya da silinirse doğrulama düşer", async () => {
  const sender = await createIdentity();
  const content = bytes("A-1,0.8\n");
  const dispatch = await issueDispatch(sender, { session: 5, content, context: { profile: "lab", reference: "WO-1", operator: "T. Bayar" } });
  expect((await verifyDispatch(dispatch, content)).ok).toBe(true);
  expect((await verifyDispatch({ ...dispatch, context: { ...dispatch.context!, operator: "Someone else" } }, content)).ok).toBe(false);
  const { operator: _, ...stripped } = dispatch.context!;
  expect((await verifyDispatch({ ...dispatch, context: stripped }, content)).ok).toBe(false);
});

test("operatörsüz bağlamın imzalanan baytları eski biçimle aynı", async () => {
  const body = { v: 1 as const, session: 5, hash: "h", bytes: 1, at: "2026-09-25T00:00:00.000Z", sender: "s", context: { profile: "lab" as const, reference: "WO-1" } };
  expect(new TextDecoder().decode(dispatchBytes(body))).toBe(JSON.stringify(["dispatch", 1, 5, "h", 1, body.at, "s", ["lab", "WO-1", null, null]]));
});

test("boş, çok uzun ya da metin olmayan operatör reddedilir", async () => {
  const sender = await createIdentity();
  for (const operator of ["", "   ", "x".repeat(81), 42 as unknown as string]) {
    await expect(issueDispatch(sender, { session: 1, content: bytes("x"), context: { profile: "lab", operator } })).rejects.toThrow(/bağlamı geçersiz/);
  }
});
