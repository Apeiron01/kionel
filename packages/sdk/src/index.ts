import {
  ControlKind, FrameType, LtDecoder, decodeFrame, decodeHandshakeControl, encodeFrame,
  encodeHandshakeControl, ltEncode, negotiateCapabilities, pack, packSecureEnvelope,
  systematicEncode, unpack, unpackSecureEnvelope,
  type NegotiatedCapabilities, type SessionCapabilities,
} from "@kionel/core";
import {
  b64,
  verifyDispatch,
  type Bytes,
  type Dispatch,
  type DispatchContext,
  type Identity,
  type Pending,
  type Receipt,
  type Session,
} from "@kionel/crypto";
import { answerOffer, createOffer, finishOffer, issueDispatch, issueReceipt } from "@kionel/issue";

export const SDK_VERSION = "0.1.0";
export const DEFAULT_MAX_CONTENT_BYTES = 64 * 1024 * 1024;
export const DEFAULT_CAPABILITIES: SessionCapabilities = Object.freeze({
  v: 1, transports: ["qr-v1"], maxFrameBytes: 1465, maxFps: 30,
  duplex: true, arq: true, resume: true,
});

export interface SdkOptions { capabilities?: SessionCapabilities; maxContentBytes?: number }
export interface SasVerification { digits: string; marks: readonly number[] }
export interface ReceiverOffer { message: Uint8Array; pending: ReceiverPending }
export interface AnsweredOffer {
  message: Uint8Array; verification: SasVerification; sender: SenderSession;
  negotiated: NegotiatedCapabilities;
}
export interface FinishedOffer {
  verification: SasVerification; receiver: ReceiverSession; negotiated: NegotiatedCapabilities;
}
export interface PreparedTransfer {
  dispatch: Dispatch; totalBytes: number; blockSize: number;
  systematicFrames(): Generator<Uint8Array>;
  fountainFrames(): Generator<Uint8Array>;
}
export interface ReceivedTransfer { name: string; data: Uint8Array; dispatch: Dispatch; receipt: Receipt }
export interface IngestResult { accepted: boolean; progress: number; complete: boolean }
export interface ReceiverPending {
  readonly identity: Identity; readonly cryptoPending: Pending;
  readonly capabilities: SessionCapabilities; readonly maxContentBytes: number;
}

export async function createReceiverOffer(identity: Identity, options: SdkOptions = {}): Promise<ReceiverOffer> {
  const capabilities = options.capabilities ?? DEFAULT_CAPABILITIES;
  const maxContentBytes = checkedLimit(options.maxContentBytes);
  const created = await createOffer(identity);
  return {
    message: encodeHandshakeControl({ kind: ControlKind.Offer, record: created.offer, capabilities }),
    pending: { identity, cryptoPending: created.pending, capabilities, maxContentBytes },
  };
}

export async function answerReceiverOffer(
  identity: Identity, message: Uint8Array, options: SdkOptions = {},
): Promise<AnsweredOffer> {
  const control = decodeHandshakeControl(message);
  if (!control || control.kind !== ControlKind.Offer) throw new Error("geçersiz Kionel alıcı teklifi");
  const capabilities = options.capabilities ?? DEFAULT_CAPABILITIES;
  const maxContentBytes = checkedLimit(options.maxContentBytes);
  const answered = await answerOffer(identity, owned(control.record));
  const negotiated = negotiateCapabilities(capabilities, control.capabilities);
  return {
    message: encodeHandshakeControl({ kind: ControlKind.Reply, record: answered.reply, capabilities }),
    verification: verificationOf(answered.session),
    sender: new SenderSession(identity, answered.session, negotiated, maxContentBytes),
    negotiated,
  };
}

export async function finishReceiverOffer(pending: ReceiverPending, message: Uint8Array): Promise<FinishedOffer> {
  const control = decodeHandshakeControl(message);
  if (!control || control.kind !== ControlKind.Reply) throw new Error("geçersiz Kionel gönderici cevabı");
  const session = await finishOffer(pending.cryptoPending, owned(control.record));
  const negotiated = negotiateCapabilities(pending.capabilities, control.capabilities);
  return {
    verification: verificationOf(session),
    receiver: new ReceiverSession(pending.identity, session, negotiated, pending.maxContentBytes),
    negotiated,
  };
}

abstract class VerifiedSession {
  protected verified = false;
  protected readonly session: Session;
  constructor(session: Session) { this.session = session }

  confirmSas(peer: SasVerification): void {
    const marksMatch = peer.marks.length === this.session.sasMarks.length &&
      peer.marks.every((mark, index) => mark === this.session.sasMarks[index]);
    if (peer.digits !== this.session.sas || !marksMatch) {
      throw new Error("SAS doğrulaması başarısız; aktarımı durdurun");
    }
    this.verified = true;
  }
  protected requireVerified(): void {
    if (!this.verified) throw new Error("SAS kullanıcı tarafından doğrulanmadan aktarım başlatılamaz");
  }
}

export class SenderSession extends VerifiedSession {
  private readonly identity: Identity;
  readonly negotiated: NegotiatedCapabilities;
  readonly maxContentBytes: number;
  constructor(identity: Identity, session: Session, negotiated: NegotiatedCapabilities, maxContentBytes: number) {
    super(session); this.identity = identity; this.negotiated = negotiated; this.maxContentBytes = maxContentBytes;
  }

