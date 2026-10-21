// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from "vitest";
import { createIdentity, type Bytes } from "@kionel/crypto";
import { expand, isShrunk, shrink } from "./compress.ts";
import { createTransferCode, openWithCode, sealWithCode } from "./oneway.ts";

const csv = (rows: number) => new TextEncoder().encode(
  "sample_id,analyte,result,unit\n" +
  Array.from({ length: rows }, (_, i) => `S-${String(i).padStart(5, "0")},Pb,${(i % 97) / 10},mg/kg`).join("\n"),
);
const random = (n: number) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) globalThis.crypto.getRandomValues(out.subarray(i, i + 65536));
  return out;
};

describe("aktarım öncesi sıkıştırma", () => {
  it("CSV en az 4 kat küçülür ve aynen geri açılır", async () => {
    const data = csv(20_000);
    const packed = await shrink(data);
    expect(packed.length * 4).toBeLessThan(data.length);
    expect(await expand(packed, data.length)).toEqual(data);
  });

  it("sıkışmayan veri (PDF, görüntü) ham kalır: yalnız 1 bayt büyür", async () => {
    const data = random(200_000);
    const packed = await shrink(data);
    expect(packed.length).toBe(data.length + 1);
    expect(await expand(packed, data.length)).toEqual(data);
  });

  it("açılan boyut sınırı aşarsa durur (sıkıştırma bombası)", async () => {
    const bomb = await shrink(new Uint8Array(20_000_000));
    expect(bomb.length).toBeLessThan(100_000);
    await expect(expand(bomb, 1_000_000)).rejects.toThrow(/larger than this device accepts/);
  });

  it("bilinmeyen biçim, sürüm farkı olarak açıklanır", async () => {
    await expect(expand(new Uint8Array([7, 1, 2]), 10)).rejects.toThrow(/different version/);
    expect(isShrunk(new Uint8Array([1, 0, 0]))).toBe(false); // eski zarfın ilk baytı
  });

  it("kodla gönderimde CSV ekrana sıkıştırılmış çıkar", async () => {
    const data = csv(20_000) as Bytes;
    const code = createTransferCode();
    const { wire } = await sealWithCode(await createIdentity(), code, { name: "results.csv", data },
      { profile: "lab", reference: "LIMS-1" });
    // Önceki biçim base64 yüzünden dosyadan %33 büyüktü; şimdi dörtte birinden küçük.
    expect(wire.length * 4).toBeLessThan(data.length);
    expect((await openWithCode(code, wire)).data).toEqual(data);
  }, 20_000);

  it("eski sürümün tek yönlü akışı net mesajla reddedilir", async () => {
    const old = new TextEncoder().encode("KIONEL-CODE-V1" + "x".repeat(80)) as Bytes;
    await expect(openWithCode(createTransferCode(), old)).rejects.toThrow(/older version/);
  });
});
