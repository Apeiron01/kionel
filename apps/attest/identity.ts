import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createIdentity, exportIdentity, importIdentity, type Identity } from "@kionel/crypto";

/** Never overwrite a key created by another process during key generation. */
export async function loadOrCreateIdentity(path: string): Promise<{ identity: Identity; created: boolean }> {
  let existing: string;
  try {
    existing = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const identity = await createIdentity();
    mkdirSync(dirname(path), { recursive: true });
    // EEXIST is deliberately fatal: do not replace an existing identity or
    // read a concurrent writer's potentially unfinished file.
    writeFileSync(path, JSON.stringify(await exportIdentity(identity), null, 2), { flag: "wx", mode: 0o600 });
    return { identity, created: true };
  }
  return { identity: await importIdentity(JSON.parse(existing) as JsonWebKey), created: false };
}
