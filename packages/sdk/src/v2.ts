import {
  ControlKind, FrameType, LtDecoder, decodeFrame, decodeHandshakeControl, encodeFrame,
  encodeHandshakeControl, ltEncode, negotiateCapabilities, pack, packSecureEnvelope,
  systematicEncode, unpack, unpackSecureEnvelope,
  type NegotiatedCapabilities, type SessionCapabilities,
} from "@kionel/core";
import {
  isDispatchV2,
  p256KeyReferenceFromPublicKey,
  verifyDispatchV2,
  type CryptoBytes,
  type DispatchContext,
  type DispatchV2,
  type KeyReferenceV2,
  type ReceiptV2,
} from "@kionel/crypto";
import {
  answerOfferV2,
  createOfferV2,
  finishOfferV2,
  issueDispatchV2,
  issueReceiptV2,
  type PendingV2,
  type SessionV2,
} from "@kionel/issue";
import {
  ENTERPRISE_KEY_POLICY, requireKeyPolicy, requireWireCompatibility,
  type KeyPolicy, type PlatformSigningIdentity,
} from "@kionel/platform-keys";

const V2_DEFAULT_MAX_CONTENT_BYTES = 64 * 1024 * 1024;
const V2_DEFAULT_CAPABILITIES: SessionCapabilities = Object.freeze({
  v: 1, transports: ["qr-v1"], maxFrameBytes: 1465, maxFps: 30,
  duplex: true, arq: true, resume: true,
});
export interface SasVerificationV2 { digits: string; marks: readonly number[] }
export interface IngestResultV2 { accepted: boolean; progress: number; complete: boolean }

export interface PeerTrustVerdict { trusted: boolean; reason: string }
export type PeerTrustResolver = (peer: KeyReferenceV2) => Promise<PeerTrustVerdict>;

export interface SdkV2Options {
  localKeyPolicy: KeyPolicy;
  capabilities?: SessionCapabilities;
  maxContentBytes?: number;
  requireTrustedPeer?: boolean;
  verifyPeer?: PeerTrustResolver;
  allowedProfiles?: readonly DispatchContext["profile"][];
  requireContext?: boolean;
}

export function enterpriseSdkV2Options(verifyPeer: PeerTrustResolver): SdkV2Options {
  return { localKeyPolicy: ENTERPRISE_KEY_POLICY, requireTrustedPeer: true, verifyPeer };
}

export interface ReceiverOfferV2 { message: Uint8Array; pending: ReceiverPendingV2 }
export interface ReceiverPendingV2 {
  readonly identity: PlatformSigningIdentity;
  readonly cryptoPending: PendingV2;
  readonly capabilities: SessionCapabilities;
  readonly maxContentBytes: number;
  readonly trust: PeerTrustConfiguration;
  readonly transferPolicy: TransferPolicyConfiguration;
}
export interface AnsweredOfferV2 {
  message: Uint8Array;
  verification: SasVerificationV2;
  sender: SenderSessionV2;
  negotiated: NegotiatedCapabilities;
  peer: KeyReferenceV2;
}
export interface FinishedOfferV2 {
  verification: SasVerificationV2;
  receiver: ReceiverSessionV2;
  negotiated: NegotiatedCapabilities;
  peer: KeyReferenceV2;
}
export interface PreparedTransferV2 {
  dispatch: DispatchV2;
  totalBytes: number;
  blockSize: number;
  systematicFrames(): Generator<Uint8Array>;
  fountainFrames(): Generator<Uint8Array>;
}
export interface ReceivedTransferV2 { name: string; data: Uint8Array; dispatch: DispatchV2; receipt: ReceiptV2 }

interface PeerTrustConfiguration {
  required: boolean;
  resolver?: PeerTrustResolver;
}
interface TransferPolicyConfiguration {
  allowedProfiles: readonly DispatchContext["profile"][];
  requireContext: boolean;
}

