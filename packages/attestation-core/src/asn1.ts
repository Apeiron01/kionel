// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * Minimal, strict DER reader.
 *
 * Android key attestation lives inside an X.509 extension, so the verifier has
 * to parse attacker-supplied ASN.1. Everything here fails loudly instead of
 * guessing: indefinite lengths, non-minimal length encodings, truncated values
 * and trailing bytes are all errors. A lenient parser here is a forged
 * attestation later.
 *
 * Only what the KeyDescription structure needs is implemented.
 */

export class DerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DerError";
  }
}

export const DerClass = { Universal: 0, Application: 1, Context: 2, Private: 3 } as const;
export const DerTag = {
  Boolean: 1, Integer: 2, BitString: 3, OctetString: 4, Null: 5,
  Oid: 6, Enumerated: 10, Sequence: 16, Set: 17,
} as const;

export interface DerTlv {
  tagClass: number;
  constructed: boolean;
  tag: number;
  value: Uint8Array;
}

export class DerReader {
  private pos = 0;
  // Explicit fields, not parameter properties: node --experimental-strip-types
  // rejects those, and the offline verifier CLI runs under exactly that flag.
  private readonly bytes: Uint8Array;
  private readonly what: string;

  constructor(bytes: Uint8Array, what: string) {
    this.bytes = bytes;
    this.what = what;
  }

  get atEnd(): boolean { return this.pos >= this.bytes.length }

  end(): void {
    if (!this.atEnd) throw new DerError("trailing-bytes", `${this.what} has ${this.bytes.length - this.pos} trailing bytes`);
  }

  next(): DerTlv {
    const first = this.byte();
    const tagClass = first >> 6;
    const constructed = (first & 0x20) !== 0;
    let tag = first & 0x1f;
    if (tag === 0x1f) {
      // High tag number form: Android uses tags well above 30 (e.g. [709]).
      tag = 0;
      let byte: number;
      let count = 0;
      do {
        byte = this.byte();
        if (count === 0 && byte === 0x80) throw new DerError("non-minimal-tag", `${this.what} uses a non-minimal tag`);
        tag = tag * 128 + (byte & 0x7f);
        if (++count > 4) throw new DerError("tag-too-large", `${this.what} tag number is out of range`);
      } while ((byte & 0x80) !== 0);
    }

    let length = this.byte();
    if (length === 0x80) throw new DerError("indefinite-length", `${this.what} uses indefinite length, which DER forbids`);
    if (length > 0x80) {
      const count = length & 0x7f;
      if (count > 4) throw new DerError("length-too-large", `${this.what} length field is out of range`);
      let value = 0;
      for (let i = 0; i < count; i++) value = value * 256 + this.byte();
      if (value < 0x80) throw new DerError("non-minimal-length", `${this.what} uses a non-minimal length encoding`);
      length = value;
    }

    if (this.pos + length > this.bytes.length) throw new DerError("truncated", `${this.what} is truncated`);
    const value = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return { tagClass, constructed, tag, value };
  }

  private byte(): number {
    if (this.pos >= this.bytes.length) throw new DerError("truncated", `${this.what} is truncated`);
    return this.bytes[this.pos++];
  }
}

export function expect(tlv: DerTlv, tagClass: number, tag: number, constructed: boolean, what: string): DerTlv {
  if (tlv.tagClass !== tagClass || tlv.tag !== tag || tlv.constructed !== constructed) {
    throw new DerError("unexpected-tag", `${what} has an unexpected ASN.1 tag`);
  }
  return tlv;
}

export function readerOf(tlv: DerTlv, what: string): DerReader {
  return new DerReader(tlv.value, what);
}

export function sequenceReader(tlv: DerTlv, what: string): DerReader {
  return readerOf(expect(tlv, DerClass.Universal, DerTag.Sequence, true, what), what);
}

/** Context-specific EXPLICIT wrapper: exactly one inner value, nothing else. */
export function explicit(tlv: DerTlv, what: string): DerTlv {
  if (tlv.tagClass !== DerClass.Context || !tlv.constructed) {
    throw new DerError("unexpected-tag", `${what} is not an explicit context tag`);
  }
  const reader = readerOf(tlv, what);
  const inner = reader.next();
  reader.end();
  return inner;
}

export function asInteger(tlv: DerTlv, what: string): number {
  expect(tlv, DerClass.Universal, DerTag.Integer, false, what);
  return integerValue(tlv.value, what);
}

