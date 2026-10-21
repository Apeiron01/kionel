/** Node/desktop adapter for the signed Kionel Windows TPM host. */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type {
  KeyAlgorithm,
  NativeKeyBridge,
  NativeKeyCapabilities,
  NativeKeyRecord,
  NativeProvisionRequest,
} from "@kionel/platform-keys";

const PROVIDER_ID = "windows-cng-platform";
const ALGORITHM = "ecdsa-p256-sha256";
const MAX_SIGN_BYTES = 1024 * 1024;
const MAX_HOST_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface WindowsHostTransport {
  invoke(operation: "capabilities" | "provision" | "load" | "sign" | "remove", body?: unknown): Promise<unknown>;
}

export interface PinnedWindowsHostOptions {
  hostPath: string;
  expectedSha256: string;
  timeoutMs?: number;
  dotnetPath?: string;
}

/**
 * Launches one bounded operation per process and verifies the host artifact hash
 * immediately before every call. Release signing remains a separate packaging gate.
 */
export class PinnedWindowsHostTransport implements WindowsHostTransport {
  readonly hostPath: string;
  readonly expectedSha256: string;
  readonly timeoutMs: number;
  readonly dotnetPath: string;

  constructor(options: PinnedWindowsHostOptions) {
    if (!isAbsolute(options.hostPath) || !/\.(?:dll|exe)$/i.test(options.hostPath)) {
      throw new Error("Windows native host path must be an absolute .dll or .exe path");
    }
    if (!/^[0-9a-f]{64}$/.test(options.expectedSha256)) throw new Error("Windows native host SHA-256 pin is invalid");
    const timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 10 * 60_000) {
      throw new Error("Windows native host timeout must be 1 second..10 minutes");
    }
    this.hostPath = options.hostPath;
    this.expectedSha256 = options.expectedSha256;
    this.timeoutMs = timeoutMs;
    this.dotnetPath = options.dotnetPath ?? "dotnet";
  }

  async invoke(operation: "capabilities" | "provision" | "load" | "sign" | "remove", body?: unknown): Promise<unknown> {
    const actualHash = await windowsHostArtifactSha256(this.hostPath);
    if (actualHash !== this.expectedSha256) throw new Error("Windows native host hash does not match the pinned release artifact");
    const isDll = this.hostPath.toLowerCase().endsWith(".dll");
    const command = isDll ? this.dotnetPath : this.hostPath;
    const args = isDll ? [this.hostPath, operation] : [operation];
    return invokeProcess(command, args, body, this.timeoutMs);
  }
}

/** Pins the DLL plus the runtime metadata that controls how dotnet loads it. */
export async function windowsHostArtifactSha256(hostPath: string): Promise<string> {
  const files = hostPath.toLowerCase().endsWith(".dll")
    ? [hostPath, `${hostPath.slice(0, -4)}.deps.json`, `${hostPath.slice(0, -4)}.runtimeconfig.json`]
    : [hostPath];
  const digest = createHash("sha256");
  for (const file of files) {
    const content = await readFile(file);
    digest.update(basename(file), "utf8");
    digest.update("\0");
    digest.update(createHash("sha256").update(content).digest());
  }
  return digest.digest("hex");
}

export class WindowsTpmBridge implements NativeKeyBridge {
  readonly transport: WindowsHostTransport;

  constructor(transport: WindowsHostTransport) {
    this.transport = transport;
  }

  async capabilities(): Promise<NativeKeyCapabilities> {
    return decodeCapabilities(await this.transport.invoke("capabilities"));
  }

  async provision(request: NativeProvisionRequest): Promise<NativeKeyRecord> {
    if (request.algorithm !== ALGORITHM) throw new Error("Windows TPM bridge only supports ecdsa-p256-sha256");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(request.alias)) throw new Error("Windows TPM alias is invalid");
    if (request.attestationChallenge.length !== 32) throw new Error("Windows TPM attestation challenge must be 32 bytes");
    return decodeRecord(await this.transport.invoke("provision", {
      alias: request.alias,
      algorithm: request.algorithm,
      requireUserPresence: request.requireUserPresence,
      attestationChallenge: b64url(request.attestationChallenge),
    }));
  }

  async load(keyId: string): Promise<NativeKeyRecord | undefined> {
    validateKeyId(keyId);
    const result = await this.transport.invoke("load", { keyId });
    return result === null ? undefined : decodeRecord(result);
  }

  async sign(keyId: string, algorithm: KeyAlgorithm, data: Uint8Array): Promise<Uint8Array> {
    validateKeyId(keyId);
    if (algorithm !== ALGORITHM) throw new Error("Windows TPM signature algorithm mismatch");
    if (data.length > MAX_SIGN_BYTES) throw new Error("Windows TPM signing input exceeds 1 MiB");
    const result = await this.transport.invoke("sign", { keyId, algorithm, data: b64url(data) });
    if (!plainObject(result) || !exactKeys(result, ["signature"]) || typeof result.signature !== "string") {
      throw new Error("Windows native host returned an invalid signature response");
    }
    return unb64url(result.signature, 64, "signature");
  }

  async remove(keyId: string): Promise<void> {
    validateKeyId(keyId);
    const result = await this.transport.invoke("remove", { keyId, confirmKeyId: keyId });
    if (!plainObject(result) || !exactKeys(result, ["removed"]) || typeof result.removed !== "boolean") {
      throw new Error("Windows native host returned an invalid removal response");
    }
  }
}

