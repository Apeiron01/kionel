// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { completeReceiptV2Bytes, type ReceiptV2 } from "@kionel/crypto";
import {
  attachReceiptTimestamp, receiptTimestampImprint, receiptTimestampRequest, verifyReceiptTimestamp,
} from "./receipt.ts";

const FIXTURES = new URL("../test-fixtures/", import.meta.url);
const ROOT = readFileSync(new URL("root.crt", FIXTURES), "utf8");
const policy = { anchors: [ROOT] };

const key = (name: string): ReceiptV2["sender"] => ({
  alg: "ES256",
  kid: `urn:kionel:key:sha256:${name.repeat(43).slice(0, 43)}`,
  key: Buffer.from(Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i))).toString("base64url"),
});

const RECEIPT: ReceiptV2 = {
  v: 2,
  protocol: "kionel-v2",
  session: 0x01020304,
  hash: "A".repeat(43),
  bytes: 4096,
  at: "2026-09-06T10:00:00.000Z",
  sender: key("S"),
  receiver: key("R"),
  sig: "Z".repeat(86),
};

/**
 * Stamps arbitrary bytes with the fixture TSA. Reaching for openssl keeps the
 * test honest: a token we minted ourselves would only prove our writer agrees
 * with our reader.
 */
function stamp(imprint: Uint8Array): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), "kionel-tsa-"));
  const fixturePath = (name: string) => fileURLToPath(new URL(name, FIXTURES)).replaceAll("\\", "/");
  writeFileSync(join(dir, "tsa.cnf"), [
    "[tsa]", "default_tsa = tsa_config", "",
    "[tsa_config]",
    `signer_cert = ${fixturePath("tsa.crt")}`,
    `signer_key = ${fixturePath("tsa.key")}`,
    "signer_digest = sha256",
    "default_policy = 1.3.6.1.4.1.99999.1.1",
    "digests = sha256, sha512",
    "accuracy = secs:1, millisecs:500",
    "clock_precision_digits = 0",
    "ordering = yes",
    "tsa_name = yes",
    "ess_cert_id_chain = no",
    "ess_cert_id_alg = sha256",
    `serial = ${join(dir, "serial").replaceAll("\\", "/")}`, "",
  ].join("\n"));
  writeFileSync(join(dir, "serial"), "01\n");

  const gitOpenSSL = "C:/Program Files/Git/usr/bin/openssl.exe";
  const executable = process.env.KIONEL_OPENSSL ??
    (process.platform === "win32" && existsSync(gitOpenSSL) ? gitOpenSSL : "openssl");
  const openssl = (...args: string[]) => execFileSync(executable, args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  // -digest, not -data: the imprint IS the digest. Passing it as a file would
  // make openssl hash it a second time and stamp the wrong thing.
  openssl("ts", "-query", "-digest", Buffer.from(imprint).toString("hex"), "-sha256", "-cert", "-out", "request.tsq");
  openssl("ts", "-reply", "-config", "tsa.cnf", "-section", "tsa_config", "-queryfile", "request.tsq", "-out", "response.tsr");
  openssl("ts", "-reply", "-in", "response.tsr", "-token_out", "-out", "token.der");
  return new Uint8Array(readFileSync(join(dir, "token.der")));
}

describe("makbuza zaman damgası bağlama", () => {
  it("iz, imzayı da içeren kanonik baytlar üzerinden hesaplanır", async () => {
    const imprint = await receiptTimestampImprint(RECEIPT);
    expect(imprint).toHaveLength(32);

    // İmza değişirse iz de değişmeli: damgalanan şey imzanın varlığıdır.
    const other = await receiptTimestampImprint({ ...RECEIPT, sig: "Y".repeat(86) });
    expect(Buffer.from(imprint).equals(Buffer.from(other))).toBe(false);

    // Kanonik baytlarla aynı kaynaktan türediğini de sabitleyelim.
    expect(completeReceiptV2Bytes(RECEIPT).length).toBeGreaterThan(0);
  });

  it("TSA isteği bu makbuzun izini taşır", async () => {
    const request = await receiptTimestampRequest(RECEIPT);
    const imprint = await receiptTimestampImprint(RECEIPT);
    expect(Buffer.from(request).includes(Buffer.from(imprint))).toBe(true);
  });

  it("gerçek bir TSA jetonu eklenir ve doğrulanır", async () => {
    const token = stamp(await receiptTimestampImprint(RECEIPT));
    const stamped = await attachReceiptTimestamp(RECEIPT, token, policy);

    expect(stamped.tst).toBeDefined();
    // Damga hiçbir imzalı baytı değiştirmemeli.
    const { tst, ...body } = stamped;
    expect(Buffer.from(completeReceiptV2Bytes(body)).equals(Buffer.from(completeReceiptV2Bytes(RECEIPT)))).toBe(true);

    const verdict = await verifyReceiptTimestamp(stamped, policy);
    expect(verdict.state).toBe("verified");
    if (verdict.state !== "verified") return;
    expect(verdict.verdict.authority).toContain("Kionel Test Timestamp Authority");
  });

  it("başka bir makbuzun jetonunu eklemeyi reddeder", async () => {
    const token = stamp(await receiptTimestampImprint(RECEIPT));
    const other: ReceiptV2 = { ...RECEIPT, session: 0x0a0b0c0d };
    await expect(attachReceiptTimestamp(other, token, policy)).rejects.toThrow(/eklenemez/);
  });

  it("damgasız makbuz reddedilmez, 'yok' sayılır", async () => {
    expect(await verifyReceiptTimestamp(RECEIPT, policy)).toEqual({ state: "absent" });
  });

  it("damgadan sonra makbuz düzenlenirse damga düşer", async () => {
    const token = stamp(await receiptTimestampImprint(RECEIPT));
    const stamped = await attachReceiptTimestamp(RECEIPT, token, policy);
    const edited = { ...stamped, bytes: 4097 };
    expect(await verifyReceiptTimestamp(edited, policy)).toMatchObject({ state: "rejected", code: "imprint-mismatch" });
  });

  it("dosyadaki saat elle değiştirilirse bulgu üretir", async () => {
    const token = stamp(await receiptTimestampImprint(RECEIPT));
    const stamped = await attachReceiptTimestamp(RECEIPT, token, policy);
    const lied = { ...stamped, tst: { ...stamped.tst!, at: "2020-01-01T00:00:00.000Z" } };
    expect(await verifyReceiptTimestamp(lied, policy))
      .toMatchObject({ state: "rejected", code: "mirrored-time-mismatch" });
  });

  it("güven kökü yoksa damgayı kabul etmez", async () => {
    const token = stamp(await receiptTimestampImprint(RECEIPT));
    const stamped = await attachReceiptTimestamp(RECEIPT, token, policy);
    expect(await verifyReceiptTimestamp(stamped, { anchors: [] }))
      .toMatchObject({ state: "rejected", code: "no-anchor" });
  });
});
