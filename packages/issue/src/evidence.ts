// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Kanıt ÜRETİMİ — ürünün ticari çekirdeği. Bkz. LICENSING-MAP.md.
 *
 * Ayrım şu ilkeye dayanır: **üretmek ücretli, doğrulamak ücretsiz.** Bir
 * müşterinin eline geçmiş kaydı sonsuza kadar, bizden bağımsız, izinsiz
 * doğrulayabilmesi gerekir — o yüzden tüm verify* yolu @kionel/crypto içinde
 * kalıcı olarak Apache-2.0'dır. Yeni kayıt üretmek ise ürünü kullanmaktır ve
 * üretim kullanımı ticari lisansa tabidir.
 *
 * Bu ayrımın DÜRÜST sınırını da yazmak gerekir: kayıt biçimi zaten kamuya
 * açıktır, çünkü doğrulayıcı onu tamamen açığa vurur. Buradaki kod hukuki bir
 * sınırdır, teknik bir engel değil. Kopyalanamayan tek şey Kionel otorite
 * anahtarıyla atılan karşı imzadır (@kionel/licensing).
 */
import {
  ENDORSEMENT_ROLES, KIONEL_V2_PROTOCOL, MAX_CHAIN, MAX_NOTE, MAX_REFERENCE, MAX_V2_CONTENT_BYTES,
  approvalBytes, auditBodyBytes, auditEntryHash, auditEntryV2Hash, auditV2BodyBytes, b64,
  dispatchBytes, dispatchV2Bytes, endorsementBytes, isAuditEntryV2, isQualificationBody,
  isQualificationBodyV2, isReceiptV2, methodManifestBytes, methodReleaseIntegrity, p256KeyReference,
  qualificationEvidenceBytes, qualificationV2Bytes, receiptBytes, receiptHash, receiptV2Bytes,
  receiptV2Hash, sameKey, sha256, signEs256, strictDate, validAuditDate, validAuditEvent,
  validContext, validContextV2, validEndorsementText, verifyDispatchV2, verifyEndorsements,
  verifyKeyReferenceV2, verifyReceiptV2,
  type AuditEntry, type AuditEntryV2, type AuditEvent, type Bytes, type CryptoBytes,
  type Dispatch, type DispatchContext, type DispatchV2, type Endorsement, type EndorsementRole,
  type Identity, type KeyReferenceV2, type MethodManifest, type MethodRelease,
  type QualificationEvidence, type QualificationEvidenceBody, type QualificationEvidenceV2,
  type QualificationEvidenceBodyV2, type Receipt, type ReceiptV2,
} from "@kionel/crypto";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";

/** v1 kayıtları Ed25519 ile imzalanır; v2 ES256'ya geçti (bkz. signEs256). */
async function sign(id: Identity, data: Bytes): Promise<Bytes> {
  return new Uint8Array(await globalThis.crypto.subtle.sign({ name: "Ed25519" }, id.priv, data));
}

const uint32 = (value: number) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

/** Gönderen imzalar: "bunu gönderdim". */
export async function issueDispatch(
  sender: Identity,
  f: { session: number; content: Bytes; at?: Date; context?: DispatchContext },
): Promise<Dispatch> {
  if (f.context && !validContext(f.context)) throw new Error("sevk ürün bağlamı geçersiz");
  const body = {
    v: 1 as const,
    session: f.session,
    hash: b64(await sha256(f.content)),
    bytes: f.content.length,
    at: (f.at ?? new Date()).toISOString(),
    sender: b64(sender.pub),
    ...(f.context ? { context: f.context } : {}),
  };
  return { ...body, sig: b64(await sign(sender, dispatchBytes(body))) };
}

/** Alıcı imzalar: "bunu teslim aldım". Sevk kaydı verilirse ona da bağlanır. */
export async function issueReceipt(
  receiver: Identity,
  f: { session: number; content: Bytes; sender: Bytes; dispatch?: Dispatch; at?: Date },
): Promise<Receipt> {
  const body = {
    v: 1 as const,
    session: f.session,
    hash: b64(await sha256(f.content)),
    bytes: f.content.length,
    at: (f.at ?? new Date()).toISOString(),
    sender: b64(f.sender),
    receiver: b64(receiver.pub),
    ...(f.dispatch ? { dispatch: f.dispatch } : {}),
  };
  return { ...body, sig: b64(await sign(receiver, receiptBytes(body))) };
}

