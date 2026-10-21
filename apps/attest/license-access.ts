import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLOCK_WARNING, entitlement, licenseNotice, monotonicNow, verifyLicense, type ClockState } from "@kionel/licensing";

/**
 * Installers pin this public authority; never trust the issuer in a license file.
 *
 * In the customer bundle (`pnpm cli:build`) the key is compiled in and the test
 * override below is dead code that the bundler removes. Running from source keeps
 * the override so tests need not hold the real private key.
 * ponytail: minified JS can still be patched by a determined user; the buyer is an
 * audited institution. Upgrade path: Node single-executable or native signing.
 */
declare const __KIONEL_LICENSE_AUTHORITY__: string | undefined;

function authorityKey(authorityPath?: string): string {
  if (typeof __KIONEL_LICENSE_AUTHORITY__ === "string") return __KIONEL_LICENSE_AUTHORITY__;
  const path = authorityPath ?? process.env.KIONEL_TEST_LICENSE_AUTHORITY ??
    fileURLToPath(new URL("../../config/license-public.json", import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")).publicKey;
}

/** Görülen en ileri zaman; saati geri almak süresi dolmuş lisansı diriltmesin. */
function clockFile(): string {
  return join(homedir(), ".kionel", "clock.json");
}

function readClock(): ClockState | undefined {
  try { return JSON.parse(readFileSync(clockFile(), "utf8")) as ClockState; } catch { return undefined; }
}

function writeClock(state: ClockState): void {
  try {
    mkdirSync(join(homedir(), ".kionel"), { recursive: true });
    writeFileSync(clockFile(), JSON.stringify(state), { mode: 0o600 });
  } catch { /* salt okunur ev dizini kontrolü durdurmaz */ }
}

export async function requireProductionLicense(licensePath?: string, authorityPath?: string): Promise<void> {
  const clock = monotonicNow(readClock());
  writeClock(clock.next);
  if (clock.rolledBack) console.error(CLOCK_WARNING);
  let state;
  try {
    const license = JSON.parse(readFileSync(licensePath ?? join(homedir(), ".kionel", "license.json"), "utf8"));
    state = await verifyLicense(license, new Uint8Array(Buffer.from(authorityKey(authorityPath), "base64url")), clock.now);
  } catch { throw new Error("A signed commercial license is required. Use --license=<file>. Existing evidence can still be verified."); }
  if (state.state !== "invalid" && state.license.scope.productLines.every(line => line === "import-automation")) {
    throw new Error("An Import Automation licence does not cover this product.");
  }
  if (entitlement(state) === "demo") throw new Error(licenseNotice(state));
  if (entitlement(state) === "grace") console.error(licenseNotice(state));
}