  async prepareTransfer(input: {
    name: string; data: Uint8Array; blockSize?: number; context?: DispatchContext;
  }): Promise<PreparedTransfer> {
    this.requireVerified();
    validateContent(input.data, this.maxContentBytes);
    const blockSize = input.blockSize ?? this.negotiated.frameBytes - 20;
    if (!Number.isInteger(blockSize) || blockSize <= 0 || blockSize + 20 > this.negotiated.frameBytes) {
      throw new Error("blok boyutu müzakere edilen kare kapasitesini aşıyor");
    }
    const content = owned(input.data);
    const dispatch = await issueDispatch(this.identity, {
      session: this.session.sessionId, content, context: input.context,
    });
    const sealed = await this.session.seal(owned(pack({ name: input.name, data: content })));
    const wire = packSecureEnvelope({ metadata: JSON.stringify(dispatch), sealed });
    const sessionId = this.session.sessionId;
    const frame = (seed: number, payload: Uint8Array) => encodeFrame({
      type: FrameType.Data, sessionId, seed, totalBytes: wire.length, blockSize, payload,
    });
    return {
      dispatch, totalBytes: wire.length, blockSize,
      *systematicFrames() {
        for (const item of systematicEncode(wire, blockSize)) yield frame(item.seed, item.payload);
      },
      *fountainFrames() {
        for (const item of ltEncode(wire, blockSize)) yield frame(item.seed, item.payload);
      },
    };
  }
}

export class ReceiverSession extends VerifiedSession {
  private readonly identity: Identity;
  private decoder?: LtDecoder;
  readonly negotiated: NegotiatedCapabilities;
  readonly maxContentBytes: number;
  constructor(identity: Identity, session: Session, negotiated: NegotiatedCapabilities, maxContentBytes: number) {
    super(session); this.identity = identity; this.negotiated = negotiated; this.maxContentBytes = maxContentBytes;
  }

  ingestFrame(bytes: Uint8Array): IngestResult {
    this.requireVerified();
    const frame = decodeFrame(bytes);
    if (!frame || frame.type !== FrameType.Data || frame.sessionId !== this.session.sessionId) {
      return { accepted: false, progress: this.decoder?.progress ?? 0, complete: this.decoder?.done ?? false };
    }
    if (frame.totalBytes > this.maxContentBytes + 128 * 1024) throw new Error("gelen güvenli zarf ürün sınırını aşıyor");
    if (!this.decoder) this.decoder = new LtDecoder(frame.totalBytes, frame.blockSize);
    if (this.decoder.totalBytes !== frame.totalBytes || this.decoder.blockSize !== frame.blockSize) {
      return { accepted: false, progress: this.decoder.progress, complete: this.decoder.done };
    }
    const accepted = this.decoder.ingest(frame.seed, frame.payload);
    return { accepted, progress: this.decoder.progress, complete: this.decoder.done };
  }

  async finalize(): Promise<ReceivedTransfer> {
    this.requireVerified();
    const wire = this.decoder?.result();
    if (!wire) throw new Error("aktarım henüz tamamlanmadı");
    const outer = unpackSecureEnvelope(wire);
    if (!outer) throw new Error("güvenli zarf geçersiz");
    let dispatch: Dispatch;
    try { dispatch = JSON.parse(outer.metadata) as Dispatch } catch { throw new Error("sevk kaydı JSON biçimi geçersiz") }
    const plain = await this.session.open(owned(outer.sealed));
    const envelope = unpack(plain);
    if (!envelope || !envelope.intact) throw new Error("içerik zarfı bütünlük denetiminden geçmedi");
    validateContent(envelope.data, this.maxContentBytes);
    const verdict = await verifyDispatch(dispatch, owned(envelope.data));
    if (!verdict.ok || dispatch.session !== this.session.sessionId || dispatch.sender !== b64(this.session.peer)) {
      throw new Error(`sevk kaydı doğrulanmadı: ${verdict.reason}`);
    }
    const receipt = await issueReceipt(this.identity, {
      session: this.session.sessionId, content: owned(envelope.data), sender: this.session.peer, dispatch,
    });
    return { name: envelope.name, data: owned(envelope.data), dispatch, receipt };
  }
}

function verificationOf(session: Session): SasVerification { return { digits: session.sas, marks: session.sasMarks } }
function validateContent(data: Uint8Array, limit: number): void {
  if (data.length === 0) throw new Error("boş içerik aktarılamaz");
  if (data.length > limit) throw new Error(`içerik ürün sınırını aşıyor (${limit} bayt)`);
}
function checkedLimit(value?: number): number {
  const limit = value ?? DEFAULT_MAX_CONTENT_BYTES;
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > DEFAULT_MAX_CONTENT_BYTES) {
    throw new Error(`maxContentBytes 1..${DEFAULT_MAX_CONTENT_BYTES} aralığında olmalı`);
  }
  return limit;
}
function owned(bytes: Uint8Array): Bytes { return new Uint8Array(bytes) }
export type { Dispatch, DispatchContext, Identity, Receipt, SessionCapabilities };
export * from "./v2.ts";
