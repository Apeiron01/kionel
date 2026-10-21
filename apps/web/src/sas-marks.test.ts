import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SAS_MARK_TOTAL, sasMarkName, sasMarksSpoken } from "./sas-marks.ts";

const source = readFileSync(new URL("./sas-marks.ts", import.meta.url), "utf8");
const paths = [...source.matchAll(/^ {2}"(M[^"]+)",/gm)].map((match) => match[1]);

describe("SAS işaretleri", () => {
  it("tam 32 işaret taşır — sembol başına 5 bit", () => {
    expect(SAS_MARK_TOTAL).toBe(32);
    expect(paths).toHaveLength(32);
  });

  it("her işaretin bir adı vardır", () => {
    for (let index = 0; index < SAS_MARK_TOTAL; index++) {
      expect(sasMarkName(index)).not.toBe("unknown");
    }
  });

  it("iki işaret aynı çizimi paylaşmaz", () => {
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(Array.from({ length: SAS_MARK_TOTAL }, (_, i) => sasMarkName(i))).size).toBe(SAS_MARK_TOTAL);
  });

  it("hiçbir işaret emoji veya harf dışı gliflere dayanmaz", () => {
    // Asıl hata buydu: emoji bir resim değil, bir kod noktasıdır ve her
    // platformda farklı çizilir. Karşılaştırma kodu glif içeremez.
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
    for (const path of paths) expect(path).toMatch(/^[MALQTHVZ0-9 .,-]+$/);
  });

  it("sesli okuma sırayı korur", () => {
    const spoken = sasMarksSpoken([0, 1, 2, 3, 4]);
    expect(spoken).toBe("1. triangle, 2. square, 3. circle, 4. diamond, 5. plus");
  });
});