export async function createReceiverOfferV2(
  identity: PlatformSigningIdentity,
  options: SdkV2Options,
): Promise<ReceiverOfferV2> {
  validateLocalIdentity(identity, options.localKeyPolicy);
  const capabilities = options.capabilities ?? V2_DEFAULT_CAPABILITIES;
  const maxContentBytes = checkedLimitV2(options.maxContentBytes);
  const created = await createOfferV2(identity);
  return {
    message: encodeHandshakeControl({ kind: ControlKind.Offer, record: created.offer, capabilities }),
    pending: {
      identity, cryptoPending: created.pending, capabilities, maxContentBytes,
      trust: trustConfiguration(options),
      transferPolicy: transferPolicy(options),
    },
  };
}

export async function answerReceiverOfferV2(
  identity: PlatformSigningIdentity,
  message: Uint8Array,
  options: SdkV2Options,
): Promise<AnsweredOfferV2> {
  validateLocalIdentity(identity, options.localKeyPolicy);
  const control = decodeHandshakeControl(message);
  if (!control || control.kind !== ControlKind.Offer) throw new Error("geçersiz Kionel v2 alıcı teklifi");
  const capabilities = options.capabilities ?? V2_DEFAULT_CAPABILITIES;
  const maxContentBytes = checkedLimitV2(options.maxContentBytes);
  const answered = await answerOfferV2(identity, bytes(control.record));
  const peer = await verifyPeerTrust(answered.session, trustConfiguration(options));
  const negotiated = negotiateCapabilities(capabilities, control.capabilities);
  return {
    message: encodeHandshakeControl({ kind: ControlKind.Reply, record: answered.reply, capabilities }),
    verification: verification(answered.session),
    sender: new SenderSessionV2(identity, answered.session, negotiated, maxContentBytes, transferPolicy(options)),
    negotiated,
    peer,
  };
}

export async function finishReceiverOfferV2(
  pending: ReceiverPendingV2,
  message: Uint8Array,
): Promise<FinishedOfferV2> {
  const control = decodeHandshakeControl(message);
  if (!control || control.kind !== ControlKind.Reply) throw new Error("geçersiz Kionel v2 gönderici cevabı");
  const session = await finishOfferV2(pending.cryptoPending, bytes(control.record));
  const peer = await verifyPeerTrust(session, pending.trust);
  const negotiated = negotiateCapabilities(pending.capabilities, control.capabilities);
  return {
    verification: verification(session),
    receiver: new ReceiverSessionV2(
      pending.identity, session, negotiated, pending.maxContentBytes, pending.transferPolicy,
    ),
    negotiated,
    peer,
  };
}

abstract class VerifiedSessionV2 {
  protected verified = false;
  protected readonly session: SessionV2;
  constructor(session: SessionV2) { this.session = session }
  confirmSas(peer: SasVerificationV2): void {
    const marksMatch = peer.marks.length === this.session.sasMarks.length &&
      peer.marks.every((mark, index) => mark === this.session.sasMarks[index]);
    if (peer.digits !== this.session.sas || !marksMatch) {
      throw new Error("Kionel v2 SAS doğrulaması başarısız; aktarımı durdurun");
    }
    this.verified = true;
  }
  protected requireVerified(): void {
    if (!this.verified) throw new Error("Kionel v2 SAS kullanıcı tarafından doğrulanmadan aktarım başlatılamaz");
  }
}

export class SenderSessionV2 extends VerifiedSessionV2 {
  private readonly identity: PlatformSigningIdentity;
  readonly negotiated: NegotiatedCapabilities;
  readonly maxContentBytes: number;
  readonly transferPolicy: TransferPolicyConfiguration;
  constructor(
    identity: PlatformSigningIdentity,
    session: SessionV2,
    negotiated: NegotiatedCapabilities,
    maxContentBytes: number,
    transferPolicyValue: TransferPolicyConfiguration,
  ) {
    super(session); this.identity = identity; this.negotiated = negotiated; this.maxContentBytes = maxContentBytes;
    this.transferPolicy = transferPolicyValue;
  }

