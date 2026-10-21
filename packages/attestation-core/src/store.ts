// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * Durable enrollment trust store.
 *
 * A half-written trust file is a security event, not a data-loss event: a
 * truncated record could downgrade a device or strand it. Every mutation is
 * therefore written to a temporary file, flushed, and renamed over the target,
 * and every read is checksum-validated and shape-validated before use.
 *
 * ponytail: single JSON file with a whole-file rewrite. Fine to five figures of
 * devices; move to SQLite/Postgres when the control plane owns this state.
 *
 * Limitation, stated plainly: the checksum detects corruption and partial
 * writes, NOT a local administrator. Anyone who can rewrite this file can also
 * replace the native host binary — see THREAT-MODEL.md.
 */
import { open, readFile, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { createHash } from "node:crypto";
import { dirname, isAbsolute } from "node:path";
import type { AttestationTrustDecision, AttestationTrustStore } from "@kionel/platform-keys";

const FILE_VERSION = 1;
const MAX_DECISIONS = 100_000;

export class FileAttestationTrustStore implements AttestationTrustStore {
  readonly path: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    if (!isAbsolute(path)) throw new Error("trust store yolu mutlak olmalı");
    this.path = path;
  }

  /** Serializes mutations so two concurrent enrollments cannot lose a decision. */
  private run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async get(keyId: string): Promise<AttestationTrustDecision | undefined> {
    return this.run(async () => (await this.load()).get(keyId));
  }

  async put(decision: AttestationTrustDecision): Promise<void> {
    validateDecision(decision);
    return this.run(async () => {
      const decisions = await this.load();
      if (!decisions.has(decision.keyId) && decisions.size >= MAX_DECISIONS) {
        throw new Error("trust store kapasitesi doldu");
      }
      decisions.set(decision.keyId, decision);
      await this.save(decisions);
    });
  }

  async remove(keyId: string): Promise<void> {
    return this.run(async () => {
      const decisions = await this.load();
      if (decisions.delete(keyId)) await this.save(decisions);
    });
  }

  private async load(): Promise<Map<string, AttestationTrustDecision>> {
    let raw: string;
    try {
      raw = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!plainObject(parsed) || parsed.v !== FILE_VERSION || typeof parsed.checksum !== "string" || !Array.isArray(parsed.decisions)) {
      throw new Error("trust store dosyası tanınmıyor");
    }
    if (checksum(parsed.decisions) !== parsed.checksum) throw new Error("trust store sağlama toplamı tutmuyor");
    const map = new Map<string, AttestationTrustDecision>();
    for (const entry of parsed.decisions) {
      const decision = entry as AttestationTrustDecision;
      validateDecision(decision);
      if (map.has(decision.keyId)) throw new Error("trust store aynı keyId'yi iki kez içeriyor");
      map.set(decision.keyId, decision);
    }
    return map;
  }

  private async save(decisions: Map<string, AttestationTrustDecision>): Promise<void> {
    const sorted = [...decisions.values()].sort((a, b) => (a.keyId < b.keyId ? -1 : 1));
    const body = JSON.stringify({ v: FILE_VERSION, checksum: checksum(sorted), decisions: sorted }, null, 2);
    const temp = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;
    try {
      const handle = await open(temp, "wx", 0o600);
      try {
        await handle.writeFile(body, "utf8");
        await handle.sync(); // durable before it becomes visible under the real name
      } finally {
        await handle.close();
      }
      await rename(temp, this.path);
      await syncDirectory(dirname(this.path));
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}

function checksum(decisions: readonly unknown[]): string {
  return createHash("sha256").update(JSON.stringify(decisions)).digest("hex");
}

/** Rejects anything the policy engine would later have to guess about. */
export function validateDecision(decision: AttestationTrustDecision): void {
  if (!plainObject(decision)) throw new Error("trust kaydı nesne olmalı");
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(decision.keyId)) throw new Error("trust kaydında geçersiz keyId");
  if (!decision.providerId || decision.providerId.length > 128) throw new Error("trust kaydında geçersiz sağlayıcı");
  if (decision.algorithm !== "ed25519" && decision.algorithm !== "ecdsa-p256-sha256") throw new Error("trust kaydında geçersiz algoritma");
  if (!["tee", "strongbox", "secure-enclave", "tpm"].includes(decision.securityLevel)) {
    throw new Error("trust kaydı donanım güven düzeyi taşımalı");
  }
  if (!/^[0-9a-f]{64}$/.test(decision.publicKeySha256)) throw new Error("trust kaydında geçersiz açık anahtar özeti");
  if (decision.requiresUserPresence !== undefined && typeof decision.requiresUserPresence !== "boolean") {
    throw new Error("trust kaydında geçersiz kullanıcı varlığı politikası");
  }
  const result = decision.result;
  if (!plainObject(result) || (result.status !== "verified" && result.status !== "rejected")) {
    throw new Error("trust kaydı yalnızca verified/rejected karar saklayabilir");
  }
  if (result.status === "verified" && (!result.verifiedBy || !result.verifiedAt)) {
    throw new Error("verified trust kaydı doğrulayıcı ve zaman taşımalı");
  }
}

async function syncDirectory(path: string): Promise<void> {
  // Windows cannot fsync a directory handle; the rename is already ordered there.
  try {
    const handle = await open(path, "r");
    try { await handle.sync() } finally { await handle.close() }
  } catch { /* platform does not support directory fsync */ }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
