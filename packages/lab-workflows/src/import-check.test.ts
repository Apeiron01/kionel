import { describe, expect, it } from "vitest";
import { checkImport, decodeImport, IMPORT_EXAMPLE as example, parseImportCsv, readImportProfile, writeImportCsv } from "./import-check.ts";

const table = () => parseImportCsv(example.source);
const plan = () => parseImportCsv(example.plan);
const profile = () => structuredClone(example.profile);

describe("import check: real CSV and reusable mappings", () => {
  it("maps names and decimal separator while preserving ID and decimal precision", () => {
    const result = checkImport(profile(), table(), plan());
    expect(result.state).toBe("passed");
    expect(result.coverageChecked).toBe(true);
    expect(result.targetAccepted).toBe(false);
    expect(result.signed).toBe(false);
    expect(writeImportCsv(result.output!, ",")).toBe("sample_id,test_code,result,unit\r\n0001,PH,7.20,pH\r\n0001,FE,0.15,mg/L\r\n0002,FE,0.08,mg/L\r\n");
  });
  it("detects a missing record even with unchanged row count", () => {
    const result = checkImport(profile(), parseImportCsv(example.broken), plan());
    expect(result.findings.map((f) => f.code)).toEqual(["duplicate_key", "missing_key"]);
    expect(result.output).toBeNull();
  });
  it("does not invent a coverage check from the observed records", () => {
    const result = checkImport(profile(), table());
    expect(result.state).toBe("passed");
    expect(result.coverageChecked).toBe(false);
    expect(result.expectedRows).toBeNull();
  });
  it("blocks header drift and row-width changes", () => {
    expect(checkImport(profile(), { ...table(), columns: ["Test", "Sample", "Value", "Unit"] }).findings[0].code).toBe("schema_changed");
    const t = table(); t.rows[0].pop();
    expect(checkImport(profile(), t).findings[0].code).toBe("row_shape");
  });
  it.each([
    ["lost zero", 0, "1", "identifier_width"],
    ["wrong decimal", 2, "7.20", "invalid_decimal"],
    ["wrong unit", 3, "g/L", "invalid_choice"],
    ["spreadsheet formula", 1, "=HYPERLINK(\"https://bad.test\")", "formula_like"],
    ["leading whitespace", 1, " FE", "invalid_cell"],
    ["scientific notation", 2, "1E-5", "invalid_decimal"],
  ])("blocks %s without repairing the source", (_, column, value, code) => {
    const t = table(), original = structuredClone(t); t.rows[0][Number(column)] = String(value);
    const before = structuredClone(t);
    expect(checkImport(profile(), t).findings.some((f) => f.code === code)).toBe(true);
    expect(t).toEqual(before);
    expect(original.rows[1]).toEqual(t.rows[1]);
  });
  it("distinguishes the sample+test key and reports unexpected records", () => {
    const t = table(); t.rows[2][0] = "0003";
    const result = checkImport(profile(), t, plan());
    expect(result.findings.map((f) => f.code)).toEqual(["missing_key", "unexpected_key"]);
  });
  it("rejects ambiguous or duplicate plans instead of claiming completeness", () => {
    const p = plan(); p.rows.push(p.rows[0]);
    expect(checkImport(profile(), table(), p).coverageChecked).toBe(false);
    expect(checkImport(profile(), table(), { columns: ["Sample"], rows: [["0001"]] }).findings[0].code).toBe("plan_schema");
  });
  it("never converts long or tiny decimals through a floating point number", () => {
    const t = table(); t.rows[0][2] = "12345678901234567890,00000000000001";
    expect(checkImport(profile(), t).output!.rows[0][2]).toBe("12345678901234567890.00000000000001");
  });
  it("quotes round-trip fields and handles BOM, tabs, CRLF and escaped quotes", () => {
    const t = parseImportCsv('\uFEFFa\tb\r\n"x\ty"\t"a""b"\r\n');
    expect(t.rows).toEqual([["x\ty", 'a"b']]);
    expect(parseImportCsv(writeImportCsv(t, "\t"))).toEqual(t);
    expect(parseImportCsv('a,b\n"multi\nline",end\n').rows).toEqual([["multi\nline", "end"]]);
  });
  it.each(['a,b\n"unclosed,x', 'a,b\n"closed"junk,x', 'a,b\na"b,x', 'a,a\nx,y'])
    ("rejects malformed CSV %s", (text) => expect(() => parseImportCsv(text)).toThrow());
  it("requires an explicit delimiter when detection ties", () => {
    expect(() => parseImportCsv("a,b;c\nx,y;z")).toThrow("Ambiguous");
    expect(parseImportCsv("a,b;c\nx,y;z", ";").columns).toEqual(["a,b", "c"]);
  });
  it("enforces byte, column, cell and row boundaries", () => {
    expect(() => decodeImport(new Uint8Array(2 * 1024 * 1024 + 1))).toThrow();
    expect(() => parseImportCsv(Array.from({ length: 33 }, (_, i) => `c${i}`).join(","))).toThrow();
    expect(() => parseImportCsv("a\n" + "x".repeat(257))).toThrow();
    expect(() => parseImportCsv("a\n" + "x\n".repeat(10001))).toThrow();
    expect(() => decodeImport(new Uint8Array([0xff, 0xfe]))).toThrow("UTF-8");
  });
  it("validates profiles and returns no references to imported configuration", () => {
    const p = profile(), read = readImportProfile(p); read.columns[0].target = "changed";
    expect(p.columns[0].target).toBe("sample_id");
    expect(() => readImportProfile({ ...p, columns: p.columns.map((c) => ({ ...c, key: false })) })).toThrow("record key");
    expect(() => readImportProfile({ ...p, columns: [{ ...p.columns[0], target: "=bad" }] })).toThrow();
    expect(() => readImportProfile({ ...p, columns: [{ ...p.columns[2], key: true }] })).toThrow();
  });
});
