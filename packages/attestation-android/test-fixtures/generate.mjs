/**
 * Regenerates the Android attestation test fixtures.
 *
 *   node packages/attestation-android/test-fixtures/generate.mjs
 *
 * Requires openssl on PATH. Self-contained on purpose: the fixtures are security
 * test data, so a reviewer must be able to see exactly what went into them
 * without reading the verifier they are meant to test.
 *
 * These are NOT real Google-rooted chains. They exercise the parser, the
 * property policy and the chain logic. Evidence from a real StrongBox device is
 * a separate, still-open gate.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));

// ---- DER writer -------------------------------------------------------------

const tagBytes = (cls, constructed, tag) => {
  const first = (cls << 6) | (constructed ? 0x20 : 0);
  if (tag < 31) return [first | tag];
  const parts = [];
  for (let value = tag; value > 0; value = Math.floor(value / 128)) parts.unshift(value % 128);
  for (let i = 0; i < parts.length - 1; i++) parts[i] |= 0x80;
  return [first | 0x1f, ...parts];
};

const lengthBytes = (n) => {
  if (n < 0x80) return [n];
  const out = [];
  for (let value = n; value > 0; value >>>= 8) out.unshift(value & 0xff);
  return [0x80 | out.length, ...out];
};

const tlv = (cls, constructed, tag, value) =>
  Buffer.concat([Buffer.from(tagBytes(cls, constructed, tag)), Buffer.from(lengthBytes(value.length)), value]);

const int = (n) => {
  const out = [];
  for (let value = n; value > 0; value = Math.floor(value / 256)) out.unshift(value % 256);
  if (out.length === 0) out.push(0);
  if (out[0] & 0x80) out.unshift(0);
  return tlv(0, false, 2, Buffer.from(out));
};
const enumerated = (n) => Buffer.concat([Buffer.from([0x0a, 0x01]), Buffer.from([n])]);
const octets = (bytes) => tlv(0, false, 4, Buffer.from(bytes));
const bool = (value) => Buffer.from([0x01, 0x01, value ? 0xff : 0x00]);
const NULL = Buffer.from([0x05, 0x00]);
const seq = (...parts) => tlv(0, true, 16, Buffer.concat(parts));
const set = (...parts) => tlv(0, true, 17, Buffer.concat(parts));
const ctx = (tag, value) => tlv(2, true, tag, value); // EXPLICIT

const rootOfTrust = ({ locked = true, bootState = 0 } = {}) =>
  ctx(704, seq(octets(new Uint8Array(32).fill(0xab)), bool(locked), enumerated(bootState), octets(new Uint8Array(32).fill(0xcd))));

/** Hardware-enforced authorizations for a P-256 signing key. Tags must ascend. */
const hardwareAuthorizations = (options = {}) => {
  const { purpose = [2], algorithm = 3, keySize = 256, ecCurve = 1, origin = 0, allApplications = false } = options;
  const parts = [
    ctx(1, set(...purpose.map(int))),
    ctx(2, int(algorithm)),
    ctx(3, int(keySize)),
    ctx(5, set(int(4))),
    ctx(10, int(ecCurve)),
    ctx(503, NULL),
  ];
  if (allApplications) parts.push(ctx(600, NULL));
  parts.push(ctx(702, int(origin)), rootOfTrust(options), ctx(705, int(140000)), ctx(706, int(202608)));
  return seq(...parts);
};

const applicationId = Buffer.from("com.kionel.device", "utf8");
const softwareAuthorizations = (extra = []) => seq(...extra, ctx(709, octets(applicationId)));

const keyDescription = ({
  attestationLevel = 2, keymasterLevel = 2, challenge, software = softwareAuthorizations(), hardware = hardwareAuthorizations(),
}) => seq(
  int(200), enumerated(attestationLevel), int(300), enumerated(keymasterLevel),
  octets(challenge), octets(Buffer.alloc(0)), software, hardware,
);

// ---- fixtures ---------------------------------------------------------------

export const CHALLENGE = Buffer.from(Array.from({ length: 32 }, (_, i) => i));

