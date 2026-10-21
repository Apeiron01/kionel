/** Web paketi, SBOM ve qualification raporunu tek deterministik sürüm özetine bağlar. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolve(process.cwd());
const output = resolve(argument("out") ?? "artifacts/release-manifest.json");
const targets = [
  "apps/web/dist",
  "artifacts/kionel.cdx.json",
  "artifacts/qualification.json",
  "config/android-google-roots.json",
];
const files: string[] = [];
for (const target of targets) collect(resolve(root, target), files);
const hashes = Object.fromEntries(files.sort().map((path) => [
  relative(root, path).replaceAll("\\", "/"), sha256(readFileSync(path)),
]));
const digest = sha256(new TextEncoder().encode(JSON.stringify(Object.entries(hashes))));
writeFileSync(output, JSON.stringify({ schema: "kionel-release/v1", digest, artifacts: hashes }, null, 2) + "\n", {
  encoding: "utf8", flag: "wx",
});
console.log(`${output}: ${files.length} dosya · ${digest}`);

function collect(path: string, files: string[]): void {
  const stat = statSync(path);
  if (stat.isFile()) { files.push(path); return }
  for (const entry of readdirSync(path)) collect(resolve(path, entry), files);
}
function sha256(data: Uint8Array): string { return createHash("sha256").update(data).digest("hex") }