export function asEnumerated(tlv: DerTlv, what: string): number {
  expect(tlv, DerClass.Universal, DerTag.Enumerated, false, what);
  return integerValue(tlv.value, what);
}

export function asOctetString(tlv: DerTlv, what: string): Uint8Array {
  return expect(tlv, DerClass.Universal, DerTag.OctetString, false, what).value;
}

export function asBoolean(tlv: DerTlv, what: string): boolean {
  expect(tlv, DerClass.Universal, DerTag.Boolean, false, what);
  if (tlv.value.length !== 1 || (tlv.value[0] !== 0x00 && tlv.value[0] !== 0xff)) {
    throw new DerError("non-der-boolean", `${what} is not a DER boolean`);
  }
  return tlv.value[0] === 0xff;
}

export function asIntegerSet(tlv: DerTlv, what: string): number[] {
  const reader = readerOf(expect(tlv, DerClass.Universal, DerTag.Set, true, what), what);
  const values: number[] = [];
  while (!reader.atEnd) values.push(asInteger(reader.next(), what));
  return values;
}

function integerValue(bytes: Uint8Array, what: string): number {
  if (bytes.length === 0) throw new DerError("empty-integer", `${what} has an empty INTEGER`);
  if (bytes.length > 4) throw new DerError("integer-too-large", `${what} INTEGER exceeds the supported range`);
  if (bytes[0] & 0x80) throw new DerError("negative-integer", `${what} INTEGER is negative`);
  if (bytes.length > 1 && bytes[0] === 0x00 && (bytes[1] & 0x80) === 0) {
    throw new DerError("non-minimal-integer", `${what} INTEGER is not minimally encoded`);
  }
  let value = 0;
  for (const byte of bytes) value = value * 256 + byte;
  return value;
}

/** OBJECT IDENTIFIER as a dotted string. Rejects the non-minimal encodings a
 * forged blob would use to smuggle a different OID past a lenient parser. */
export function asOid(tlv: DerTlv, what: string): string {
  expect(tlv, DerClass.Universal, DerTag.Oid, false, what);
  const bytes = tlv.value;
  if (bytes.length === 0) throw new DerError("empty-oid", `${what} has an empty OBJECT IDENTIFIER`);
  if (bytes[bytes.length - 1] & 0x80) throw new DerError("truncated-oid", `${what} OBJECT IDENTIFIER is truncated`);

  const parts: number[] = [];
  let value = 0;
  let started = false;
  for (const byte of bytes) {
    if (!started && byte === 0x80) throw new DerError("non-minimal-oid", `${what} OBJECT IDENTIFIER arc is not minimally encoded`);
    started = true;
    value = value * 128 + (byte & 0x7f);
    if (value > Number.MAX_SAFE_INTEGER) throw new DerError("oid-arc-too-large", `${what} OBJECT IDENTIFIER arc is out of range`);
    if ((byte & 0x80) === 0) {
      parts.push(value);
      value = 0;
      started = false;
    }
  }

  const first = parts.shift()!;
  const root = first >= 80 ? 2 : Math.floor(first / 40);
  return [root, first - root * 40, ...parts].join(".");
}

/** BIT STRING with no unused bits — the only shape these formats use. */
export function asBitString(tlv: DerTlv, what: string): Uint8Array {
  expect(tlv, DerClass.Universal, DerTag.BitString, false, what);
  if (tlv.value.length === 0) throw new DerError("empty-bit-string", `${what} has an empty BIT STRING`);
  if (tlv.value[0] !== 0) throw new DerError("unused-bits", `${what} BIT STRING has unused bits`);
  return tlv.value.subarray(1);
}

/**
 * GeneralizedTime, restricted to the DER profile: four-digit year through
 * seconds, always UTC, no fractional part. A timestamp is only worth something
 * if its time cannot be read two ways, so local offsets and omitted seconds are
 * rejected rather than interpreted.
 */
export function asGeneralizedTime(tlv: DerTlv, what: string): Date {
  expect(tlv, DerClass.Universal, 24, false, what);
  const text = new TextDecoder("ascii", { fatal: true }).decode(tlv.value);
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!match) throw new DerError("non-der-time", `${what} GeneralizedTime is not in the DER profile (YYYYMMDDHHMMSSZ)`);
  const [, year, month, day, hour, minute, second] = match.map(Number) as unknown as number[];
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (Number.isNaN(at.getTime()) || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    throw new DerError("invalid-time", `${what} GeneralizedTime is not a real instant`);
  }
  return at;
}
