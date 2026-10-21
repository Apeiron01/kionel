import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyReceipt, type Receipt } from "@kionel/crypto";
import { issueLicense } from "@kionel/licensing";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import { requireProductionLicense } from "./license-access.ts";

const licenseDir = mkdtempSync(join(tmpdir(), "kionel-cli-license-"));
const licensePath = join(licenseDir, "license.json");
const authorityPath = join(licenseDir, "public.json");
let issuer: PlatformSigningIdentity;
beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]) as CryptoKeyPair;
  issuer = { providerId: "test", keyId: "test", algorithm: "ecdsa-p256-sha256",
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    securityLevel: "software-protected", persistence: "session", attestation: { status: "not-available" },
    sign: async data => new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as BufferSource)) };
  writeFileSync(authorityPath, JSON.stringify({ publicKey: Buffer.from(issuer.publicKey).toString("base64url") }));
  writeFileSync(licensePath, JSON.stringify(await issueLicense(issuer, { licensee: "CLI test", tier: "pilot",
    scope: { sites: 1, devices: 2, productLines: ["proof"] },
    issuedAt: new Date(Date.now() - 86400_000), validUntil: new Date(Date.now() + 86400_000) })));
});

/**
 * Taşıyıcıdan bağımsız kanıt: dosya bu testte hiçbir optik kanaldan geçmiyor,
 * sadece diskte duruyor — USB veya kurye ile gitmiş gibi. Kanıt yine de üretiliyor
 * ve yine çevrimdışı doğrulanıyor. "Kameranız yoksa alamazsınız" cümlesini
 * kurmak zorunda olmadığımızın kanıtı budur.
 */
const attest = (...args: string[]): string =>
  execFileSync("node", ["--experimental-strip-types", "--no-warnings", "apps/attest/attest.ts", `--license=${licensePath}`, ...args],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: testEnv() });
const testEnv = () => ({ ...process.env, KIONEL_TEST_LICENSE_AUTHORITY: authorityPath });

describe("Kionel Proof — optik olmayan taşıyıcı", () => {
  it("refuses missing, forged and expired licenses before writing evidence", async () => {
    await expect(requireProductionLicense(join(licenseDir, "missing"), authorityPath)).rejects.toThrow();
    const value = JSON.parse(readFileSync(licensePath, "utf8")); value.licensee = "Forged";
    const bad = join(licenseDir, "bad.json"); writeFileSync(bad, JSON.stringify(value));
    await expect(requireProductionLicense(bad, authorityPath)).rejects.toThrow();
    const expired = await issueLicense(issuer, { licensee: "Expired", tier: "pilot",
      scope: { sites: 1, devices: 2, productLines: ["proof"] },
      issuedAt: new Date(Date.now() - 60 * 86400_000), validUntil: new Date(Date.now() - 15 * 86400_000) });
    writeFileSync(bad, JSON.stringify(expired));
    await expect(requireProductionLicense(bad, authorityPath)).rejects.toThrow();
    const file = join(licenseDir, "blocked.txt"); writeFileSync(file, "content");
    const identity = join(licenseDir, "blocked-identity.json");
    expect(() => execFileSync("node", ["--experimental-strip-types", "--no-warnings", "apps/attest/attest.ts",
      "dispatch", file, `--license=${bad}`, `--identity=${identity}`],
      { stdio: "pipe", env: testEnv() })).toThrow();
    expect(existsSync(identity)).toBe(false); expect(existsSync(`${file}.dispatch.json`)).toBe(false);
    // A self-signed licence plus a user-supplied authority must not open the gate:
    // the authority comes from the installation, never from the command line.
    const own = join(licenseDir, "self-signed.json");
    writeFileSync(own, readFileSync(licensePath));
    expect(() => execFileSync("node", ["--experimental-strip-types", "--no-warnings", "apps/attest/attest.ts",
      "dispatch", file, `--license=${own}`, `--authority=${authorityPath}`, `--identity=${identity}`],
      { stdio: "pipe" })).toThrow();
    expect(existsSync(`${file}.dispatch.json`)).toBe(false);
    // Read-only verification remains available even with an expired license.
    execFileSync("node", ["--experimental-strip-types", "--no-warnings", "apps/attest/attest.ts",
      "chain", file, `--license=${bad}`], { stdio: "pipe", env: testEnv() });
  });
  it("sahte sevk imzasında makbuz veya alıcı anahtarı oluşturmaz", () => {
    const dir = mkdtempSync(join(tmpdir(), "kionel-forged-dispatch-"));
    const file = join(dir, "result.txt");
    const receiver = join(dir, "receiver.json");
    writeFileSync(file, "same content");
    attest("dispatch", file, `--identity=${join(dir, "sender.json")}`);
    const dispatchPath = `${file}.dispatch.json`;
    const dispatch = JSON.parse(readFileSync(dispatchPath, "utf8"));
    dispatch.sig = "A".repeat(86);
    writeFileSync(dispatchPath, JSON.stringify(dispatch));
    expect(() => attest("deliver", file, `--dispatch=${dispatchPath}`, `--identity=${receiver}`)).toThrow();
    expect(existsSync(`${file}.receipt.json`)).toBe(false);
    expect(existsSync(receiver)).toBe(false);
  });
  it("zincir doğrulaması kimlik dosyası oluşturmaz", () => {
    const dir = mkdtempSync(join(tmpdir(), "kionel-readonly-chain-"));
    const file = join(dir, "result.txt");
    const identity = join(dir, "unused.json");
    writeFileSync(file, "content");
    attest("chain", file, `--identity=${identity}`);
    expect(existsSync(identity)).toBe(false);
  });
  it("USB ile giden bir dosya için iki taraflı kanıt üretir", () => {
    const dir = mkdtempSync(join(tmpdir(), "kionel-attest-"));
    const file = join(dir, "sonuc.csv");
    writeFileSync(file, "Numune 2026-0042\nSonuc: 4.21 mg/L\n");

    attest("dispatch", file, "--ref=CASE-1", `--identity=${join(dir, "lab.json")}`);
    const out = attest("deliver", file, `--dispatch=${file}.dispatch.json`, `--identity=${join(dir, "audit.json")}`);
    expect(out).toContain("GEÇERLİ");

    const receipt = JSON.parse(readFileSync(`${file}.receipt.json`, "utf8")) as Receipt;
    return verifyReceipt(receipt, new Uint8Array(readFileSync(file))).then((verdict) => {
      expect(verdict.ok).toBe(true);
      expect(verdict.signers).toEqual(["alıcı", "gönderen"]);
    });
  }, 60_000);

  it("sevk kaydındaki dosya değilse teslimi imzalamaz", () => {
    const dir = mkdtempSync(join(tmpdir(), "kionel-attest-"));
    const real = join(dir, "gercek.csv");
    const fake = join(dir, "sahte.csv");
    writeFileSync(real, "4.21 mg/L");
    writeFileSync(fake, "9.99 mg/L");

    attest("dispatch", real, `--identity=${join(dir, "lab.json")}`);
    // İmzalamadan önce doğrulamak zorunlu: doğrulamayan bir imza kanıt değildir.
    expect(() => attest("deliver", fake, `--dispatch=${real}.dispatch.json`, `--identity=${join(dir, "audit.json")}`))
      .toThrow();
  }, 60_000);
});
