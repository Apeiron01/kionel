/** Kionel sentetik + fiziksel pilot qualification raporu. */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PROFILES, simulate, simulateDuplex } from "@kionel/core";
import { evaluateDeviceMatrix, manifestDigest, releaseManifest, verifyDeviceMatrixDocument, type PhysicalDeviceRun } from "./report.ts";

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=")[1];
const size = Number(argument("size") ?? 256 * 1024);
const trials = Number(argument("trials") ?? 25);
const output = argument("out");
const matrixFile = argument("device-matrix");
if (!Number.isSafeInteger(size) || size < 1024 || size > 64 * 1024 * 1024 ||
    !Number.isSafeInteger(trials) || trials < 1 || trials > 10_000) throw new Error("qualification parametreleri sınır dışında");

const payload = Uint8Array.from({ length: size }, (_, index) => (index * 131 + 17) & 0xff);
const profile = PROFILES["qr-v27-L-30"];
const scenarios = [
  { id: "simplex-20", duplex: false, loss: 0.2, corrupt: 0.01 },
  { id: "duplex-20", duplex: true, loss: 0.2, corrupt: 0.01 },
  { id: "duplex-30", duplex: true, loss: 0.3, corrupt: 0.02 },
];

const synthetic = scenarios.map((scenario) => {
  const runs = Array.from({ length: trials }, (_, index) => scenario.duplex
    ? simulateDuplex(payload, profile, { lossRate: scenario.loss, corruptRate: scenario.corrupt, ackLossRate: scenario.loss, seed: index + 1 })
    : simulate(payload, profile, { lossRate: scenario.loss, corruptRate: scenario.corrupt, seed: index + 1 }));
  const successRate = runs.filter((run) => run.ok).length / trials;
  const seconds = runs.map((run) => run.seconds).sort((a, b) => a - b);
  const silentCorruptions = runs.filter((run) => run.ok === false && run.goodputKBs > 0).length;
  return {
    id: scenario.id,
    trials,
    successRate,
    silentCorruptions,
    meanGoodputKBs: average(runs.map((run) => run.goodputKBs)),
    p99Seconds: seconds[Math.min(seconds.length - 1, Math.floor(seconds.length * 0.99))],
    pass: successRate >= 0.99 && silentCorruptions === 0,
  };
});

let matrix: PhysicalDeviceRun[] | undefined;
let evidenceFailure: string | undefined;
if (matrixFile) {
  if (statSync(matrixFile).size > 10 * 1024 * 1024) throw new Error("cihaz matrisi 10 MB sınırını aşıyor");
  const checked = await verifyDeviceMatrixDocument(JSON.parse(readFileSync(matrixFile, "utf8")));
  matrix = checked.runs;
  evidenceFailure = checked.error;
}
const physical = evidenceFailure
  ? { status: "fail" as const, devices: 0, pairs: 0, reason: evidenceFailure }
  : evaluateDeviceMatrix(matrix);
const root = resolve(process.cwd());
const artifacts = releaseManifest(root);
const report = {
  schema: "kionel-qualification/v1",
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, architecture: process.arch },
  parameters: { size, trials, profile: profile.id },
  synthetic,
  physical,
  artifactDigest: manifestDigest(artifacts),
  artifacts,
  syntheticQualified: synthetic.every((scenario) => scenario.pass),
  pilotQualified: synthetic.every((scenario) => scenario.pass) && physical.status === "pass",
};
const json = JSON.stringify(report, null, 2);
if (output) writeFileSync(output, json + "\n", { encoding: "utf8", flag: "wx" });
console.log(json);
process.exit(report.syntheticQualified && (!matrixFile || report.pilotQualified) ? 0 : 1);

function average(values: number[]): number { return values.reduce((sum, value) => sum + value, 0) / values.length; }
