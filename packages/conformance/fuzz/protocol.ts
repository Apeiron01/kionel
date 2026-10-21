import {
  decodeAck, decodeCapabilities, decodeFrame, decodeHandshakeControl, encodeFrame,
  unpack, unpackSecureEnvelope,
} from "@kionel/core";
import {
  isAuditEntryV2, isQualificationEvidence, isQualificationEvidenceV2, isReceipt, isReceiptV2,
} from "@kionel/crypto";
import { isEnterpriseTrustBundle } from "@kionel/enterprise";
import { validateManagementPayload } from "@kionel/control-plane";
import { decodeCapabilities as decodeWindowsCapabilities, decodeRecord as decodeWindowsRecord } from "@kionel/platform-keys-windows";
import { DerError, DerReader } from "@kionel/attestation-core";
import { parseKeyDescription } from "@kionel/attestation-android";
import { CborError, decodeCbor } from "@kionel/attestation-apple";
import {
  TpmParseError, decodeAttestationStatement, parseAttest, parseEccPublic, parseSignature,
} from "@kionel/attestation-windows";

/** Jazzer.js/libFuzzer her girdiyi bu senkron hedefe verir. */
export function fuzz(input: Buffer): void {
  if (input.length > 1024 * 1024) return;
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  switch (data[0] % 20) {
    case 0: {
      const frame = decodeFrame(data.subarray(1));
      if (frame) {
        const roundTrip = decodeFrame(encodeFrame(frame));
        if (!roundTrip || roundTrip.sessionId !== frame.sessionId || roundTrip.seed !== frame.seed) {
          throw new Error("frame encode/decode invariant ihlali");
        }
      }
      break;
    }
    case 1: decodeCapabilities(data.subarray(1)); break;
    case 2: decodeHandshakeControl(data.subarray(1)); break;
    case 3: decodeAck(data.subarray(1)); break;
    case 4: unpack(data.subarray(1)); break;
    case 5: unpackSecureEnvelope(data.subarray(1)); break;
    case 6: parseJson(data.subarray(1), isReceipt); break;
    case 7: parseJson(data.subarray(1), isQualificationEvidence); break;
    case 8: parseJson(data.subarray(1), isReceiptV2); break;
    case 9: parseJson(data.subarray(1), isQualificationEvidenceV2); break;
    case 10: parseJson(data.subarray(1), isAuditEntryV2); break;
    case 11: parseJson(data.subarray(1), isEnterpriseTrustBundle); break;
    case 12: parseJson(data.subarray(1), (value) => validateManagementPayload(value).ok); break;
    case 13: parseJson(data.subarray(1), validateWindowsHostResponse); break;
    case 14: expectedParse(() => new DerReader(data.subarray(1), "fuzz DER").next(), DerError); break;
    case 15: expectedParse(() => parseKeyDescription(data.subarray(1)), DerError); break;
    case 16: expectedParse(() => decodeCbor(data.subarray(1)), CborError); break;
    case 17: expectedParse(() => parseAttest(data.subarray(1)), TpmParseError); break;
    case 18: expectedParse(() => parseEccPublic(data.subarray(1)), TpmParseError); break;
    case 19: expectedParse(() => {
      // Both structures are attacker-controlled and use different length rules.
      try { return parseSignature(data.subarray(1)) } catch (error) {
        if (!(error instanceof TpmParseError)) throw error;
        return decodeAttestationStatement(data.subarray(1));
      }
    }, TpmParseError); break;
  }
}

function expectedParse<T>(parse: () => T, expected: abstract new (...args: never[]) => Error): void {
  try { parse() } catch (error) {
    if (!(error instanceof expected)) throw error;
  }
}

function parseJson(data: Uint8Array, validate: (value: unknown) => boolean): void {
  try { validate(JSON.parse(new TextDecoder().decode(data))) } catch { /* geçersiz JSON beklenen girdidir */ }
}

function validateWindowsHostResponse(value: unknown): boolean {
  try { decodeWindowsRecord(value); return true } catch { /* try the capabilities schema */ }
  try { decodeWindowsCapabilities(value); return true } catch { return false }
}
