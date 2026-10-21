import { expect, it } from "vitest";
import { compareSamples, sampleIds } from "./sample-reconciliation.ts";

it("reports both duplicate lists even when the set of IDs is equal", () => {
  expect(compareSamples("001\n001\n002", "002\n001\n002")).toMatchObject({
    matches: false, missing: [], unexpected: [], duplicateExpected: ["001"], duplicateReceived: ["002"],
  });
});
it("preserves leading zeroes, case and Unicode identity", () => {
  expect(compareSamples("001\nABC\né", "1\nabc\né")).toMatchObject({
    matches: false, missing: ["001", "ABC", "é"], unexpected: ["1", "abc", "é"],
  });
});
it("accepts reordered exact lists, rejects blank lists and ambiguous whitespace", () => {
  expect(compareSamples("001\r\n002", "002\n001").matches).toBe(true);
  expect(() => compareSamples("", "1")).toThrow();
  expect(() => sampleIds(" A")).toThrow();
  expect(() => sampleIds("A\tB")).toThrow();
  expect(() => sampleIds("a\n".repeat(10_001))).toThrow();
});