export function decodeCapabilities(value: unknown): NativeKeyCapabilities {
  if (!plainObject(value) || !exactKeys(value, ["providerId", "algorithms", "securityLevels", "supportsAttestation", "attestationStatus"]) ||
      value.providerId !== PROVIDER_ID || !sameStringArray(value.algorithms, [ALGORITHM]) ||
      !sameStringArray(value.securityLevels, ["tpm"]) || value.supportsAttestation !== false ||
      value.attestationStatus !== "not-implemented") {
    throw new Error("Windows native host capabilities are invalid or overclaim attestation");
  }
  return { providerId: PROVIDER_ID, algorithms: [ALGORITHM], securityLevels: ["tpm"], supportsAttestation: false };
}

export function decodeRecord(value: unknown): NativeKeyRecord {
  if (!plainObject(value) || !exactKeys(value, [
    "providerId", "keyId", "algorithm", "publicKey", "securityLevel", "persistence", "requiresUserPresence",
  ]) || value.providerId !== PROVIDER_ID || value.algorithm !== ALGORITHM || value.securityLevel !== "tpm" ||
      value.persistence !== "persistent" || typeof value.publicKey !== "string" ||
      typeof value.requiresUserPresence !== "boolean" || typeof value.keyId !== "string") {
    throw new Error("Windows native host returned an invalid TPM key record");
  }
  validateKeyId(value.keyId);
  const publicKey = unb64url(value.publicKey, 65, "public key");
  if (publicKey[0] !== 4) throw new Error("Windows TPM public key is not uncompressed SEC1 P-256");
  return {
    providerId: PROVIDER_ID,
    keyId: value.keyId,
    algorithm: ALGORITHM,
    publicKey,
    securityLevel: "tpm",
    persistence: "persistent",
    requiresUserPresence: value.requiresUserPresence,
  };
}

async function invokeProcess(command: string, args: string[], body: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    const finish = (error?: Error, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Windows native host timed out"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_HOST_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("Windows native host stdout limit exceeded"));
      } else stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_HOST_OUTPUT_BYTES) {
        child.kill();
        finish(new Error("Windows native host stderr limit exceeded"));
      } else stderr.push(chunk);
    });
    child.on("error", (error) => finish(new Error(`Windows native host could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (settled) return;
      const output = Buffer.concat(stdout).toString("utf8");
      if (code !== 0) {
        const hostError = safeHostError(Buffer.concat(stderr).toString("utf8"));
        return finish(new Error(`Windows native host rejected the operation (${hostError})`));
      }
      if (stderrBytes !== 0) return finish(new Error("Windows native host wrote unexpected stderr output"));
      try { finish(undefined, JSON.parse(output) as unknown) }
      catch { finish(new Error("Windows native host returned invalid JSON")) }
    });
    const encoded = body === undefined ? "" : JSON.stringify(body);
    if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) {
      child.kill();
      return finish(new Error("Windows native host request exceeds 2 MiB"));
    }
    child.stdin.end(encoded);
  });
}

function safeHostError(stderr: string): string {
  try {
    const value = JSON.parse(stderr) as unknown;
    if (plainObject(value) && exactKeys(value, ["code", "message"]) &&
        typeof value.code === "string" && /^[a-z0-9-]{1,64}$/.test(value.code)) return value.code;
  } catch { /* intentionally collapse native details */ }
  return "native-failure";
}

function validateKeyId(keyId: string): void {
  if (!/^windows-tpm:Kionel\.[A-Za-z0-9][A-Za-z0-9._-]{0,79}\.v2$/.test(keyId)) {
    throw new Error("Windows TPM keyId is outside the Kionel namespace");
  }
}

function b64url(value: Uint8Array): string { return Buffer.from(value).toString("base64url") }

function unb64url(value: string, expectedLength: number, field: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes("=")) throw new Error(`Windows TPM ${field} is not canonical base64url`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== expectedLength || decoded.toString("base64url") !== value) {
    throw new Error(`Windows TPM ${field} has an invalid length or encoding`);
  }
  return new Uint8Array(decoded);
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value) && value.length === expected.length && value.every((item, index) => item === expected[index]);
}
