import { describe, expect, it, vi } from "vitest";
import { readExcelSelection, selectionToTable, type ExcelSelectionBridge } from "./excel-import.ts";

describe("Excel selection adapter (mock host; not an Office host qualification)", () => {
  it("reads only formatted selected cells and preserves leading zeros", async () => {
    const getSelectedDataAsync = vi.fn((_coercion, _options, callback) => callback({ status: "succeeded", value: [["sample", "value"], ["0001", "7,20"]] }));
    const office: ExcelSelectionBridge = { onReady: async () => ({ host: "Excel" }), context: { document: { getSelectedDataAsync } } };
    expect((await readExcelSelection(office)).rows).toEqual([["0001", "7,20"]]);
    expect(getSelectedDataAsync).toHaveBeenCalledWith("matrix", { valueFormat: "formatted" }, expect.any(Function));
  });
  it("refuses to reconstruct numeric IDs or infer headers", () => {
    expect(() => selectionToTable([["sample"], [1234567890123456]])).toThrow("formatted text");
    expect(() => selectionToTable([["a", "a"], ["x", "y"]])).toThrow("unique header");
    expect(() => selectionToTable([["a", "b"], ["x"]])).toThrow("rectangular");
  });
  it("fails clearly outside Excel and on host refusal", async () => {
    await expect(readExcelSelection(undefined)).rejects.toThrow("inside Excel");
    const office: ExcelSelectionBridge = { onReady: async () => ({ host: "Excel" }), context: { document: {
      getSelectedDataAsync: (_type, _options, cb) => cb({ status: "failed", error: { message: "Access denied" } }),
    } } };
    await expect(readExcelSelection(office)).rejects.toThrow("Access denied");
  });
});
