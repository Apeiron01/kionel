/**
 * Apple App Attest test fixture'larını yeniden üretir.
 *
 *   node packages/attestation-apple/test-fixtures/generate.mjs
 *
 * openssl gerekir. Kendi kendine yeterli tutuldu: fixture'lar güvenlik test
 * verisidir, bir inceleyen içine ne konduğunu doğrulayıcıyı okumadan görebilmeli.
 *
 * Bunlar gerçek Apple köküne bağlı zincirler DEĞİLDİR. CBOR/DER ayrıştırmayı,
 * nonce bağlamayı ve authData politikasını sınarlar. Gerçek cihaz kanıtı ayrı,
 * hâlâ açık bir kapıdır.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const openssl = (...args) => execFileSync("openssl", args, { cwd: DIR, stdio: ["ignore", "pipe", "pipe"] });
const sha256 = (data) => new Uint8Array(createHash("sha256").update(data).digest());
const b64 = (bytes) => Buffer.from(bytes).toString("base64");

export const CHALLENGE = Buffer.from(Array.from({ length: 32 }, (_, i) => (i * 7 + 1) & 0xff));
export const APP_ID = "A1B2C3D4E5.dev.kionel.enroll";

const AAGUID_PRODUCTION = Buffer.concat([Buffer.from("appattest", "utf8"), Buffer.alloc(7)]);
const AAGUID_DEVELOPMENT = Buffer.from("appattestdevelop", "utf8");

function authData({ appId = APP_ID, counter = 0, aaguid = AAGUID_PRODUCTION, credentialId }) {
  const head = Buffer.alloc(55);
  Buffer.from(sha256(Buffer.from(appId, "utf8"))).copy(head, 0);
  head[32] = 0x40;                 // attested credential data included
  head.writeUInt32BE(counter, 33);
  Buffer.from(aaguid).copy(head, 37);
  head.writeUInt16BE(credentialId.length, 53);
  return Buffer.concat([head, Buffer.from(credentialId)]);
}

const nonceFor = (data, challenge = CHALLENGE) => sha256(Buffer.concat([Buffer.from(data), Buffer.from(sha256(challenge))]));

/** SEQUENCE { [1] EXPLICIT OCTET STRING nonce } */
function nonceExtension(nonce) {
  const octet = Buffer.concat([Buffer.from([0x04, 0x20]), Buffer.from(nonce)]);
  const tagged = Buffer.concat([Buffer.from([0xa1, octet.length]), octet]);
  return Buffer.concat([Buffer.from([0x30, tagged.length]), tagged]);
}

function key(name) {
  openssl("ecparam", "-name", "prime256v1", "-genkey", "-noout", "-out", `${name}.key`);
}
function selfSigned(name, cn) {
  openssl("req", "-new", "-x509", "-key", `${name}.key`, "-out", `${name}.crt`, "-days", "7300", "-subj", `/CN=${cn}`, "-sha256");
}
function leaf(name, ca, nonce) {
  const hex = [...nonceExtension(nonce)].map((b) => b.toString(16).padStart(2, "0")).join(":");
  writeFileSync(join(DIR, `${name}.ext`), `1.2.840.113635.100.8.2=DER:${hex}\n`);
  openssl("req", "-new", "-key", "leaf.key", "-out", `${name}.csr`, "-subj", `/CN=Kionel Apple ${name}`, "-sha256");
  openssl("x509", "-req", "-in", `${name}.csr`, "-CA", `${ca}.crt`, "-CAkey", `${ca}.key`, "-CAcreateserial",
    "-out", `${name}.crt`, "-days", "7300", "-sha256", "-extfile", `${name}.ext`);
  rmSync(join(DIR, `${name}.ext`));
  rmSync(join(DIR, `${name}.csr`));
}

for (const name of ["root", "rogue-root", "leaf"]) key(name);
selfSigned("root", "Kionel Test Apple App Attest Root");
selfSigned("rogue-root", "Kionel Rogue Apple Root");

// Apple'da anahtar kimliği açık anahtarın SHA-256'sıdır.
const leafDer = openssl("ec", "-in", "leaf.key", "-pubout", "-outform", "DER");
const sec1 = leafDer.subarray(leafDer.length - 65);
if (sec1[0] !== 4) throw new Error("beklenen sıkıştırılmamış SEC1 noktası");
const keyId = sha256(sec1);

const VARIANTS = {
  good: { data: authData({ credentialId: keyId }) },
  development: { data: authData({ credentialId: keyId, aaguid: AAGUID_DEVELOPMENT }) },
  "unknown-environment": { data: authData({ credentialId: keyId, aaguid: Buffer.alloc(16, 0x5a) }) },
  "other-app": { data: authData({ credentialId: keyId, appId: "Z9Y8X7W6V5.dev.other.app" }) },
  "counter-set": { data: authData({ credentialId: keyId, counter: 1 }) },
  "wrong-credential-id": { data: authData({ credentialId: Buffer.alloc(32, 0x11) }) },
  // authData doğru ama eklenti başka bir challenge için hesaplanmış nonce taşıyor.
  "wrong-nonce": { data: authData({ credentialId: keyId }), challenge: Buffer.alloc(32, 0x99) },
};

for (const [name, variant] of Object.entries(VARIANTS)) {
  leaf(name, "root", nonceFor(variant.data, variant.challenge ?? CHALLENGE));
}
leaf("rogue-leaf", "rogue-root", nonceFor(VARIANTS.good.data));

rmSync(join(DIR, "root.srl"), { force: true });
rmSync(join(DIR, "rogue-root.srl"), { force: true });

writeFileSync(join(DIR, "fixtures.json"), `${JSON.stringify({
  challenge: b64(CHALLENGE),
  appId: APP_ID,
  publicKey: b64(sec1),
  keyId: b64(keyId),
  authData: Object.fromEntries(Object.entries(VARIANTS).map(([name, variant]) => [name, b64(variant.data)])),
}, null, 2)}\n`);

console.log(`${Object.keys(VARIANTS).length + 1} leaf sertifikası ve fixtures.json yazıldı: ${DIR}`);
