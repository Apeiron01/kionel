import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  isQualificationEvidenceV2, verifyQualificationEvidence, verifyQualificationEvidenceV2,
  type QualificationEvidence, type QualificationEvidenceV2,
} from "@kionel/crypto";

export type AnyQualificationEvidence = QualificationEvidence | QualificationEvidenceV2;

export interface PhysicalDeviceRun {
  sender: string;
  receiver: string;
  browser: string;
  transport: string;
  attempts: number;
  successes: number;
  silentCorruptions: number;
  meanGoodputKBs: number;
}

export interface DeviceMatrixVerdict {
  status: "pass" | "fail" | "not-run";
  devices: number;
  pairs: number;
  reason: string;
}

export async function verifyDeviceMatrixDocument(value: unknown): Promise<{
  runs?: AnyQualificationEvidence[]; error?: string;
}> {
  if (!value || typeof value !== "object") return { error: "imzalı cihaz matrisi şeması geçersiz" };
  const document = value as { schema?: unknown; runs?: unknown };
  if (!["kionel-device-matrix/v1", "kionel-device-matrix/v2"].includes(String(document.schema)) || !Array.isArray(document.runs)) {
    return { error: "imzalı cihaz matrisi şeması geçersiz" };
  }
  for (const run of document.runs) {
    const isV2Document = document.schema === "kionel-device-matrix/v2";
    if (isV2Document !== isQualificationEvidenceV2(run)) {
      return { error: "cihaz matrisi şeması ile kanıt wire sürümü uyuşmuyor" };
    }
    const verdict = isV2Document
      ? await verifyQualificationEvidenceV2(run)
      : await verifyQualificationEvidence(run as QualificationEvidence);
    if (!verdict.ok) {
      const sender = run && typeof run === "object" && "sender" in run ? String(run.sender) : "bilinmeyen cihaz";
      return { error: `${sender}: ${verdict.reason}` };
    }
  }
  return { runs: document.runs as AnyQualificationEvidence[] };
}

export function evaluateDeviceMatrix(runs?: PhysicalDeviceRun[]): DeviceMatrixVerdict {
  if (!runs) return { status: "not-run", devices: 0, pairs: 0, reason: "fiziksel cihaz matrisi verilmedi" };
  if (!Array.isArray(runs) || runs.some((run) => !validRun(run))) {
    return { status: "fail", devices: 0, pairs: 0, reason: "cihaz matrisi şeması geçersiz" };
  }
  const devices = new Set<string>();
  const pairs = new Map<string, { attempts: number; successes: number; corruptions: number }>();
  for (const run of runs) {
    devices.add(run.sender);
    devices.add(run.receiver);
    const key = `${run.sender}\u0000${run.receiver}`;
    const total = pairs.get(key) ?? { attempts: 0, successes: 0, corruptions: 0 };
    total.attempts += run.attempts;
    total.successes += run.successes;
    total.corruptions += run.silentCorruptions;
    pairs.set(key, total);
  }
  if (devices.size < 5 || pairs.size < 5) {
    return { status: "fail", devices: devices.size, pairs: pairs.size, reason: "en az 5 cihaz ve 5 yönlü çift gerekli" };
  }
  for (const [pair, result] of pairs) {
    if (result.attempts < 1000) return { status: "fail", devices: devices.size, pairs: pairs.size, reason: `${pairName(pair)}: 1000 deneme tamamlanmadı` };
    if (result.corruptions !== 0) return { status: "fail", devices: devices.size, pairs: pairs.size, reason: `${pairName(pair)}: sessiz bozulma görüldü` };
    if (result.successes / result.attempts < 0.99) return { status: "fail", devices: devices.size, pairs: pairs.size, reason: `${pairName(pair)}: başarı %99 altında` };
  }
  return { status: "pass", devices: devices.size, pairs: pairs.size, reason: "fiziksel cihaz matrisi kabul kapılarını geçti" };
}

export function releaseManifest(root: string): Record<string, string> {
  const files = [
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.json", "vitest.config.ts",
    ".gitattributes", ".gitignore",
  ];
  // API ve güvenlik sözleşmeleri sürüm kanıtından yanlışlıkla dışarıda kalmasın.
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".md")) files.push(entry.name);
  }
  for (const directory of ["packages", "apps", "native", ".github"]) collect(join(root, directory), root, files);
  return Object.fromEntries(files.sort().map((file) => [file.replaceAll("\\", "/"), sha256(readFileSync(join(root, file)))]));
}

export function manifestDigest(manifest: Record<string, string>): string {
  return sha256(new TextEncoder().encode(JSON.stringify(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))));
}

function collect(directory: string, root: string, files: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["bin", "obj", "dist", "node_modules", ".vite"].includes(entry.name)) collect(path, root, files);
    } else if (/\.(ts|cs|csproj|json|html|css|ya?ml)$/.test(entry.name) || entry.name === "_headers") {
      files.push(relative(root, path));
    }
  }
}

function validRun(run: PhysicalDeviceRun): boolean {
  return typeof run?.sender === "string" && run.sender.length > 0 && run.sender.length <= 100 &&
    typeof run.receiver === "string" && run.receiver.length > 0 && run.receiver.length <= 100 &&
    typeof run.browser === "string" && typeof run.transport === "string" &&
    [run.attempts, run.successes, run.silentCorruptions].every(Number.isSafeInteger) &&
    run.attempts > 0 && run.successes >= 0 && run.successes <= run.attempts &&
    run.silentCorruptions >= 0 && Number.isFinite(run.meanGoodputKBs) && run.meanGoodputKBs >= 0;
}

function pairName(key: string): string { return key.replace("\u0000", " → "); }
function sha256(data: Uint8Array): string { return createHash("sha256").update(data).digest("hex"); }