const VARIANTS = {
  // The key everything else is compared against: StrongBox, generated in hardware.
  strongbox: keyDescription({ challenge: CHALLENGE }),
  // TEE instead of a discrete secure element.
  tee: keyDescription({ challenge: CHALLENGE, attestationLevel: 1, keymasterLevel: 1 }),
  // The classic bypass: real properties moved into the list Android software controls.
  "software-enforced-swap": keyDescription({
    challenge: CHALLENGE,
    software: softwareAuthorizations([]),
    hardware: seq(ctx(709, octets(applicationId))),
  }),
  // Key imported from outside the secure hardware.
  imported: keyDescription({ challenge: CHALLENGE, hardware: hardwareAuthorizations({ origin: 2 }) }),
  // Unlocked bootloader.
  unlocked: keyDescription({ challenge: CHALLENGE, hardware: hardwareAuthorizations({ locked: false }) }),
  // Verified boot failed / unverified.
  "boot-unverified": keyDescription({ challenge: CHALLENGE, hardware: hardwareAuthorizations({ bootState: 2 }) }),
  // Usable by every app on the device.
  "all-apps": keyDescription({ challenge: CHALLENGE, hardware: hardwareAuthorizations({ allApplications: true }) }),
  // Wrong purpose: the key could be used to verify, not to sign.
  "purpose-verify": keyDescription({ challenge: CHALLENGE, hardware: hardwareAuthorizations({ purpose: [3] }) }),
  // Somebody else's enrollment.
  "other-challenge": keyDescription({ challenge: Buffer.alloc(32, 0x77) }),
};

// ---- certificate generation --------------------------------------------------

const openssl = (...args) => execFileSync("openssl", args, { cwd: DIR, stdio: ["ignore", "pipe", "pipe"] });

/**
 * Fixture validity is pinned, not relative to the generation date. Tests run
 * against a fixed clock; a certificate that starts being valid the day it was
 * generated makes every regeneration break a test that has not changed.
 */
const ROOT_FROM = "190101000000Z", ROOT_TO = "450101000000Z";
const LEAF_FROM = "200101000000Z", LEAF_TO = "400101000000Z";

const CA_DIR = join(DIR, ".ca");
const CA_CNF = join(DIR, "ca.cnf");

function caSetup() {
  mkdirSync(CA_DIR, { recursive: true });
  writeFileSync(join(DIR, "index.txt"), "");
  writeFileSync(join(DIR, "index.txt.attr"), "unique_subject = no\n");
  writeFileSync(join(DIR, "serial"), "01\n");
  writeFileSync(CA_CNF, [
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
  ].join("\n"));
}

const caTeardown = () => {
  rmSync(CA_DIR, { recursive: true, force: true });
  for (const name of ["ca.cnf", "index.txt", "index.txt.attr", "index.txt.old", "index.txt.attr.old", "serial", "serial.old"]) {
    rmSync(join(DIR, name), { force: true });
  }
};

const key = (name) => openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${name}.key`);
const csr = (keyName, out, cn) =>
  openssl("req", "-new", "-key", `${keyName}.key`, "-out", out, "-subj", `/CN=${cn}`, "-sha256");

function selfSigned(name, cn) {
  csr(name, `${name}.csr`, cn);
  openssl("ca", "-config", CA_CNF, "-batch", "-notext", "-selfsign", "-keyfile", `${name}.key`,
    "-in", `${name}.csr`, "-out", `${name}.crt`, "-startdate", ROOT_FROM, "-enddate", ROOT_TO,
    "-extfile", CA_CNF, "-extensions", "v3_ca");
  rmSync(join(DIR, `${name}.csr`));
}

function leaf(name, ca, description) {
  const extfile = join(DIR, `${name}.ext`);
  const hex = [...description].map((b) => b.toString(16).padStart(2, "0")).join(":");
  writeFileSync(extfile, `[v3_leaf]
1.3.6.1.4.1.11129.2.1.17=DER:${hex}
`);
  csr("leaf", `${name}.csr`, `Kionel Android ${name}`);
  openssl("ca", "-config", CA_CNF, "-batch", "-notext", "-cert", `${ca}.crt`, "-keyfile", `${ca}.key`,
    "-in", `${name}.csr`, "-out", `${name}.crt`, "-startdate", LEAF_FROM, "-enddate", LEAF_TO,
    "-extfile", extfile, "-extensions", "v3_leaf");
  rmSync(extfile);
  rmSync(join(DIR, `${name}.csr`));
}

mkdirSync(DIR, { recursive: true });
caSetup();
for (const name of ["root", "rogue-root", "leaf"]) key(name);
selfSigned("root", "Kionel Test Android Attestation Root");
selfSigned("rogue-root", "Kionel Rogue Android Root");
for (const [name, description] of Object.entries(VARIANTS)) leaf(name, "root", description);
leaf("rogue-leaf", "rogue-root", VARIANTS.strongbox);
caTeardown();

console.log(`${Object.keys(VARIANTS).length + 1} leaf certificates written to ${DIR}`);
