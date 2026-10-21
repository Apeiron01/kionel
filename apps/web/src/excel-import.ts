import { IMPORT_LIMITS, parseImportCsv, writeImportCsv, type ImportTable } from "@kionel/lab-workflows/import-check";

/** Narrow Common API boundary; ReadDocument is sufficient. No workbook write API is used. */
export interface ExcelSelectionBridge {
  onReady(): Promise<{ host?: string }>;
  context: { document: { getSelectedDataAsync(
    coercion: string, options: { valueFormat: string },
    callback: (result: { status: string; value?: unknown; error?: { message?: string } }) => void,
  ): void } };
}

export function selectionToTable(value: unknown): ImportTable {
  if (!Array.isArray(value) || value.length < 2 || value.length > IMPORT_LIMITS.rows + 1) {
    throw new Error("Select one rectangular range containing a header and up to 10,000 data rows.");
  }
  let width = 0;
  const rows = value.map((row: unknown, index) => {
    if (!Array.isArray(row) || !row.length || row.length > IMPORT_LIMITS.columns) throw new Error("Select at most 32 columns.");
    if (index === 0) width = row.length;
    if (row.length !== width) throw new Error("The selected range must be rectangular.");
    return row.map((cell: unknown) => {
      // Formatted matrix values should be text. Never stringify a numeric ID after Excel rounded it.
      if (typeof cell !== "string") throw new Error("Excel did not return formatted text. Export the selection as CSV UTF-8 instead.");
      if (cell.length > IMPORT_LIMITS.cell) throw new Error("A selected cell exceeds 256 characters.");
      return cell;
    });
  });
  // Share the exact same bounded header/UTF-8/CSV path as a selected file.
  return parseImportCsv(writeImportCsv({ columns: rows[0], rows: rows.slice(1) }, ","), ",");
}

export async function readExcelSelection(office: ExcelSelectionBridge | undefined): Promise<ImportTable> {
  if (!office) throw new Error("Open the add-in inside Excel, or choose a CSV file in the browser version.");
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  const ready = await Promise.race([office.onReady(), new Promise<never>((_, reject) => {
    readyTimer = setTimeout(() => reject(new Error("Excel did not become ready. Reopen the add-in inside Excel.")), 8_000);
  })]).finally(() => clearTimeout(readyTimer));
  if (ready.host?.toLowerCase() !== "excel") throw new Error("This action needs the Excel add-in host.");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Excel selection could not be read. Try a smaller range.")), 8_000);
    try {
      office.context.document.getSelectedDataAsync("matrix", { valueFormat: "formatted" }, (result) => {
        clearTimeout(timeout);
        if (result.status !== "succeeded") { reject(new Error(result.error?.message || "Excel refused access to the selected range.")); return; }
        try { resolve(selectionToTable(result.value)); } catch (e) { reject(e); }
      });
    } catch (e) { clearTimeout(timeout); reject(e); }
  });
}
