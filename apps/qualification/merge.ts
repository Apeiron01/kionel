/** Birden çok cihazın imzalı ölçüm dosyasını imzaları değiştirmeden birleştirir. */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyDeviceMatrixDocument, type AnyQualificationEvidence } from "./report.ts";

const outputArg = process.argv.find((value) => value.startsWith("--out="));
const output = resolve(outputArg?.slice(6) ?? "kionel-device-matrix.merged.json");
const inputs = process.argv.slice(2).filter((value) => !value.startsWith("--out=")).map((value) => resolve(value));
if (inputs.length < 1 || inputs.length > 100) throw new Error("1..100 imzalı matris dosyası gerekli");
const runs: AnyQualificationEvidence[] = [];
let wireVersion: 1 | 2 | undefined;
for (const input of inputs) {
  if (statSync(input).size > 10 * 1024 * 1024) throw new Error(`${input}: 10 MB sınırını aşıyor`);
  const checked = await verifyDeviceMatrixDocument(JSON.parse(readFileSync(input, "utf8")));
  if (checked.error || !checked.runs) throw new Error(`${input}: ${checked.error ?? "matris doğrulanamadı"}`);
  const inputVersion = checked.runs[0]?.v ?? 1;
  if (wireVersion !== undefined && wireVersion !== inputVersion) throw new Error("v1 ve v2 cihaz matrisleri aynı dosyada birleştirilemez");
  wireVersion = inputVersion;
  runs.push(...checked.runs);
}
writeFileSync(output, JSON.stringify({ schema: `kionel-device-matrix/v${wireVersion ?? 1}`, runs }, null, 2) + "\n", {
  encoding: "utf8", flag: "wx",
});
console.log(`${output}: ${runs.length} imzalı koşu birleştirildi`);