  async prepareTransfer(input: {
    name: string; data: Uint8Array; blockSize?: number; context?: DispatchContext;
  }): Promise<PreparedTransferV2> {
    this.requireVerified();
    validateContentV2(input.data, this.maxContentBytes);
    validateTransferContext(input.context, this.transferPolicy);
    const blockSize = input.blockSize ?? this.negotiated.frameBytes - 20;
    if (!Number.isInteger(blockSize) || blockSize <= 0 || blockSize + 20 > this.negotiated.frameBytes) {
      throw new Error("Kionel v2 blok boyutu müzakere edilen kare kapasitesini aşıyor");
    }
    const content = bytes(input.data);
    const dispatch = await issueDispatchV2(this.identity, {
      session: this.session.sessionId, content, context: input.context,
    });
    const sealed = await this.session.seal(bytes(pack({ name: input.name, data: content })));
    const wire = packSecureEnvelope({ metadata: JSON.stringify(dispatch), sealed });
    const sessionId = this.session.sessionId;
    const frame = (seed: number, payload: Uint8Array) => encodeFrame({
      type: FrameType.Data, sessionId, seed, totalBytes: wire.length, blockSize, payload,
    });
    return {
      dispatch, totalBytes: wire.length, blockSize,
      *systematicFrames() { for (const item of systematicEncode(wire, blockSize)) yield frame(item.seed, item.payload) },
      *fountainFrames() { for (const item of ltEncode(wire, blockSize)) yield frame(item.seed, item.payload) },
    };
  }
}

export class ReceiverSessionV2 extends VerifiedSessionV2 {
  private readonly identity: PlatformSigningIdentity;
  private decoder?: LtDecoder;
  readonly negotiated: NegotiatedCapabilities;
  readonly maxContentBytes: number;
  readonly transferPolicy: TransferPolicyConfiguration;
  constructor(
    identity: PlatformSigningIdentity,
    session: SessionV2,
    negotiated: NegotiatedCapabilities,
    maxContentBytes: number,
    transferPolicyValue: TransferPolicyConfiguration,
  ) {
    super(session); this.identity = identity; this.negotiated = negotiated; this.maxContentBytes = maxContentBytes;
    this.transferPolicy = transferPolicyValue;
  }

  ingestFrame(input: Uint8Array): IngestResultV2 {
    this.requireVerified();
    const frame = decodeFrame(input);
    if (!frame || frame.type !== FrameType.Data || frame.sessionId !== this.session.sessionId) {
      return { accepted: false, progress: this.decoder?.progress ?? 0, complete: this.decoder?.done ?? false };
    }
    if (frame.totalBytes > this.maxContentBytes + 128 * 1024) throw new Error("Kionel v2 güvenli zarf ürün sınırını aşıyor");
    if (!this.decoder) this.decoder = new LtDecoder(frame.totalBytes, frame.blockSize);
    if (this.decoder.totalBytes !== frame.totalBytes || this.decoder.blockSize !== frame.blockSize) {
      return { accepted: false, progress: this.decoder.progress, complete: this.decoder.done };
    }
    const accepted = this.decoder.ingest(frame.seed, frame.payload);
    return { accepted, progress: this.decoder.progress, complete: this.decoder.done };
  }

