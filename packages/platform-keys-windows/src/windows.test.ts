import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PinnedWindowsHostTransport, WindowsTpmBridge, decodeCapabilities, decodeRecord,
  windowsHostArtifactSha256, type WindowsHostTransport,
} from "./index.js";

const publicKey = new Uint8Array(65);
publicKey[0] = 4;
const record = {
  providerId: "windows-cng-platform",
  keyId: "windows-tpm:Kionel.lab-terminal-7.v2",
  algorithm: "ecdsa-p256-sha256",
  publicKey: Buffer.from(publicKey).toString("base64url"),
  securityLevel: "tpm",
  persistence: "persistent",
  requiresUserPresence: true,
};

describe("Windows TPM native bridge", () => {
  it("decodes only fail-closed, non-attested capabilities", () => {
    expect(decodeCapabilities({
      providerId: "windows-cng-platform", algorithms: ["ecdsa-p256-sha256"], securityLevels: ["tpm"],
      supportsAttestation: false, attestationStatus: "not-implemented",
    })).toMatchObject({ providerId: "windows-cng-platform", supportsAttestation: false });
    expect(() => decodeCapabilities({
      providerId: "windows-cng-platform", algorithms: ["ecdsa-p256-sha256"], securityLevels: ["tpm"],
      supportsAttestation: true, attestationStatus: "verified",
    })).toThrow("overclaim");
  });

  it("maps provision/sign/load/remove without exposing private material", async () => {
    const operations: { operation: string; body: unknown }[] = [];
    const transport: WindowsHostTransport = {
      async invoke(operation, body) {
        operations.push({ operation, body });
        if (operation === "provision") return record;
        if (operation === "sign") return { signature: Buffer.alloc(64, 7).toString("base64url") };
        if (operation === "load") return record;
        if (operation === "remove") return { removed: true };
        throw new Error("unexpected operation");
      },
    };
    const bridge = new WindowsTpmBridge(transport);
    const provisioned = await bridge.provision({
      alias: "lab-terminal-7", algorithm: "ecdsa-p256-sha256", requireUserPresence: true,
      attestationChallenge: new Uint8Array(32),
    });
    expect(provisioned).toMatchObject({ securityLevel: "tpm", persistence: "persistent", requiresUserPresence: true });
    expect(await bridge.sign(record.keyId, "ecdsa-p256-sha256", new Uint8Array([1, 2, 3]))).toHaveLength(64);
    expect(await bridge.load(record.keyId)).toMatchObject({ keyId: record.keyId });
    await bridge.remove(record.keyId);
    expect(JSON.stringify(operations)).not.toMatch(/privateKey|private-key/);
    expect(operations.map((item) => item.operation)).toEqual(["provision", "sign", "load", "remove"]);
  });

  it("rejects foreign providers, extra fields and malformed signatures", async () => {
    expect(() => decodeRecord({ ...record, providerId: "software-provider" })).toThrow();
    expect(() => decodeRecord({ ...record, unexpected: true })).toThrow();
    const bridge = new WindowsTpmBridge({
      async invoke() { return { signature: Buffer.alloc(63).toString("base64url") } },
    });
    await expect(bridge.sign(record.keyId, "ecdsa-p256-sha256", new Uint8Array())).rejects.toThrow("invalid length");
  });

  it("pins the DLL and both runtime metadata files before process launch", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kionel-host-pin-"));
    const dll = join(directory, "Kionel.WindowsKeyHost.dll");
    try {
      await writeFile(dll, "host");
      await writeFile(join(directory, "Kionel.WindowsKeyHost.deps.json"), "deps-v1");
      await writeFile(join(directory, "Kionel.WindowsKeyHost.runtimeconfig.json"), "runtime-v1");
      const first = await windowsHostArtifactSha256(dll);
      await writeFile(join(directory, "Kionel.WindowsKeyHost.deps.json"), "deps-v2");
      const second = await windowsHostArtifactSha256(dll);
      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(second).not.toBe(first);
      const transport = new PinnedWindowsHostTransport({ hostPath: dll, expectedSha256: first });
      await expect(transport.invoke("capabilities")).rejects.toThrow("pinned release artifact");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
