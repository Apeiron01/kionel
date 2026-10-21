/** TypeScript hedefini bundle eder ve Jazzer.js/libFuzzer'ı süre sınırıyla çalıştırır. */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const seconds = Number(argument("seconds") ?? 60);
if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86_400) throw new Error("fuzz süresi 1..86400 saniye olmalı");
const root = resolve(process.cwd());
const work = resolve(root, "packages/conformance");
const seeds = resolve(work, "fuzz-seeds");
const corpus = resolve(root, "artifacts/fuzz-corpus");
const crashes = resolve(root, "artifacts/fuzz-crashes");
mkdirSync(resolve(work, "fuzz-dist"), { recursive: true });
mkdirSync(corpus, { recursive: true });
mkdirSync(crashes, { recursive: true });
for (const seed of readdirSync(seeds)) {
  const destination = resolve(corpus, seed);
  if (!existsSync(destination)) copyFileSync(resolve(seeds, seed), destination);
}
run(["exec", "esbuild", "fuzz/protocol.ts", "--bundle", "--platform=node", "--format=esm", "--sourcemap",
  "--outfile=fuzz-dist/subject.mjs"], work);
run(["exec", "jazzer", "fuzz/runner.mjs", "--sync", "-i", "subject.mjs", "--disableBugDetectors=.*",
  corpus.replaceAll("\\", "/"), "--",
  `-max_total_time=${seconds}`, "-max_len=1048576", `-artifact_prefix=${crashes.replaceAll("\\", "/")}/`], work);

function run(args: string[], cwd: string): void {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(pnpm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
}
