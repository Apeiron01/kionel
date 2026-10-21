import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const cli = fileURLToPath(new URL("../../apps/license/license.ts", import.meta.url));
it("CLI never creates a signing key during verification or silently overwrites files", () => {
  const dir = mkdtempSync(join(tmpdir(), "kionel-license-"));
  const key = join(dir, "secret.json");
  const pub = join(dir, "public.json");
  const license = join(dir, "license.json");
  const run = (...args: string[]) => spawnSync(process.execPath,
    ["--experimental-strip-types", "--no-warnings", cli, ...args, `--authority-key=${key}`], { encoding: "utf8" });
  try {
    expect(run("verify", license).status).toBe(2);
    expect(existsSync(key)).toBe(false);
    expect(run("issue", "--licensee=Test", `--out=${license}`).status).toBe(2);
    expect(existsSync(key)).toBe(false);
    expect(run("authority", `--out=${key}`).status).toBe(2);
    expect(existsSync(key)).toBe(false);
    expect(run("authority", `--out=${pub}`).status).toBe(0);
    const originalKey = readFileSync(key, "utf8");
    expect(run("authority", `--out=${key}`).status).toBe(2);
    expect(readFileSync(key, "utf8")).toBe(originalKey);
    expect(run("issue", "--licensee=Test", "--months=0.5", `--out=${license}`).status).toBe(2);
    expect(run("issue", "--licensee=Test", `--out=${license}`).status).toBe(0);
    const originalLicense = readFileSync(license, "utf8");
    expect(run("issue", "--licensee=Other", `--out=${license}`).status).toBe(2);
    expect(readFileSync(license, "utf8")).toBe(originalLicense);
    rmSync(key);
    expect(run("verify", license, `--authority=${pub}`).status).toBe(0);
    expect(existsSync(key)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
