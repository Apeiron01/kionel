/** Kurulu production ağacından deterministik CycloneDX 1.6 JSON SBOM üretir. */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

interface ListedDependency {
  version?: string;
  path?: string;
  resolved?: string;
  dependencies?: Record<string, ListedDependency>;
}
interface ListedProject extends ListedDependency { name: string; private?: boolean }
interface Component {
  type: "application" | "library";
  "bom-ref": string;
  group?: string;
  name: string;
  version: string;
  purl?: string;
  licenses?: { license: { id?: string; name?: string } }[];
  externalReferences?: { type: "distribution"; url: string }[];
}

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const output = resolve(argument("out") ?? "artifacts/kionel.cdx.json");
const root = resolve(process.cwd());
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const projects = JSON.parse(execFileSync(pnpm, ["-r", "list", "--prod", "--json", "--depth", "Infinity"], {
  cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, shell: process.platform === "win32",
})) as ListedProject[];
const components = new Map<string, Component>();
const edges = new Map<string, Set<string>>();

for (const project of projects) {
  const version = packageVersion(project.path) ?? project.version ?? "0.0.0";
  const ref = refOf(project.name, version);
  addComponent(project.name, version, project.path, project.resolved, project.private ? "application" : "library");
  visit(project.dependencies, ref);
}

function visit(dependencies: Record<string, ListedDependency> | undefined, parent: string): void {
  if (!dependencies) return;
  for (const [name, dependency] of Object.entries(dependencies)) {
    const version = packageVersion(dependency.path) ?? normalizedVersion(dependency.version);
    const ref = refOf(name, version);
    addComponent(name, version, dependency.path, dependency.resolved, "library");
    const children = edges.get(parent) ?? new Set<string>();
    children.add(ref);
    edges.set(parent, children);
    visit(dependency.dependencies, ref);
  }
}

function addComponent(name: string, version: string, path: string | undefined, resolved: string | undefined, type: Component["type"]): void {
  const ref = refOf(name, version);
  if (components.has(ref)) return;
  const manifest = readManifest(path);
  const scoped = name.startsWith("@") ? name.slice(1).split("/") : undefined;
  const license = typeof manifest?.license === "string" ? manifest.license : undefined;
  components.set(ref, {
    type, "bom-ref": ref, ...(scoped ? { group: scoped[0] } : {}), name: scoped?.[1] ?? name, version,
    ...(name.startsWith("@kionel/") ? {} : { purl: `pkg:npm/${encodeURIComponent(name)}@${version}` }),
    ...(license ? { licenses: [{ license: /^[A-Za-z0-9-.+]+$/.test(license) ? { id: license } : { name: license } }] } : {}),
    ...(resolved?.startsWith("https://") ? { externalReferences: [{ type: "distribution", url: resolved }] } : {}),
  });
}

const sortedComponents = [...components.values()].sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
const dependencyGraph = sortedComponents.map((component) => ({
  ref: component["bom-ref"], dependsOn: [...(edges.get(component["bom-ref"]) ?? [])].sort(),
}));
const lockHash = createHash("sha256").update(readFileSync(join(root, "pnpm-lock.yaml"))).digest("hex");
const serial = `${lockHash.slice(0, 8)}-${lockHash.slice(8, 12)}-4${lockHash.slice(13, 16)}-a${lockHash.slice(17, 20)}-${lockHash.slice(20, 32)}`;
const bom = {
  $schema: "https://cyclonedx.org/schema/bom-1.6.schema.json",
  bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: `urn:uuid:${serial}`, version: 1,
  metadata: { tools: { components: [{ type: "application", name: "kionel-sbom-generator", version: "1" }] },
    component: { type: "application", "bom-ref": "pkg:generic/kionel@0.1.0", name: "kionel", version: "0.1.0" } },
  components: sortedComponents, dependencies: dependencyGraph,
};
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(bom, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
console.log(`${output}: ${sortedComponents.length} bileşen`);

function normalizedVersion(version?: string): string { return version?.startsWith("link:") ? "0.1.0" : version ?? "0.0.0" }
function refOf(name: string, version: string): string { return `pkg:${name.startsWith("@kionel/") ? "generic" : "npm"}/${name}@${version}` }
function packageVersion(path?: string): string | undefined {
  const manifest = readManifest(path);
  return typeof manifest?.version === "string" ? manifest.version : undefined;
}
function readManifest(path?: string): Record<string, unknown> | undefined {
  if (!path) return undefined;
  try { return JSON.parse(readFileSync(join(path, "package.json"), "utf8")) as Record<string, unknown> } catch { return undefined }
}
