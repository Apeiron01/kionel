import { expect, it } from "vitest";
import { BodyTooLargeError, readBoundedBody } from "./body.ts";

it("accepts an exact byte limit, including a body split across chunks", async () => {
  const body = new ReadableStream<Uint8Array>({ start(c) {
    c.enqueue(new Uint8Array([1, 2])); c.enqueue(new Uint8Array([3, 4])); c.close();
  } });
  expect(await readBoundedBody(new Response(body), 4)).toEqual(new Uint8Array([1, 2, 3, 4]));
  expect(await readBoundedBody(new Response(null), 4)).toEqual(new Uint8Array());
});

it.each([undefined, "1"])("stops an oversized stream despite Content-Length=%s", async (length) => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(c) { pulls++; c.enqueue(new Uint8Array(3)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const response = new Response(body, { headers: length ? { "Content-Length": length } : {} });
  await expect(readBoundedBody(response, 4)).rejects.toBeInstanceOf(BodyTooLargeError);
  expect(pulls).toBe(2);
  expect(cancelled).toBe(true);
  expect(body.locked).toBe(false);
});

it("rejects an oversized declared length without pulling the body", async () => {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull() { pulls++; }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  await expect(readBoundedBody(new Response(body, { headers: { "Content-Length": "100" } }), 4))
    .rejects.toBeInstanceOf(BodyTooLargeError);
  expect(pulls).toBe(0);
  expect(cancelled).toBe(true);
});