export async function issueAuditEntry(
  actor: Identity,
  previous: AuditEntry | null,
  receipt: Receipt,
  event: AuditEvent,
  at = new Date(),
): Promise<AuditEntry> {
  const body: Omit<AuditEntry, "sig"> = {
    v: 1,
    seq: previous ? previous.seq + 1 : 0,
    previous: previous ? b64(await auditEntryHash(previous)) : null,
    receipt: b64(await receiptHash(receipt)),
    event,
    at: at.toISOString(),
    actor: b64(actor.pub),
  };
  const sig = await globalThis.crypto.subtle.sign({ name: "Ed25519" }, actor.priv, auditBodyBytes(body));
  return { ...body, sig: b64(new Uint8Array(sig)) };
}

/**
 * Zincire bir halka ekler.
 *
 * `chain` mevcut halkalar; boşsa bu ilk onaydır. İçerik hash'i her halkada aynı
 * olmak zorundadır — farklı bir dosyaya onay eklemek zincirin anlamını yok eder.
 */
export async function endorse(
  identity: Identity,
  input: {
    content: Bytes;
    role: EndorsementRole;
    reference?: string;
    note?: string;
    chain?: readonly Endorsement[];
    at?: Date;
  },
): Promise<Endorsement> {
  if (!validEndorsementText(input.reference, MAX_REFERENCE) || !validEndorsementText(input.note, MAX_NOTE)) {
    throw new Error("onay referansı veya notu sınırları aşıyor");
  }
  const chain = input.chain ?? [];
  if (!(ENDORSEMENT_ROLES as readonly string[]).includes(input.role)) throw new Error("onay rolü geçersiz");
  if (chain.length >= MAX_CHAIN) throw new Error(`onay zinciri en fazla ${MAX_CHAIN} halka taşır`);

  const hash = b64(await sha256(input.content));
  for (const link of chain) {
    if (link.hash !== hash) throw new Error("zincirdeki onaylar başka bir içeriğe ait");
  }
  const existing = await verifyEndorsements(chain, input.content);
  if (!existing.ok) throw new Error(existing.reason);

  const body: Omit<Endorsement, "sig"> = {
    v: 1,
    hash,
    role: input.role,
    ...(input.reference ? { reference: input.reference } : {}),
    ...(input.note ? { note: input.note } : {}),
    at: (input.at ?? new Date()).toISOString(),
    signer: b64(identity.pub),
    previous: chain.length ? chain[chain.length - 1].sig : null,
  };
  return { ...body, sig: b64(await sign(identity, endorsementBytes(body))) };
}

export async function issueMethodRelease(
  publisher: Identity,
  content: Bytes,
  input: Pick<MethodManifest, "methodId" | "target" | "revision" | "notBefore" | "expiresAt">,
): Promise<MethodRelease> {
  const manifest: MethodManifest = {
    schema: "kionel-method/v1", releaseId: crypto.randomUUID(),
    methodId: input.methodId, target: input.target, revision: input.revision,
    notBefore: input.notBefore, expiresAt: input.expiresAt,
    hash: b64(await sha256(content)), bytes: content.length,
  };
  const dispatch = await issueDispatch(publisher, {
    session: crypto.getRandomValues(new Uint32Array(1))[0], content: methodManifestBytes(manifest),
  });
  return { schema: "kionel-method-release/v1", manifest, dispatch, endorsements: [] };
}

export async function approveMethodRelease(
  signer: Identity, value: MethodRelease, content: Bytes,
): Promise<MethodRelease> {
  const error = await methodReleaseIntegrity(value, content);
  if (error) throw new Error(error);
  if (value.endorsements.length >= 2) throw new Error("metot zaten serbest bırakılmış");
  const publicKey = b64(signer.pub);
  if (publicKey === value.dispatch.sender || value.endorsements.some(e => e.signer === publicKey)) {
    throw new Error("yayınlayan, inceleyen ve serbest bırakan farklı anahtarlar olmalı");
  }
  const link = await endorse(signer, {
    content: approvalBytes(value), chain: value.endorsements,
    role: value.endorsements.length === 0 ? "reviewer" : "approver",
  });
  return { ...value, endorsements: [...value.endorsements, link] };
}

export async function issueQualificationEvidence(
  identity: Identity,
  input: Omit<QualificationEvidenceBody, "v">,
): Promise<QualificationEvidence> {
  const body: QualificationEvidenceBody = { v: 1, ...input };
  if (!isQualificationBody(body)) throw new Error("fiziksel qualification kanıtı geçersiz");
  const signer = b64(identity.pub);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign(
    { name: "Ed25519" }, identity.priv, qualificationEvidenceBytes(body, signer),
  ));
  return { ...body, signer, sig: b64(sig) };
}

