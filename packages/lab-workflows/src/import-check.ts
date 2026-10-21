// SPDX-License-Identifier: AGPL-3.0-only
/** Local, deterministic preparation of one tabular export. Never writes to a destination system. */
export const IMPORT_LIMITS = { bytes: 2 * 1024 * 1024, rows: 10_000, columns: 32, cell: 256, findings: 2_000 } as const;
export type Delimiter = "," | ";" | "\t";
export interface ImportTable { columns: string[]; rows: string[][] }
export interface ImportColumn {
  source: string;
  target: string;
  kind: "text" | "id" | "decimal" | "choice";
  key: boolean;
  width?: number;
  separator?: "." | ",";
  values?: string[];
}
export interface ImportProfile {
  schema: "kionel-import-profile/v1";
  name: string;
  revision: number;
  sourceColumns: string[];
  columns: ImportColumn[];
  outputDelimiter: Delimiter;
  outputDecimal: "." | ",";
}
export interface ImportFinding { code: string; row?: number; column?: string; value?: string; key?: string[] }
export interface ImportCheck {
  schema: "kionel-import-check/v1";
  state: "passed" | "blocked";
  profileName: string;
  profileRevision: number;
  observedRows: number;
  coverageChecked: boolean;
  expectedRows: number | null;
  totalFindings: number;
  findings: ImportFinding[];
  output: ImportTable | null;
  targetAccepted: false;
  signed: false;
}

const clean = (s: unknown): s is string => typeof s === "string" && s.length > 0 &&
  s.length <= IMPORT_LIMITS.cell && s.trim() === s && !/[\u0000-\u001f\u007f]/.test(s);
const keyOf = (values: string[]) => JSON.stringify(values);
const formulaLike = (s: string) => /^[\s]*[=+@-]/.test(s);
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const delimiter = (v: unknown): v is Delimiter => v === "," || v === ";" || v === "\t";

/** No legacy-code-page guessing: an unknown encoding must be re-exported deliberately. */
export function decodeImport(bytes: Uint8Array): string {
  if (bytes.byteLength > IMPORT_LIMITS.bytes) throw new Error("Use a UTF-8 CSV of at most 2 MB.");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""); }
  catch { throw new Error("The file is not UTF-8. Export it as CSV UTF-8 first."); }
}

export function detectImportDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && delimiter(ch)) counts[ch]++;
  }
  const ranked = (Object.entries(counts) as [Delimiter, number][]).sort((a, b) => b[1] - a[1]);
  if (ranked[0][1] && ranked[0][1] === ranked[1][1]) throw new Error("Ambiguous separator. Choose comma, semicolon or tab explicitly.");
  return ranked[0][0];
}

/** Strict quoted fields, escaped quotes and CR/LF. Malformed quotes are never silently repaired. */
export function parseImportCsv(text: string, chosen?: Delimiter): ImportTable {
  if (new TextEncoder().encode(text).byteLength > IMPORT_LIMITS.bytes) throw new Error("CSV exceeds 2 MB.");
  text = text.replace(/^\uFEFF/, "");
  const sep = chosen ?? detectImportDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [], cell = "", state: "plain" | "quoted" | "closed" = "plain";
  const pushCell = () => {
    row.push(cell); cell = ""; state = "plain";
    if (row.length > IMPORT_LIMITS.columns) throw new Error("Use at most 32 columns.");
  };
  const pushRow = () => {
    pushCell(); rows.push(row); row = [];
    if (rows.length > IMPORT_LIMITS.rows + 1) throw new Error("Use at most 10,000 data rows.");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === "quoted") {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else state = "closed";
      } else cell += ch;
    } else if (ch === sep) pushCell();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else if (ch === '"' && cell === "" && state === "plain") state = "quoted";
    else if (state === "closed" || ch === '"') throw new Error("Malformed CSV: unexpected character or quote.");
    else cell += ch;
    if (cell.length > IMPORT_LIMITS.cell) throw new Error("A cell exceeds 256 characters.");
  }
  if (state === "quoted") throw new Error("Malformed CSV: a quoted field was not closed.");
  if (cell !== "" || row.length || state === "closed") pushRow();
  if (!rows.length || rows[0].some((s) => !clean(s)) || new Set(rows[0]).size !== rows[0].length) {
    throw new Error("CSV needs a non-empty, unique header row without surrounding spaces.");
  }
  return { columns: rows[0], rows: rows.slice(1) };
}

