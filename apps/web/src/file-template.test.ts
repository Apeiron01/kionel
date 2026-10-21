import { describe, expect, it } from "vitest";
import { applyTemplate, checkTemplate, DEFAULT_TEMPLATE } from "./file-template.ts";

const at = new Date(2026, 8, 25, 9, 5, 7);
const full = { name: "sonuc.csv", at, reference: "WO-004213", classification: "restricted", operator: "QC-017" };

describe("dosya adı şablonu", () => {
  it("alanları doldurur, uzantıyı korur; varsayılan adı değiştirmez", () => {
    expect(applyTemplate(DEFAULT_TEMPLATE, full)).toBe("sonuc.csv");
    expect(applyTemplate("{workorder}_{name}", full)).toBe("WO-004213_sonuc.csv");
    expect(applyTemplate("{date}_{time}_{operator}_{class}_{name}", full)).toBe("2026-09-25_090507_QC-017_restricted_sonuc.csv");
    expect(applyTemplate("{name}", { name: "README", at })).toBe("README");
  });

  it("boş alan ayırıcısıyla düşer; hepsi boşsa özgün ad kalır", () => {
    const bare = { name: "sonuc.csv", at };
    expect(applyTemplate("{workorder}_{name}", bare)).toBe("sonuc.csv");
    expect(applyTemplate("{name}_{workorder}", bare)).toBe("sonuc.csv");
    expect(applyTemplate("{date}_{workorder}_{operator}_{name}", bare)).toBe("2026-09-25_sonuc.csv");
    expect(applyTemplate("{workorder}{operator}", bare)).toBe("sonuc.csv");
    // Adın kendi içindeki ayırıcılara dokunulmaz.
    expect(applyTemplate("{name}", { name: "a__b-.csv", at })).toBe("a__b-.csv");
  });

  it("bilinmeyen alan ve aşırı uzunluk reddedilir", () => {
    expect(checkTemplate("{workorder}_{name}")).toBeUndefined();
    expect(checkTemplate("{wo}_{name}")).toMatch(/\{wo\} is not a field/);
    expect(checkTemplate("x".repeat(121))).toMatch(/longer than 120/);
  });
});
