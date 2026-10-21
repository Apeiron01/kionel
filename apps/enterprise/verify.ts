/** Offline enterprise trust bundle verifier. No network access is required. */
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import type { KeyReferenceV2 } from "@kionel/crypto";
import { verifyEnterpriseTrustBundle } from "@kionel/enterprise";

const argument = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const bundleFile = process.argv.slice(2).find((value) => !value.startsWith("--"));
const anchorFile = argument("anchor");
const tenantId = argument("tenant");
const minimumSequence = Number(argument("min-sequence") ?? "0");
const at = argument("at");

if (!bundleFile || !anchorFile || !tenantId || !Number.isSafeInteger(minimumSequence) || minimumSequence < 0) {
  console.error("kullanım: pnpm trust:verify <bundle.json> --anchor=<root-key.json> --tenant=<id> --min-sequence=<n> [--at=<ISO>]");
  process.exit(2);
}

try {
  const bundle = readJson(resolve(bundleFile));
  const anchor = readJson(resolve(anchorFile)) as KeyReferenceV2;
  const now = at ? new Date(at) : new Date();
  const verdict = await verifyEnterpriseTrustBundle(bundle, anchor, {
    expectedTenantId: tenantId,
    minimumSequence,
    now,
  });
  if (!verdict.ok) {
    console.error(`GEÇERSİZ — ${verdict.reason}`);
    process.exit(1);
  }
  const value = verdict.verified.bundle;
  console.log(`GEÇERLİ — ${verdict.reason}`);
  console.log(`  özet      ${verdict.verified.digest}`);
  console.log(`  tenant    ${value.tenantId}`);
  console.log(`  sequence  ${value.sequence}`);
  console.log(`  geçerlilik ${value.issuedAt} — ${value.expiresAt}`);
  console.log(`  cihaz     ${value.devices.length}`);
  console.log(`  iptal     ${value.revocations.length}`);
  console.log(`  politika  v${value.policy.version} · ${value.policy.allowedProfiles.join(",")}`);
} catch (error) {
  console.error(`GEÇERSİZ — ${(error as Error).message}`);
  process.exit(1);
}

function readJson(path: string): unknown {
  if (statSync(path).size > 20 * 1024 * 1024) throw new Error(`${path}: 20 MB doğrulayıcı sınırını aşıyor`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}