/** Return an owned, bounded copy. Imported JSON never supplies executable expressions. */
export function readImportProfile(value: unknown): ImportProfile {
  if (!record(value) || value.schema !== "kionel-import-profile/v1" || !clean(value.name) ||
    !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 ||
    !Array.isArray(value.sourceColumns) || !value.sourceColumns.length || value.sourceColumns.length > IMPORT_LIMITS.columns ||
    !value.sourceColumns.every(clean) || new Set(value.sourceColumns).size !== value.sourceColumns.length ||
    !Array.isArray(value.columns) || !value.columns.length || value.columns.length > IMPORT_LIMITS.columns ||
    !delimiter(value.outputDelimiter) || (value.outputDecimal !== "." && value.outputDecimal !== ",")) throw new Error("Invalid import profile.");
  const sourceColumns = value.sourceColumns as string[];
  const targets = new Set<string>(), sources = new Set<string>();
  const columns: ImportColumn[] = value.columns.map((c: unknown) => {
    if (!record(c) || !clean(c.source) || !sourceColumns.includes(c.source) || !clean(c.target) ||
      formulaLike(c.target) || targets.has(c.target) || sources.has(c.source) || typeof c.key !== "boolean" ||
      !["text", "id", "decimal", "choice"].includes(String(c.kind))) throw new Error("Profile columns need unique source and safe target names.");
    targets.add(c.target); sources.add(c.source);
    const col: ImportColumn = { source: c.source, target: c.target, kind: c.kind as ImportColumn["kind"], key: c.key };
    if (c.kind === "id" && c.width !== undefined) {
      if (!Number.isSafeInteger(c.width) || Number(c.width) < 1 || Number(c.width) > IMPORT_LIMITS.cell) throw new Error("Invalid identifier width.");
      col.width = Number(c.width);
    }
    if (c.kind === "decimal") {
      if (c.separator !== "." && c.separator !== ",") throw new Error("Choose the source decimal separator.");
      if (c.key) throw new Error("Use text or identifier fields for record keys, not decimal values.");
      col.separator = c.separator;
    }
    if (c.kind === "choice") {
      if (!Array.isArray(c.values) || !c.values.length || c.values.length > 100 || !c.values.every(clean) ||
        new Set(c.values).size !== c.values.length) throw new Error("Enter distinct allowed values separated by |.");
      col.values = [...c.values];
    }
    return col;
  });
  if (!columns.some((c) => c.key)) throw new Error("Select at least one identifier column as the record key.");
  return { schema: value.schema, name: value.name, revision: Number(value.revision), sourceColumns: [...value.sourceColumns],
    columns, outputDelimiter: value.outputDelimiter, outputDecimal: value.outputDecimal };
}

function cellIssue(col: ImportColumn, value: unknown): string | undefined {
  if (!clean(value)) return "invalid_cell";
  if (col.kind === "decimal") {
    return (col.separator === "," ? /^[+-]?\d+(?:,\d+)?$/ : /^[+-]?\d+(?:\.\d+)?$/).test(value) ? undefined : "invalid_decimal";
  }
  if (formulaLike(value)) return "formula_like";
  if (col.kind === "id" && col.width !== undefined && value.length !== col.width) return "identifier_width";
  if (col.kind === "choice" && !col.values!.includes(value)) return "invalid_choice";
  return undefined;
}

