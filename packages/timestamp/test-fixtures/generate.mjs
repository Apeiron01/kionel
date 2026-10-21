/**
 * Builds a real RFC 3161 TSA and stamps a fixed imprint.
 *
 *   node packages/timestamp/test-fixtures/generate.mjs
 *
 * Requires openssl. A hand-rolled token would only prove our writer agrees with
 * our reader; openssl's `ts` is an independent implementation, so a token it
 * produces is the only fixture worth testing a verifier against.
 *
 * Validity is pinned, not relative to the generation date — see the Android
 * fixtures for why that matters.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const openssl = (...args) => execFileSync("openssl", args, { cwd: DIR, stdio: ["ignore", "pipe", "pipe"] });

const ROOT_FROM = "190101000000Z", ROOT_TO = "450101000000Z";
const TSA_FROM = "200101000000Z", TSA_TO = "400101000000Z";
const POLICY = "1.3.6.1.4.1.99999.1.1";

mkdirSync(join(DIR, ".ca"), { recursive: true });
writeFileSync(join(DIR, "index.txt"), "");
writeFileSync(join(DIR, "index.txt.attr"), "unique_subject = no\n");
writeFileSync(join(DIR, "serial"), "01\n");

const cnf = join(DIR, "tsa.cnf");
writeFileSync(cnf, [
  "[ca]", "default_ca = CA_default", "",
  "[CA_default]",
  `dir = ${DIR.replaceAll("\\", "/")}`,
  "database = $dir/index.txt",
  "new_certs_dir = $dir/.ca",
  "serial = $dir/serial",
  "default_md = sha256",
  "policy = policy_any",
  "email_in_dn = no",
  "rand_serial = no",
  "unique_subject = no",
  "preserve = no", "",
  "[policy_any]", "commonName = supplied", "",
  "[v3_ca]", "basicConstraints = critical,CA:TRUE", "keyUsage = critical,keyCertSign,cRLSign", "",
  // extendedKeyUsage timeStamping MUST be critical and alone (RFC 3161 §2.3).
  "[v3_tsa]",
  "basicConstraints = critical,CA:FALSE",
  "keyUsage = critical,digitalSignature,nonRepudiation",
  "extendedKeyUsage = critical,timeStamping",
  "subjectKeyIdentifier = hash", "",
  "[tsa]", "default_tsa = tsa_config", "",
  "[tsa_config]",
  `dir = ${DIR.replaceAll("\\", "/")}`,
  "serial = $dir/tsa-serial",
  "signer_cert = $dir/tsa.crt",
  "signer_key = $dir/tsa.key",
  "signer_digest = sha256",
  `default_policy = ${POLICY}`,
  "digests = sha256, sha512",
  "accuracy = secs:1, millisecs:500",
  "clock_precision_digits = 0",
  "ordering = yes",
  "tsa_name = yes",
  "ess_cert_id_chain = no",
  "ess_cert_id_alg = sha256", "",
].join("\n"));

const key = (name) => openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${name}.key`);
const csr = (name, cn) => openssl("req", "-new", "-key", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${cn}`, "-sha256");

key("root");
key("tsa");
key("rogue-root");

csr("root", "Kionel Test Timestamp Root");
openssl("ca", "-config", cnf, "-batch", "-notext", "-selfsign", "-keyfile", "root.key",
  "-in", "root.csr", "-out", "root.crt", "-startdate", ROOT_FROM, "-enddate", ROOT_TO,
  "-extfile", cnf, "-extensions", "v3_ca");

csr("rogue-root", "Kionel Rogue Timestamp Root");
openssl("ca", "-config", cnf, "-batch", "-notext", "-selfsign", "-keyfile", "rogue-root.key",
  "-in", "rogue-root.csr", "-out", "rogue-root.crt", "-startdate", ROOT_FROM, "-enddate", ROOT_TO,
  "-extfile", cnf, "-extensions", "v3_ca");

csr("tsa", "Kionel Test Timestamp Authority");
openssl("ca", "-config", cnf, "-batch", "-notext", "-cert", "root.crt", "-keyfile", "root.key",
  "-in", "tsa.csr", "-out", "tsa.crt", "-startdate", TSA_FROM, "-enddate", TSA_TO,
  "-extfile", cnf, "-extensions", "v3_tsa");

writeFileSync(join(DIR, "tsa-serial"), "01\n");

// The imprint the tests stamp: SHA-256("kionel-timestamp-fixture").
writeFileSync(join(DIR, "payload.bin"), "kionel-timestamp-fixture", "utf8");

openssl("ts", "-query", "-data", "payload.bin", "-sha256", "-cert", "-out", "request.tsq");
openssl("ts", "-reply", "-config", cnf, "-section", "tsa_config", "-queryfile", "request.tsq", "-out", "response.tsr");
openssl("ts", "-reply", "-in", "response.tsr", "-token_out", "-out", "token.der");

for (const name of ["root.csr", "tsa.csr", "rogue-root.csr", "index.txt", "index.txt.attr",
                    "index.txt.old", "index.txt.attr.old", "serial", "serial.old", "tsa-serial",
                    "tsa-serial.old", "tsa.cnf"]) {
  rmSync(join(DIR, name), { force: true });
}
rmSync(join(DIR, ".ca"), { recursive: true, force: true });

console.log(`TSA fixture hazır (politika ${POLICY})`);