export async function issueQualificationEvidenceV2(
  identity: PlatformSigningIdentity,
  input: Omit<QualificationEvidenceBodyV2, "v" | "protocol">,
): Promise<QualificationEvidenceV2> {
  const body: QualificationEvidenceBodyV2 = { v: 2, protocol: KIONEL_V2_PROTOCOL, ...input };
  if (!isQualificationBodyV2(body)) throw new Error("Kionel v2 fiziksel qualification kanıtı geçersiz");
  const signer = await p256KeyReference(identity);
  return { ...body, signer, sig: b64(await signEs256(identity, qualificationV2Bytes(body, signer))) };
}

export async function issueDispatchV2(
  sender: PlatformSigningIdentity,
  input: { session: number; content: CryptoBytes; at?: Date; context?: DispatchContext },
): Promise<DispatchV2> {
  if (!uint32(input.session) || input.content.length > MAX_V2_CONTENT_BYTES) throw new Error("Kionel v2 sevk sınırları geçersiz");
  if (input.context && !validContextV2(input.context)) throw new Error("Kionel v2 ürün bağlamı geçersiz");
  const body: Omit<DispatchV2, "sig"> = {
    v: 2,
    protocol: KIONEL_V2_PROTOCOL,
    session: input.session,
    hash: b64(await sha256(input.content)),
    bytes: input.content.length,
    at: strictDate(input.at ?? new Date()),
    sender: await p256KeyReference(sender),
    ...(input.context ? { context: input.context } : {}),
  };
  return { ...body, sig: b64(await signEs256(sender, dispatchV2Bytes(body))) };
}

export async function issueReceiptV2(
  receiver: PlatformSigningIdentity,
  input: {
    session: number;
    content: CryptoBytes;
    sender: KeyReferenceV2;
    dispatch?: DispatchV2;
    at?: Date;
  },
): Promise<ReceiptV2> {
  if (!uint32(input.session) || input.content.length > MAX_V2_CONTENT_BYTES) throw new Error("Kionel v2 makbuz sınırları geçersiz");
  if (!(await verifyKeyReferenceV2(input.sender))) throw new Error("Kionel v2 gönderen anahtar referansı geçersiz");
  if (input.dispatch) {
    const dispatchVerdict = await verifyDispatchV2(input.dispatch, input.content);
    if (!dispatchVerdict.ok || input.dispatch.session !== input.session || !sameKey(input.dispatch.sender, input.sender)) {
      throw new Error(`Kionel v2 geçersiz sevk kaydı imzalanamaz: ${dispatchVerdict.reason}`);
    }
  }
  const body: Omit<ReceiptV2, "sig"> = {
    v: 2,
    protocol: KIONEL_V2_PROTOCOL,
    session: input.session,
    hash: b64(await sha256(input.content)),
    bytes: input.content.length,
    at: strictDate(input.at ?? new Date()),
    sender: input.sender,
    receiver: await p256KeyReference(receiver),
    ...(input.dispatch ? { dispatch: input.dispatch } : {}),
  };
  return { ...body, sig: b64(await signEs256(receiver, receiptV2Bytes(body))) };
}

export async function issueAuditEntryV2(
  actor: PlatformSigningIdentity,
  previous: AuditEntryV2 | null,
  receipt: ReceiptV2,
  event: AuditEvent,
  at = new Date(),
): Promise<AuditEntryV2> {
  if (!validAuditEvent(event) || !validAuditDate(at)) throw new Error("Kionel v2 audit olayı geçersiz");
  if (previous && !isAuditEntryV2(previous)) throw new Error("Kionel v2 önceki audit kaydı geçersiz");
  if (!isReceiptV2(receipt) || !(await verifyReceiptV2(receipt)).ok) {
    throw new Error("doğrulanmamış Kionel v2 makbuzu audit zincirine eklenemez");
  }
  const body: Omit<AuditEntryV2, "sig"> = {
    v: 2,
    protocol: KIONEL_V2_PROTOCOL,
    seq: previous ? previous.seq + 1 : 0,
    previous: previous ? b64(await auditEntryV2Hash(previous)) : null,
    receipt: b64(await receiptV2Hash(receipt)),
    event,
    at: at.toISOString(),
    actor: await p256KeyReference(actor),
  };
  return { ...body, sig: b64(await signEs256(actor, auditV2BodyBytes(body))) };
}
