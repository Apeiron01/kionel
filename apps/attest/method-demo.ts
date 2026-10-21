/** Local demonstration with fictional actors and disposable software keys. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { b64, createIdentity, exportIdentity, type MethodPolicy } from "@kionel/crypto";
import { issueLicense } from "@kionel/licensing";

const base = resolve("artifacts");
mkdirSync(base, { recursive: true });
const dir = mkdtempSync(join(base, "method-demo-"));
const file = join(dir, "example-method.txt");
writeFileSync(file, "DEMO ONLY: method=EXAMPLE-01; target=DEMO-DEVICE; value=1\n");
const [publisher, reviewer, approver] = await Promise.all([createIdentity(), createIdentity(), createIdentity()]);
for (const [name, actor] of [["publisher", publisher], ["reviewer", reviewer], ["approver", approver]] as const) {
  writeFileSync(join(dir, `${name}.key.json`), JSON.stringify(await exportIdentity(actor)), { mode: 0o600, flag: "wx" });
}
const policy: MethodPolicy = {
  schema: "kionel-method-policy/v1", methodId: "EXAMPLE-01", target: "DEMO-DEVICE", minimumRevision: 1,
  publishers: [b64(publisher.pub)], reviewers: [b64(reviewer.pub)], approvers: [b64(approver.pub)],
};
// Demo kendi geçici lisans otoritesini kurar; gerçek otorite anahtarına dokunmaz.
const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as CryptoKeyPair;
const demoAuthority = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const authorityPath = join(dir, "demo-authority.json");
writeFileSync(authorityPath, JSON.stringify({ publicKey: b64(demoAuthority) }));
const licensePath = join(dir, "demo-license.json");
writeFileSync(licensePath, JSON.stringify(await issueLicense({ providerId: "demo", keyId: "demo", algorithm: "ecdsa-p256-sha256",
  publicKey: demoAuthority, securityLevel: "software-protected", persistence: "session", attestation: { status: "not-available" },
  sign: async (data) => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as BufferSource)),
}, { licensee: "DEMO", tier: "pilot", scope: { sites: 1, devices: 2, productLines: ["method"] },
  issuedAt: new Date(Date.now() - 60_000), validUntil: new Date(Date.now() + 3600_000) })));
const policyPath = join(dir, "policy.json");
writeFileSync(policyPath, JSON.stringify(policy, null, 2));
const run = (...args: string[]) => execFileSync(process.execPath, [
  "--experimental-strip-types", "--no-warnings", "apps/attest/method.ts", `--license=${licensePath}`, ...args,
], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, KIONEL_TEST_LICENSE_AUTHORITY: authorityPath } });
const pending = join(dir, "pending.json"), reviewed = join(dir, "reviewed.json"), released = join(dir, "released.json");
console.log(run("prepare", file, "--method=EXAMPLE-01", "--target=DEMO-DEVICE", "--revision=1",
  `--expires=${new Date(Date.now() + 86400_000).toISOString()}`, `--identity=${join(dir, "publisher.key.json")}`, `--out=${pending}`));
console.log(run("approve", file, `--release=${pending}`, `--identity=${join(dir, "reviewer.key.json")}`, `--out=${reviewed}`));
console.log(run("approve", file, `--release=${reviewed}`, `--identity=${join(dir, "approver.key.json")}`, `--out=${released}`));
console.log(run("check", file, `--release=${released}`, `--policy=${policyPath}`));
writeFileSync(file, "CHANGED FILE\n");
let rejected = false;
try { run("check", file, `--release=${released}`, `--policy=${policyPath}`); }
catch (error) {
  const result = error as { status?: number; stdout?: string };
  if (result.status !== 1) throw error;
  console.log(result.stdout);
  rejected = true;
}
if (!rejected) throw new Error("changed method was accepted");
console.log(`Demo tamamlandı: ${dir}\nBu klasördeki özel anahtarlar yalnızca kurmaca demo içindir. Dosya son adımda bilerek değiştirildi.`);
