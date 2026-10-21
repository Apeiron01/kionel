import { describe, expect, it } from "vitest";
import { assessHandover, type HandoverContract, type HandoverDataset, type HandoverPlan } from "./handover-contract.ts";

const contract: HandoverContract = {
  id: "water-results", revision: 1,
  fields: [
    { name: "sample_id", kind: "id", width: 5 },
    { name: "test", kind: "choice", values: ["nitrate", "nitrite"] },
    { name: "value", kind: "decimal", separator: "." },
    { name: "unit", kind: "choice", values: ["mg/L"] },
  ], keyFields: ["sample_id", "test"],
};
const plan: HandoverPlan = {
  runId: "DEMO-001", contractId: contract.id, contractRevision: 1,
  expectedKeys: [["00123", "nitrate"], ["00123", "nitrite"], ["00124", "nitrate"]],
};
const dataset = (): HandoverDataset => ({
  runId: plan.runId, columns: ["sample_id", "test", "value", "unit"],
  rows: [["00123", "nitrate", "1.25", "mg/L"], ["00123", "nitrite", "0.02", "mg/L"], ["00124", "nitrate", "2.50", "mg/L"]],
});
const codes = (data: HandoverDataset) => assessHandover(contract, plan, data).findings.map((f) => f.code);

describe("experimental handover contract", () => {
  it("accepts complete reordered rows, including two tests for one sample, without claiming delivery", () => {
    const data = dataset();
    data.rows = [...data.rows].reverse();
    const before = JSON.stringify({ contract, plan, data });
    expect(assessHandover(contract, plan, data)).toMatchObject({ state: "ready-for-delivery", coverageChecked: true, expectedRows: 3, observedRows: 3, findings: [] });
    expect(JSON.stringify({ contract, plan, data })).toBe(before);
  });

  it("does not mistake equal row counts for complete delivery", () => {
    const data = dataset();
    data.rows = [data.rows[0], data.rows[0], data.rows[2]];
    expect(codes(data)).toEqual(expect.arrayContaining(["missing_key", "duplicate_key"]));
    expect(assessHandover(contract, plan, data).state).toBe("blocked");
  });

  it("preserves leading zeros rather than repairing sample IDs", () => {
    const data = dataset();
    data.rows = [["123", "nitrate", "1.25", "mg/L"], ...data.rows.slice(1)];
    expect(codes(data)).toEqual(expect.arrayContaining(["invalid_cell", "missing_key", "unexpected_key"]));
  });

  it.each(["1,25", "1.234,56", "1,234.56", "1.25E2", "NaN", "Infinity", " 1.25", "1.25 "])("blocks unapproved decimal notation %s", (value) => {
    const data = dataset();
    data.rows = [["00123", "nitrate", value, "mg/L"], ...data.rows.slice(1)];
    expect(assessHandover(contract, plan, data).findings).toContainEqual({ code: "invalid_cell", row: 2, column: "value" });
  });

  it("allows comma decimals only under an explicitly matching contract", () => {
    const comma: HandoverContract = { ...contract, revision: 2, fields: contract.fields.map((f) => f.kind === "decimal" ? { ...f, separator: "," } : f) };
    const data = dataset();
    data.rows = data.rows.map((row) => row.map((value, i) => i === 2 ? value.replace(".", ",") : value));
    expect(assessHandover(comma, { ...plan, contractRevision: 2 }, data).state).toBe("ready-for-delivery");
  });

  it("blocks a wrong unit without converting it automatically", () => {
    const data = dataset();
    data.rows = [["00123", "nitrate", "1.25", "ug/L"], ...data.rows.slice(1)];
    expect(assessHandover(contract, plan, data).findings).toContainEqual({ code: "invalid_cell", row: 2, column: "unit" });
  });

  it.each([
    ["sample_id", "test", "value", "unit", "new_column"],
    ["sample_id", "test", "value", "value"],
    ["sample_id", "value", "test", "unit"],
  ])("blocks schema drift without claiming coverage was checked: %j", (...columns) => {
    expect(assessHandover(contract, plan, { ...dataset(), columns })).toMatchObject({ state: "blocked", coverageChecked: false, findings: [{ code: "schema_changed" }] });
  });

  it("blocks files belonging to another run even if all keys match", () => {
    expect(assessHandover(contract, plan, { ...dataset(), runId: "OTHER" })).toMatchObject({ state: "blocked", coverageChecked: false, findings: [{ code: "run_mismatch" }] });
  });

  it("detects zero received rows and a short row", () => {
    expect(codes({ ...dataset(), rows: [] })).toEqual(["missing_key", "missing_key", "missing_key"]);
    expect(codes({ ...dataset(), rows: [["00123"]] })).toContain("row_shape");
  });

  it("rejects a stale contract revision and duplicate plan keys", () => {
    expect(() => assessHandover(contract, { ...plan, contractRevision: 2 }, dataset())).toThrow();
    expect(() => assessHandover(contract, { ...plan, expectedKeys: [plan.expectedKeys[0], plan.expectedKeys[0]] }, dataset())).toThrow("Duplicate planned key");
  });

  it("rejects ambiguous contract keys and oversized datasets", () => {
    expect(() => assessHandover({ ...contract, keyFields: ["sample_id", "sample_id"] }, plan, dataset())).toThrow();
    expect(() => assessHandover(contract, plan, { ...dataset(), rows: Array(10_001).fill([]) })).toThrow();
  });

  it("does not accept sparse headers, missing cells or sparse planned keys", () => {
    const columns = ["sample_id", "test", "value", "unit"];
    delete columns[2];
    expect(codes({ ...dataset(), columns })).toContain("schema_changed");
    const row = ["00123", "nitrate", "1.25", "mg/L"];
    delete row[2];
    expect(codes({ ...dataset(), rows: [row, ...dataset().rows.slice(1)] })).toContain("invalid_cell");
    const planned = ["00123", "nitrate"];
    delete planned[1];
    expect(() => assessHandover(contract, { ...plan, expectedKeys: [planned] }, dataset())).toThrow("Invalid planned key");
  });
});