export function checkImport(profileValue: unknown, source: ImportTable, expected?: ImportTable): ImportCheck {
  const profile = readImportProfile(profileValue);
  const findings: ImportFinding[] = [];
  let totalFindings = 0, coverageChecked = false;
  const add = (f: ImportFinding) => { totalFindings++; if (findings.length < IMPORT_LIMITS.findings) findings.push(f); };
  const result = (output: ImportTable | null): ImportCheck => ({ schema: "kionel-import-check/v1",
    state: totalFindings ? "blocked" : "passed", profileName: profile.name, profileRevision: profile.revision,
    observedRows: source.rows.length, coverageChecked, expectedRows: expected?.rows.length ?? null,
    totalFindings, findings, output: totalFindings ? null : output, targetAccepted: false, signed: false });
  const checkSize = (t: ImportTable) => {
    if (!Array.isArray(t.columns) || t.columns.length > IMPORT_LIMITS.columns || !Array.isArray(t.rows) || t.rows.length > IMPORT_LIMITS.rows) {
      throw new Error("Table exceeds supported limits.");
    }
  };
  checkSize(source);
  if (source.columns.length !== profile.sourceColumns.length || source.columns.some((s, i) => s !== profile.sourceColumns[i])) {
    add({ code: "schema_changed" }); return result(null);
  }
  if (!source.rows.length) { add({ code: "empty_data" }); return result(null); }
  const indexes = profile.columns.map((c) => source.columns.indexOf(c.source));
  const keyColumns = profile.columns.map((c, i) => c.key ? i : -1).filter((i) => i >= 0);
  const observed = new Map<string, { key: string[]; count: number }>();
  const output: ImportTable = { columns: profile.columns.map((c) => c.target), rows: [] };
  source.rows.forEach((row, r) => {
    if (!Array.isArray(row) || row.length !== source.columns.length) { add({ code: "row_shape", row: r + 2 }); return; }
    const selected = indexes.map((i) => row[i]);
    profile.columns.forEach((col, i) => {
      const code = cellIssue(col, selected[i]);
      if (code) add({ code, row: r + 2, column: col.source, value: typeof selected[i] === "string" ? selected[i].slice(0,256) : "" });
    });
    const key = keyColumns.map((i) => selected[i]);
    if (key.every(clean)) {
      const id = keyOf(key), seen = observed.get(id);
      if (seen) { seen.count++; add({ code: "duplicate_key", row: r + 2, key }); }
      else observed.set(id, { key, count: 1 });
    }
    output.rows.push(selected.map((v, i) => typeof v !== "string" ? "" : profile.columns[i].kind === "decimal" &&
      profile.columns[i].separator !== profile.outputDecimal ? v.replace(profile.columns[i].separator!, profile.outputDecimal) : v));
  });
  if (expected) {
    checkSize(expected);
    const keys = keyColumns.map((i) => profile.columns[i]);
    if (expected.columns.length !== keys.length || expected.columns.some((s, i) => s !== keys[i].target)) {
      add({ code: "plan_schema" }); return result(null);
    }
    const planned = new Map<string, string[]>();
    let planValid = expected.rows.length > 0;
    expected.rows.forEach((row, r) => {
      if (!Array.isArray(row) || row.length !== keys.length || row.some((v, i) => cellIssue(keys[i], v))) {
        planValid = false; add({ code: "invalid_plan", row: r + 2 }); return;
      }
      const id = keyOf(row);
      if (planned.has(id)) { planValid = false; add({ code: "duplicate_plan", row: r + 2, key: row }); }
      else planned.set(id, row);
    });
    if (!expected.rows.length) add({ code: "invalid_plan" });
    if (!planValid) return result(null);
    coverageChecked = true;
    for (const [id, key] of planned) if (!observed.has(id)) add({ code: "missing_key", key });
    for (const [id, { key }] of observed) if (!planned.has(id)) add({ code: "unexpected_key", key });
  }
  return result(output);
}

export function writeImportCsv(table: ImportTable, sep: Delimiter): string {
  const escape = (s: string) => /["\r\n]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  return [table.columns, ...table.rows].map((row) => row.map(escape).join(sep)).join("\r\n") + "\r\n";
}

export const IMPORT_EXAMPLE = {
  source: "Sample;Test;Value;Unit\r\n0001;PH;7,20;pH\r\n0001;FE;0,15;mg/L\r\n0002;FE;0,08;mg/L\r\n",
  broken: "Sample;Test;Value;Unit\r\n0001;PH;7,20;pH\r\n0001;FE;0,15;mg/L\r\n0001;FE;0,08;mg/L\r\n",
  plan: "sample_id,test_code\r\n0001,PH\r\n0001,FE\r\n0002,FE\r\n",
  profile: { schema: "kionel-import-profile/v1", name: "Example result import", revision: 1,
    sourceColumns: ["Sample", "Test", "Value", "Unit"], outputDelimiter: ",", outputDecimal: ".",
    columns: [
      { source: "Sample", target: "sample_id", kind: "id", width: 4, key: true },
      { source: "Test", target: "test_code", kind: "text", key: true },
      { source: "Value", target: "result", kind: "decimal", separator: ",", key: false },
      { source: "Unit", target: "unit", kind: "choice", values: ["pH", "mg/L"], key: false },
    ] } satisfies ImportProfile,
};
