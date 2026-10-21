/** Synthetic engineering spike: no real instruments, file transfer or target-system import. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createProtectedIdentity, verifyReceipt } from "@kionel/crypto";
import { issueDispatch, issueReceipt } from "@kionel/issue";
import { assessHandover, type HandoverContract, type HandoverDataset, type HandoverPlan } from "../../packages/lab-workflows/src/handover-contract.ts";

const contract: HandoverContract = {
  id: "demo-water-quality", revision: 1,
  fields: [
    { name: "sample_id", kind: "id", width: 5 },
    { name: "test", kind: "choice", values: ["nitrate", "nitrite"] },
    { name: "value", kind: "decimal", separator: "." },
    { name: "unit", kind: "choice", values: ["mg/L"] },
  ], keyFields: ["sample_id", "test"],
};
const plan: HandoverPlan = {
  runId: "DEMO-001", contractId: contract.id, contractRevision: 1,
  expectedKeys: [["00123", "nitrate"], ["00123", "nitrite"], ["00124", "nitrate"]],
};
const good: HandoverDataset = {
  runId: plan.runId, columns: ["sample_id", "test", "value", "unit"],
  rows: [["00123", "nitrate", "1.25", "mg/L"], ["00123", "nitrite", "0.02", "mg/L"], ["00124", "nitrate", "2.50", "mg/L"]],
};
const scenarios = [
  { name: "complete", data: good, expected: "ready-for-delivery" },
  { name: "same-count-but-missing", data: { ...good, rows: [good.rows[0], good.rows[0], good.rows[2]] }, expected: "blocked" },
  { name: "lost-leading-zeroes", data: { ...good, rows: [["123", "nitrate", "1.25", "mg/L"], ...good.rows.slice(1)] }, expected: "blocked" },
  { name: "wrong-decimal", data: { ...good, rows: [["00123", "nitrate", "1,25", "mg/L"], ...good.rows.slice(1)] }, expected: "blocked" },
  { name: "wrong-unit", data: { ...good, rows: [["00123", "nitrate", "1.25", "ug/L"], ...good.rows.slice(1)] }, expected: "blocked" },
  { name: "schema-changed", data: { ...good, columns: ["sample_id", "test", "new_value", "unit"] }, expected: "blocked" },
  { name: "wrong-run", data: { ...good, runId: "DEMO-OTHER" }, expected: "blocked" },
];
const source = await createProtectedIdentity();
const checker = await createProtectedIdentity();
const base = resolve("artifacts");
mkdirSync(base, { recursive: true });
const directory = mkdtempSync(join(base, "handover-concept-"));
const results = [];

for (const [index, scenario] of scenarios.entries()) {
  const assessment = assessHandover(contract, plan, scenario.data);
  if (assessment.state !== scenario.expected) throw new Error(`Unexpected decision: ${scenario.name}`);
  // Existing signatures bind the full synthetic plan, dataset and assessment.
  // The checker acknowledges this bundle, NOT a real instrument or LIMS import.
  const bundle = { schema: "kionel-handover-demo/v1", synthetic: true, contract, plan, data: scenario.data, assessment };
  const content = new TextEncoder().encode(JSON.stringify(bundle));
  const dispatch = await issueDispatch(source, { session: index + 1, content, context: { profile: "lab", reference: plan.runId } });
  const receipt = await issueReceipt(checker, { session: dispatch.session, content, sender: source.pub, dispatch });
  const verified = await verifyReceipt(receipt, content);
  if (!verified.ok || verified.signers.length !== 2) throw new Error("Demo bundle signatures failed verification.");
  const changed = new Uint8Array(content);
  changed[changed.length - 1] ^= 1;
  if ((await verifyReceipt(receipt, changed)).ok) throw new Error("Changed demo bundle was accepted.");
  writeFileSync(join(directory, `${scenario.name}.json`), JSON.stringify({ bundle, receipt }, null, 2));
  const row = { scenario: scenario.name, state: assessment.state, findings: assessment.findings.map((f) => f.code), bundleSignatures: "verified", changedBundle: "rejected" };
  results.push(row);
  console.log(`${row.scenario}: ${row.state}${row.findings.length ? ` (${row.findings.join(", ")})` : ""}`);
}
writeFileSync(join(directory, "summary.json"), JSON.stringify({ prototype: true, synthetic: true, results, limits: [
  "Checks only the supplied expected plan, not all data produced by an instrument.",
  "Table parsing, plan authorization, production identity, persistence and target-system import are not implemented here.",
  "Signatures acknowledge the demo bundle; they are not evidence of a real LIMS import.",
] }, null, 2));
console.log(`\nSynthetic demo evidence: ${directory}\nNo private keys were saved. No external systems were contacted.`);
