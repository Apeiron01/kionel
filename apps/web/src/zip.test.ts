import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MANIFEST_NAME, bundleFiles } from "./zip.ts";

const python = (() => {
  for (const cmd of ["python", "python3"]) {
    try { execFileSync(cmd, ["--version"], { stdio: "ignore" }); return cmd; } catch { /* sonraki */ }
  }
  return undefined;
})();

const bytes = (text: string) => new TextEncoder().encode(text);

describe("çoklu dosya: ZIP + SHA-256 manifesti", () => {
  // Kendi okuyucumuz yalnız kendi yazıcımızla tutarlı olduğunu gösterirdi; bağımsız
  // bir uygulama (Python zipfile) dosyanın gerçekten geçerli bir ZIP olduğunu gösterir.
  it.skipIf(!python)("Python zipfile açar; içerik, adlar ve manifest doğru", async () => {
    const files = [
      { name: "run_041.csv", data: bytes("numune,sonuc\nA-1,0.8\n"), modified: new Date(2026, 8, 25, 10, 30, 12) },
      { name: "sonuç ölçüm.txt", data: bytes("ş ğ ı µ °C\n"), modified: new Date(2026, 8, 25, 10, 31, 0) },
      { name: "run_041.csv", data: bytes("ikinci kopya\n"), modified: new Date(2026, 8, 25, 10, 32, 0) },
    ];
    const zip = await bundleFiles(files);
    const dir = mkdtempSync(join(tmpdir(), "kionel-zip-"));
    const path = join(dir, "bundle.zip");
    writeFileSync(path, zip);
    const script = [
      "import sys, zipfile, hashlib, json",
      "z = zipfile.ZipFile(sys.argv[1])",
      "bad = z.testzip()",
      "out = {'bad': bad, 'names': z.namelist(), 'sha': {n: hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()},",
      "       'manifest': z.read(sys.argv[2]).decode('utf-8')}",
      "print(json.dumps(out))",
    ].join("\n");
    const result = JSON.parse(execFileSync(python!, ["-c", script, path, MANIFEST_NAME], { encoding: "utf8" }));
    expect(result.bad).toBeNull();
    expect(result.names).toEqual(["run_041.csv", "sonuç ölçüm.txt", "run_041 (2).csv", MANIFEST_NAME]);
    const sha = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
    expect(result.sha["run_041.csv"]).toBe(sha(files[0].data));
    expect(result.sha["run_041 (2).csv"]).toBe(sha(files[2].data));
    // sha256sum -c biçimi: "<özet>  <ad>"
    expect(result.manifest).toBe(
      `${sha(files[0].data)}  run_041.csv\n${sha(files[1].data)}  sonuç ölçüm.txt\n${sha(files[2].data)}  run_041 (2).csv\n`);
  });
});
