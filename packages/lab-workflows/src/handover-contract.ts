// SPDX-License-Identifier: AGPL-3.0-only
/** Experimental pre-delivery check. Does not deliver, import, approve or sign data. */
export type HandoverField =
  | { name: string; kind: "id"; width?: number }
  | { name: string; kind: "decimal"; separator: "." | "," }
  | { name: string; kind: "choice"; values: readonly string[] };

export interface HandoverContract {
  id: string;
  revision: number;
  fields: readonly HandoverField[];
  /** A sample may legitimately occur for several tests or replicates. */
  keyFields: readonly string[];
}

export interface HandoverPlan {
  runId: string;
  contractId: string;
  contractRevision: number;
  /** Values in keyFields order; this supplied plan is the coverage boundary. */
  expectedKeys: readonly (readonly string[])[];
}

export interface HandoverDataset {
  runId: string;
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface HandoverFinding {
  code: "run_mismatch" | "schema_changed" | "row_shape" | "invalid_cell" |
    "missing_key" | "unexpected_key" | "duplicate_key";
  /** Header is row 1. */
  row?: number;
  column?: string;
  key?: readonly string[];
}

export interface HandoverAssessment {
  schema: "kionel-handover-assessment/v1";
  runId: string;
  contractId: string;
  contractRevision: number;
  state: "blocked" | "ready-for-delivery";
  coverageChecked: boolean;
  expectedRows: number;
  observedRows: number;
  findings: HandoverFinding[];
}

const MAX_ROWS = 10_000;
const MAX_FIELDS = 32;
const MAX_CELL = 256;
const clean = (value: unknown): value is string => typeof value === "string" &&
  value.length > 0 && value.length <= MAX_CELL && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const keyOf = (values: readonly string[]) => JSON.stringify(values);

function validCell(field: HandoverField, value: unknown): value is string {
  if (!clean(value)) return false;
  if (field.kind === "id") return field.width === undefined || value.length === field.width;
  if (field.kind === "choice") return field.values.includes(value);
  return field.separator === "." ? /^[+-]?\d+(?:\.\d+)?$/.test(value) : /^[+-]?\d+(?:,\d+)?$/.test(value);
}

function checkedPlan(contract: HandoverContract, plan: HandoverPlan): Map<string, readonly string[]> {
  if (!clean(contract.id) || !Number.isSafeInteger(contract.revision) || contract.revision < 1 ||
    !Array.isArray(contract.fields) || !contract.fields.length || contract.fields.length > MAX_FIELDS) {
    throw new Error("Invalid handover contract.");
  }
  const names = new Set<string>();
  for (const field of contract.fields) {
    if (!field || !clean(field.name) || names.has(field.name)) throw new Error("Contract fields must be unique.");
    names.add(field.name);
    if (field.kind === "id") {
      if (field.width !== undefined && (!Number.isSafeInteger(field.width) || field.width < 1 || field.width > MAX_CELL)) {
        throw new Error("Invalid identifier width.");
      }
    } else if (field.kind === "decimal") {
      if (![".", ","].includes(field.separator)) throw new Error("Invalid decimal separator.");
    } else if (field.kind === "choice") {
      if (!Array.isArray(field.values) || !field.values.length || field.values.length > MAX_ROWS ||
        !Array.from(field.values).every(clean) || new Set(field.values).size !== field.values.length) throw new Error("Invalid choices.");
    } else throw new Error("Unsupported field type.");
  }
  if (!Array.isArray(contract.keyFields) || !contract.keyFields.length || contract.keyFields.length > MAX_FIELDS ||
    new Set(contract.keyFields).size !== contract.keyFields.length || Array.from(contract.keyFields).some((key) => !names.has(key))) {
    throw new Error("Invalid key fields.");
  }
  if (!clean(plan.runId) || plan.contractId !== contract.id || plan.contractRevision !== contract.revision ||
    !Array.isArray(plan.expectedKeys) || !plan.expectedKeys.length || plan.expectedKeys.length > MAX_ROWS) {
    throw new Error("Plan must name this contract revision and contain expected keys.");
  }
  const keyRules = contract.keyFields.map((name) => contract.fields.find((field) => field.name === name)!);
  const expected = new Map<string, readonly string[]>();
  for (const values of plan.expectedKeys) {
    if (!Array.isArray(values) || values.length !== keyRules.length ||
      !Array.from(values).every((value, i) => validCell(keyRules[i], value))) throw new Error("Invalid planned key.");
    const key = keyOf(values);
    if (expected.has(key)) throw new Error("Duplicate planned key.");
    expected.set(key, values);
  }
  return expected;
}

/**
 * Strict, transport-independent comparison. No trimming, numeric conversion,
 * unit conversion or repairs. The caller owns parsing and plan authorization.
 * A passing result means only that this dataset satisfies the supplied plan.
 */
export function assessHandover(
  contract: HandoverContract, plan: HandoverPlan, data: HandoverDataset,
): HandoverAssessment {
  const expected = checkedPlan(contract, plan);
  if (!Array.isArray(data.columns) || data.columns.length > MAX_FIELDS || !Array.isArray(data.rows) || data.rows.length > MAX_ROWS) {
    throw new Error("Dataset exceeds prototype limits or is not tabular.");
  }
  const findings: HandoverFinding[] = [];
  let coverageChecked = false;
  const result = (): HandoverAssessment => ({
    schema: "kionel-handover-assessment/v1", runId: plan.runId,
    contractId: contract.id, contractRevision: contract.revision,
    state: findings.length || !coverageChecked ? "blocked" : "ready-for-delivery",
    coverageChecked, expectedRows: expected.size, observedRows: data.rows.length, findings,
  });
  if (data.runId !== plan.runId) findings.push({ code: "run_mismatch" });
  // A changed header is not silently remapped into the approved contract.
  if (data.columns.length !== contract.fields.length ||
    Array.from(data.columns).some((name, i) => name !== contract.fields[i].name)) findings.push({ code: "schema_changed" });
  if (findings.length) return result();

  const keyColumns = contract.keyFields.map((name) => data.columns.indexOf(name));
  const observed = new Map<string, { values: readonly string[]; count: number }>();
  data.rows.forEach((row, index) => {
    if (!Array.isArray(row) || row.length !== contract.fields.length) {
      findings.push({ code: "row_shape", row: index + 2 });
      return;
    }
    contract.fields.forEach((field, i) => {
      if (!validCell(field, row[i])) findings.push({ code: "invalid_cell", row: index + 2, column: data.columns[i] });
    });
    const values = keyColumns.map((column) => row[column]);
    if (!values.every(clean)) return;
    const key = keyOf(values);
    const entry = observed.get(key);
    if (entry) entry.count++;
    else observed.set(key, { values, count: 1 });
  });
  coverageChecked = true;
  for (const [key, values] of expected) if (!observed.has(key)) findings.push({ code: "missing_key", key: values });
  for (const [key, entry] of observed) {
    if (!expected.has(key)) findings.push({ code: "unexpected_key", key: entry.values });
    if (entry.count > 1) findings.push({ code: "duplicate_key", key: entry.values });
  }
  return result();
}
