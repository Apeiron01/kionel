/** Enforce byte limits while reading; Content-Length is only an early hint. */
export class BodyTooLargeError extends Error {
  constructor() { super("Body exceeds the byte limit"); this.name = "BodyTooLargeError"; }
}

export async function readBoundedBody(message: Request | Response, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!message.body) return new Uint8Array();
  const reader = message.body.getReader();
  try {
    if (Number(message.headers.get("Content-Length")) > maxBytes) throw new BodyTooLargeError();
    const bytes = new Uint8Array(maxBytes);
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return bytes.slice(0, length);
      if (value.byteLength > maxBytes - length) throw new BodyTooLargeError();
      bytes.set(value, length);
      length += value.byteLength;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}
