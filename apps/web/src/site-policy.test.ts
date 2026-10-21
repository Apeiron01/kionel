import { describe, expect, it } from "vitest";
import { checkContext, checkFile, describePolicy, parsePolicy } from "./site-policy.ts";

const base = { kind: "kionel-policy", version: 1, name: "QC lab" };
const parse = (extra: object) => parsePolicy(JSON.stringify({ ...base, ...extra }));

describe("site politikası", () => {
  it("geçerli politikayı okur ve özetler", () => {
    const policy = parse({ revision: "2026-10", allowedExtensions: ["csv", "pdf"], maxBytes: 10 * 1024 * 1024, referencePattern: "WO-\\d{6}", referenceHint: "WO- and six digits", classifications: ["restricted"] });
    expect(describePolicy(policy)).toBe('Site policy "QC lab" (2026-10): files .csv, .pdf; up to 10 MB; work order WO- and six digits; classification restricted.');
  });

  it("düzeltilebilir cümlelerle reddeder", () => {
    expect(() => parsePolicy("{")).toThrow(/not valid JSON/);
    expect(() => parsePolicy(JSON.stringify({ ...base, kind: "x" }))).toThrow(/kionel-policy/);
    expect(() => parse({ alowedExtensions: ["csv"] })).toThrow(/unknown field "alowedExtensions"/);
    expect(() => parse({ allowedExtensions: [".CSV"] })).toThrow(/lower case without dots/);
    expect(() => parse({ maxBytes: "10MB" })).toThrow(/whole number of bytes/);
    expect(() => parse({ referencePattern: "WO-(" })).toThrow(/not a valid regular expression/);
    expect(() => parse({ classifications: ["secret"] })).toThrow(/internal/);
  });

  it("dosya türü ve boyutu uzantıdan ve bayttan denetler", () => {
    const policy = parse({ allowedExtensions: ["csv"], maxBytes: 1000 });
    expect(checkFile(policy, "sonuc.CSV", 900)).toBeUndefined();
    expect(checkFile(policy, "rapor.pdf", 10)).toMatch(/allows only \.csv files/);
    expect(checkFile(policy, "noext", 10)).toMatch(/allows only/);
    expect(checkFile(policy, "big.csv", 1001)).toMatch(/up to 1 KB/);
  });

  it("iş emri tam eşleşmeli; sınıf listede olmalı", () => {
    const policy = parse({ referencePattern: "WO-\\d{6}", referenceHint: "WO- and six digits", classifications: ["restricted", "confidential"] });
    expect(checkContext(policy, { reference: "WO-123456", classification: "restricted" })).toBeUndefined();
    // ^ ve $ yazılmamış olsa da kısmi eşleşme geçmez.
    expect(checkContext(policy, { reference: "xWO-123456y", classification: "restricted" })).toMatch(/WO- and six digits/);
    expect(checkContext(policy, { reference: "", classification: "restricted" })).toMatch(/does not match/);
    expect(checkContext(policy, { reference: "WO-123456", classification: "internal" })).toMatch(/restricted or confidential/);
  });

  it("operatör zorunluysa boş gönderim reddedilir", () => {
    const policy = parse({ requireOperator: true });
    expect(checkContext(policy, {})).toMatch(/requires the operator's name or ID/);
    expect(checkContext(policy, { operator: "T. Bayar" })).toBeUndefined();
    expect(describePolicy(policy)).toMatch(/operator required/);
    expect(() => parse({ requireOperator: "yes" })).toThrow(/true or false/);
  });
});

describe("sitedeki örnek politika", () => {
  it("yüklenebilir ve kendi örnek iş emrini kabul eder", async () => {
    const { readFileSync } = await import("node:fs");
    const policy = parsePolicy(readFileSync(new URL("../public/examples/kionel-site-policy.json", import.meta.url), "utf8"));
    expect(checkContext(policy, { reference: "WO-004213", classification: "restricted" })).toBeUndefined();
    expect(checkFile(policy, "run.csv", 1000)).toBeUndefined();
  });
});
