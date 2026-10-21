#!/usr/bin/env node
/**
 * Resmî protokol modellerini ProVerif ile çalıştırır ve sonuçları beklenenle
 * karşılaştırır.
 *
 * Her model bir ya da birkaç "varyant" olarak koşar: bir varyant, belirli
 * etiketli satırları (ör. `(*SAS*)`) çıkararak bir varsayımı kaldırır. Güvenli
 * varyantın "true" sonuçları kadar, varsayımı kaldırılmış varyantın "false"
 * sonuçları da beklenir — model saldırıyı bulamıyorsa yanlış şeyi ölçüyordur.
 *
 * ProVerif ayrı kurulur (https://bblanche.gitlabpages.inria.fr/proverif/);
 * yol PROVERIF ortam değişkeniyle verilir. CI'da yoksa betik açıkça söyler,
 * sessizce geçmez.
 *
 *   PROVERIF=/path/to/proverif pnpm prove
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const formal = join(dirname(fileURLToPath(import.meta.url)), "..", "formal");
const candidates = [process.env.PROVERIF, "proverif", "C:/tmp/proverif/proverif2.05/proverif.exe"].filter(Boolean);
const proverif = candidates.find((path) => spawnSync(path, ["-help"], { encoding: "utf8" }).status === 0);
if (!proverif) {
  console.error("ProVerif bulunamadı. Kurun ve PROVERIF=/yol/proverif ile çalıştırın.");
  process.exit(2);
}

// Her satır: model, çıkarılacak etiketler, sorguların sırasıyla beklenen sonucu.
const PLAN = [
  { model: "kionel-v1.pv", variant: "two-way, codes compared, identity keys leak afterwards", drop: [],
    expect: [true, true, true] },
  { model: "kionel-v1.pv", variant: "two-way, codes NOT compared (sanity: attack must be found)", drop: ["SAS"],
    expect: [false, false, true] },
  { model: "kionel-oneway-code.pv", variant: "one-way, typed one-time code", drop: [],
    expect: [true, false, true] },
  { model: "kionel-oneway-card.pv", variant: "one-way card, installed over a trusted route", drop: ["UNTRUSTED", "LEAK"],
    expect: [true, true] },
  { model: "kionel-oneway-card.pv", variant: "one-way card sent over the attacker's channel (sanity)", drop: ["TRUSTED", "LEAK"],
    expect: [false, true] },
  { model: "kionel-oneway-card.pv", variant: "one-way card, receiver's long-term key leaks later (no forward secrecy)", drop: ["UNTRUSTED"],
    expect: [false, true] },
];

const work = mkdtempSync(join(tmpdir(), "kionel-prove-"));
let failed = 0;
for (const [index, step] of PLAN.entries()) {
  const source = readFileSync(join(formal, step.model), "utf8")
    .split("\n").filter((line) => !step.drop.some((tag) => line.includes(`(*${tag}*)`))).join("\n");
  const file = join(work, `${index}-${step.model}`);
  writeFileSync(file, source);
  const run = spawnSync(proverif, [file], { encoding: "utf8", maxBuffer: 1 << 28 });
  // "(even event(...) is false.)" satırları ek açıklamadır; sayılmaz.
  const lines = run.stdout.split(/\r?\n/);
  const results = lines.map((line) => /^RESULT (?!\(even).* is (true|false)\.$/.exec(line)).filter(Boolean).map((m) => m[1] === "true");
  const ok = run.status === 0 && results.length === step.expect.length && results.every((r, i) => r === step.expect[i]);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${step.model}  ${step.variant}`);
  if (!ok) console.log(`      expected ${JSON.stringify(step.expect)}, got ${JSON.stringify(results)}${run.status ? ` (exit ${run.status})` : ""}`);
}
console.log(failed ? `\n${failed} of ${PLAN.length} checks failed.` : `\nAll ${PLAN.length} checks match the expected results.`);
process.exit(failed ? 1 : 0);

