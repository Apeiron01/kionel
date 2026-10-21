import { readFileSync, writeFileSync } from "node:fs";
import { importIdentity, verifyMethodRelease, type MethodRelease } from "@kionel/crypto";
import { approveMethodRelease, issueMethodRelease } from "@kionel/issue";
import { requireProductionLicense } from "./license-access.ts";

const args = process.argv.slice(2);
const option = (name: string) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const required = (name: string) => option(name) ?? (() => { throw new Error(`--${name}=... gerekli`); })();
const json = (path: string) => JSON.parse(readFileSync(path, "utf8")) as unknown;
const identity = async () => importIdentity(json(required("identity")) as JsonWebKey);
const save = (value: unknown) => {
  const path = required("out");
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  console.log(`Metot paketi yazıldı: ${path}`);
};

async function main(): Promise<void> {
  const [command, file] = args.filter(a => !a.startsWith("--"));
  if (!file || !["prepare", "approve", "check"].includes(command)) throw new Error(
    "pnpm method prepare|approve|check <dosya> — kullanım: METHOD-RELEASE.md",
  );
  // Hazırlamak ve onaylamak üretimdir; `check` salt doğrulamadır ve lisans istemez.
  if (command !== "check") await requireProductionLicense(option("license"));
  const content = new Uint8Array(readFileSync(file));
  if (command === "prepare") {
    save(await issueMethodRelease(await identity(), content, {
      methodId: required("method"), target: required("target"), revision: Number(required("revision")),
      notBefore: new Date().toISOString(), expiresAt: required("expires"),
    }));
    console.log("İnceleme ve serbest bırakma onayları henüz yok.");
  } else if (command === "approve") {
    save(await approveMethodRelease(await identity(), json(required("release")) as MethodRelease, content));
  } else {
    const verdict = await verifyMethodRelease(json(required("release")), content, json(required("policy")));
    console.log(`${verdict.ok ? "KABUL" : "RED"}: ${verdict.reason}`);
    if (!verdict.ok) process.exitCode = 1;
  }
}

try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