  async finalize(): Promise<ReceivedTransferV2> {
    this.requireVerified();
    const wire = this.decoder?.result();
    if (!wire) throw new Error("Kionel v2 aktarım henüz tamamlanmadı");
    const outer = unpackSecureEnvelope(wire);
    if (!outer) throw new Error("Kionel v2 güvenli zarf geçersiz");
    let dispatchValue: unknown;
    try { dispatchValue = JSON.parse(outer.metadata) } catch { throw new Error("Kionel v2 sevk JSON biçimi geçersiz") }
    if (!isDispatchV2(dispatchValue)) throw new Error("Kionel v2 sevk biçimi geçersiz");
    const plain = await this.session.open(bytes(outer.sealed));
    const envelope = unpack(plain);
    if (!envelope || !envelope.intact) throw new Error("Kionel v2 içerik zarfı bütünlük denetiminden geçmedi");
    validateContentV2(envelope.data, this.maxContentBytes);
    const dispatch = dispatchValue;
    validateTransferContext(dispatch.context, this.transferPolicy);
    const verdict = await verifyDispatchV2(dispatch, bytes(envelope.data));
    const peer = await p256KeyReferenceFromPublicKey(this.session.peer);
    if (!verdict.ok || dispatch.session !== this.session.sessionId || dispatch.sender.kid !== peer.kid) {
      throw new Error(`Kionel v2 sevk kaydı doğrulanmadı: ${verdict.reason}`);
    }
    const receipt = await issueReceiptV2(this.identity, {
      session: this.session.sessionId, content: bytes(envelope.data), sender: peer, dispatch,
    });
    return { name: envelope.name, data: bytes(envelope.data), dispatch, receipt };
  }
}

async function verifyPeerTrust(session: SessionV2, trust: PeerTrustConfiguration): Promise<KeyReferenceV2> {
  const peer = await p256KeyReferenceFromPublicKey(session.peer);
  if (!trust.required) return peer;
  if (!trust.resolver) throw new Error("kurumsal Kionel v2 akışı peer enrollment doğrulayıcısı gerektiriyor");
  const verdict = await trust.resolver(peer);
  if (!verdict.trusted) throw new Error(`karşı cihaz kurum enrollment kaydında güvenilir değil: ${verdict.reason}`);
  return peer;
}
function trustConfiguration(options: SdkV2Options): PeerTrustConfiguration {
  return { required: options.requireTrustedPeer ?? false, resolver: options.verifyPeer };
}
function transferPolicy(options: SdkV2Options): TransferPolicyConfiguration {
  const allowedProfiles = options.allowedProfiles ?? ["lab", "custody", "personal"];
  if (!allowedProfiles.length || new Set(allowedProfiles).size !== allowedProfiles.length ||
      allowedProfiles.some((profile) => !["lab", "custody", "personal"].includes(profile))) {
    throw new Error("Kionel v2 izin verilen ürün profilleri geçersiz");
  }
  return { allowedProfiles: [...allowedProfiles], requireContext: options.requireContext ?? false };
}
function validateTransferContext(
  context: DispatchContext | undefined,
  policy: TransferPolicyConfiguration,
): void {
  if (policy.requireContext && !context) throw new Error("Kionel v2 kurumsal politika imzalı işlem bağlamı gerektiriyor");
  if (context && !policy.allowedProfiles.includes(context.profile)) {
    throw new Error(`Kionel v2 ürün profili politika tarafından engellendi: ${context.profile}`);
  }
}
function validateLocalIdentity(identity: PlatformSigningIdentity, policy: KeyPolicy): void {
  requireWireCompatibility(identity, 2);
  requireKeyPolicy(identity, policy);
}
function verification(session: SessionV2): SasVerificationV2 { return { digits: session.sas, marks: session.sasMarks } }
function validateContentV2(data: Uint8Array, limit: number): void {
  if (data.length === 0) throw new Error("boş içerik aktarılamaz");
  if (data.length > limit) throw new Error(`Kionel v2 içerik ürün sınırını aşıyor (${limit} bayt)`);
}
function checkedLimitV2(value?: number): number {
  const limit = value ?? V2_DEFAULT_MAX_CONTENT_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > V2_DEFAULT_MAX_CONTENT_BYTES) {
    throw new Error(`Kionel v2 maxContentBytes 1..${V2_DEFAULT_MAX_CONTENT_BYTES} aralığında olmalı`);
  }
  return limit;
}
function bytes(value: Uint8Array): CryptoBytes { return new Uint8Array(value) }
