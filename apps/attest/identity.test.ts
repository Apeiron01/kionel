import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { exportIdentity } from "@kionel/crypto";
import { loadOrCreateIdentity } from "./identity.ts";

it("allows only one concurrent creator and preserves the winning key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kionel-key-race-"));
  try {
    const path = join(dir, "identity.json");
    const outcomes = await Promise.allSettled([loadOrCreateIdentity(path), loadOrCreateIdentity(path)]);
    const winners = outcomes.filter((r) => r.status === "fulfilled");
    const losers = outcomes.filter((r) => r.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.reason).toMatchObject({ code: "EEXIST" });
    const persisted = readFileSync(path, "utf8");
    expect(JSON.parse(persisted)).toEqual(await exportIdentity(winners[0]!.value.identity));
    const loaded = await loadOrCreateIdentity(path);
    expect(loaded.created).toBe(false);
    expect(await exportIdentity(loaded.identity)).toEqual(JSON.parse(persisted));
    expect(readFileSync(path, "utf8")).toBe(persisted);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("does not replace a malformed existing key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kionel-key-invalid-"));
  try {
    const path = join(dir, "identity.json");
    writeFileSync(path, "invalid key");
    await expect(loadOrCreateIdentity(path)).rejects.toThrow();
    expect(readFileSync(path, "utf8")).toBe("invalid key");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
