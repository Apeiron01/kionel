/**
 * Minimal, strict CBOR decoder.
 *
 * Apple's App Attest object is CBOR supplied by the client, so this parser sees
 * attacker-controlled bytes. It decodes only what the attestation format uses
 * and rejects everything else: indefinite lengths, non-canonical integer
 * encodings, tags, floats, duplicate map keys and trailing bytes.
 *
 * A permissive CBOR parser is a classic source of attestation bypasses — two
 * implementations disagreeing about the same bytes is all an attacker needs.
 */

export class CborError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "CborError";
  }
}

export type CborValue = number | Uint8Array | string | CborValue[] | Map<string, CborValue>;

const MajorType = { Unsigned: 0, Negative: 1, Bytes: 2, Text: 3, Array: 4, Map: 5, Tag: 6, Simple: 7 } as const;
const MAX_ITEMS = 4096;
const MAX_BYTES = 1024 * 1024;

export function decodeCbor(bytes: Uint8Array): CborValue {
  const reader = new CborReader(bytes);
  const value = reader.value(0);
  reader.end();
  return value;
}

class CborReader {
  private pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  end(): void {
    if (this.pos !== this.bytes.length) throw new CborError("trailing-bytes", "CBOR verisinde artık bayt var");
  }

  value(depth: number): CborValue {
    if (depth > 8) throw new CborError("too-deep", "CBOR yapısı fazla iç içe");
    const initial = this.byte();
    const major = initial >> 5;
    const argument = this.argument(initial & 0x1f);

    switch (major) {
      case MajorType.Unsigned:
        return argument;
      case MajorType.Negative:
        return -1 - argument;
      case MajorType.Bytes:
        return this.take(this.bounded(argument, MAX_BYTES, "byte string"));
      case MajorType.Text: {
        const encoded = this.take(this.bounded(argument, MAX_BYTES, "text"));
        try {
          return new TextDecoder("utf-8", { fatal: true }).decode(encoded);
        } catch {
          throw new CborError("invalid-utf8", "CBOR metni geçerli UTF-8 değil");
        }
      }
      case MajorType.Array: {
        const count = this.bounded(argument, MAX_ITEMS, "array");
        return Array.from({ length: count }, () => this.value(depth + 1));
      }
      case MajorType.Map: {
        const count = this.bounded(argument, MAX_ITEMS, "map");
        const map = new Map<string, CborValue>();
        for (let index = 0; index < count; index++) {
          const key = this.value(depth + 1);
          if (typeof key !== "string") throw new CborError("non-text-key", "CBOR eşleme anahtarı metin olmalı");
          if (map.has(key)) throw new CborError("duplicate-key", `CBOR eşlemesinde tekrarlanan anahtar: ${key}`);
          map.set(key, this.value(depth + 1));
        }
        return map;
      }
      default:
        throw new CborError("unsupported-major-type", `desteklenmeyen CBOR türü ${major}`);
    }
  }

  /** Canonical CBOR: the shortest encoding that fits is the only legal one. */
  private argument(info: number): number {
    if (info < 24) return info;
    if (info === 24) return this.minimal(this.byte(), 24, 1);
    if (info === 25) return this.minimal((this.byte() << 8) | this.byte(), 0x100, 2);
    if (info === 26) {
      const value = ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
      return this.minimal(value, 0x10000, 4);
    }
    if (info === 27) throw new CborError("argument-too-large", "64 bit CBOR argümanı desteklenmiyor");
    if (info === 31) throw new CborError("indefinite-length", "CBOR belirsiz uzunluk kabul edilmiyor");
    throw new CborError("reserved-argument", "ayrılmış CBOR argüman biçimi");
  }

  private minimal(value: number, floor: number, width: number): number {
    if (value < floor) throw new CborError("non-canonical", `${width} baytlık CBOR argümanı minimal kodlanmamış`);
    return value;
  }

  private bounded(value: number, limit: number, what: string): number {
    if (value > limit) throw new CborError("oversized", `CBOR ${what} sınırı aşıyor`);
    return value;
  }

  private byte(): number {
    if (this.pos >= this.bytes.length) throw new CborError("truncated", "CBOR verisi kesik");
    return this.bytes[this.pos++];
  }

  private take(count: number): Uint8Array {
    if (this.pos + count > this.bytes.length) throw new CborError("truncated", "CBOR verisi kesik");
    const value = this.bytes.subarray(this.pos, this.pos + count);
    this.pos += count;
    return value;
  }
}

export function cborMap(value: CborValue, what: string): Map<string, CborValue> {
  if (!(value instanceof Map)) throw new CborError("expected-map", `${what} bir CBOR eşlemesi olmalı`);
  return value;
}

export function cborBytes(value: CborValue | undefined, what: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new CborError("expected-bytes", `${what} bayt dizisi olmalı`);
  return value;
}

export function cborText(value: CborValue | undefined, what: string): string {
  if (typeof value !== "string") throw new CborError("expected-text", `${what} metin olmalı`);
  return value;
}

export function cborArray(value: CborValue | undefined, what: string): CborValue[] {
  if (!Array.isArray(value)) throw new CborError("expected-array", `${what} dizi olmalı`);
  return value;
}
