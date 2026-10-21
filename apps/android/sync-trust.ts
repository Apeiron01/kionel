import { resolve } from "node:path";
import {
  assertAndroidTrustMaterialFresh, readAndroidRootPolicy, readAndroidTrustMaterial, syncAndroidTrustMaterial,
} from "@kionel/attestation-android/trust-material";

const argument = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

const outputPath = resolve(argument("out") ?? "artifacts/android-trust-material.json");
const policyPath = resolve(argument("policy") ?? "config/android-google-roots.json");
const verifyOnly = process.argv.includes("--verify-only");
const rootPolicy = await readAndroidRootPolicy(policyPath);
const loaded = verifyOnly
  ? await readAndroidTrustMaterial(outputPath, rootPolicy)
  : await syncAndroidTrustMaterial({ outputPath, rootPolicy });
assertAndroidTrustMaterialFresh(loaded);

console.log(JSON.stringify({
  operation: verifyOnly ? "verified" : "synchronized",
  outputPath,
  sequence: loaded.material.sequence,
  fetchedAt: loaded.material.fetchedAt,
  nextUpdate: loaded.material.nextUpdate,
  roots: loaded.material.rootFingerprints,
  blockedSerials: loaded.revocationStatus.blockedSerials.size,
  digest: loaded.material.digest,
}, null, 2));
