import { describe, expect, it } from "vitest";
import { compareFiles, countByKind, decode, parseCsv, scanOne } from "./excel-damage.ts";

describe("CSV okuma", () => {
  it("tırnak, alan içi ayırıcı ve satır sonu; noktalı virgül ve sekme tanınır", () => {
    expect(parseCsv('id,note\r\n"A,1","two\nlines"\r\n"say ""hi""",x').rows).toEqual([["id", "note"], ["A,1", "two\nlines"], ['say "hi"', "x"]]);
    expect(parseCsv("a;b\n1,5;2,5\n").delimiter).toBe(";");
    expect(parseCsv("a\tb\n1\t2").rows[1]).toEqual(["1", "2"]);
  });

  it("UTF-8 değilse eski kod sayfası olarak okunur ve söylenir", () => {
    expect(decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ text: "a", utf8: true });
    expect(decode(new Uint8Array([0x61, 0xb5, 0x67]))).toEqual({ text: "aµg", utf8: false });
  });
});

describe("tek dosyada Excel izleri", () => {
  const rows = parseCsv([
    "sample,gene,well,barcode,conc,note",
    "00123,1-Mar,2-Jan,1.23457E+18,1.2E-05,Ã¼bung",
    "00124,Sep-15,A1,1234567890123450000,0.8,ok",
    "00125,TP53,B2,4006381333931,0.80,µg/L",
    "126,EGFR,C3,4006381333932,12,ok",
    "00127,BRCA1,D4,4006381333933,1-Jan-2026,ok",
  ].join("\n")).rows;
  const findings = scanOne(rows);

  it("gen adı, tarih, bilimsel gösterim, 15 hane, baştaki sıfır ve kodlama bulunur", () => {
    const at = (row: number, column: string) => findings.find((f) => f.row === row && f.column === column);
    expect(at(2, "gene")).toMatchObject({ kind: "gene-date", original: "MARCH1 (now MARCHF1)" });
    expect(at(3, "gene")).toMatchObject({ kind: "gene-date", original: "SEPT15 (now SEPTIN15)" });
    expect(at(2, "well")).toMatchObject({ kind: "date", original: expect.stringMatching(/^1-2/) });
    expect(at(2, "barcode")?.kind).toBe("sci");
    expect(at(3, "barcode")?.kind).toBe("digits");
    expect(at(5, "sample")).toMatchObject({ kind: "zeros", original: "00126" });
    expect(at(2, "note")?.kind).toBe("encoding");
  });

  it("gerçek ölçüm değerlerine ve sağlam hücrelere dokunmaz", () => {
    // 1.2E-05 bir derişim, 13 haneli EAN, µ doğru kodlanmış, tam tarih bir tarih.
    expect(findings.filter((f) => ["conc", "barcode"].includes(f.column) && f.row >= 4)).toEqual([]);
    expect(findings.some((f) => f.column === "conc")).toBe(false);
    expect(findings.some((f) => f.row === 4)).toBe(false);
    expect(countByKind(findings)).toEqual({ "gene-date": 2, date: 1, sci: 1, digits: 1, zeros: 1, encoding: 1 });
  });
});

describe("özgünle karşılaştırma", () => {
  it("her değişen hücre nedeniyle; boyut farkı ayrıca", () => {
    const original = parseCsv("id,gene,result,barcode,name\n00123,SEPT2,0.80,1234567890123456789,Müller\n00124,TP53,1.5,1,x\n").rows;
    const after = parseCsv("id,gene,result,barcode,name\n123,2-Sep,0.8,1.23457E+18,MÃ¼ller\n00124,TP53,1.6,1, x\n00125,,,,\n").rows;
    const findings = compareFiles(original, after);
    expect(findings.map((f) => [f.row, f.column, f.kind])).toEqual([
      [0, "", "shape"],
      [2, "id", "zeros"], [2, "gene", "gene-date"], [2, "result", "number-format"], [2, "barcode", "digits"], [2, "name", "encoding"],
      [3, "result", "changed"], [3, "name", "spaces"],
    ]);
    expect(compareFiles(original, original)).toEqual([]);
  });
});

describe("Türkçe ve Almanca Excel tarihleri", () => {
  it("noktalı ondalık tarihe dönmüşse özgünü tahmin edilir; gen adı sanılmaz", () => {
    const findings = scanOne(parseCsv("a;b;c\n01.Ara;12.May;01.Mar\n0,8;1.Mrz;Eyl-15\n").rows);
    expect(findings.map((f) => [f.value, f.kind, f.original])).toEqual([
      ["01.Ara", "date", "1.12 (a decimal number)"],
      ["12.May", "date", "12.5 (a decimal number)"],
      ["01.Mar", "date", "1.3 (a decimal number)"],
      ["1.Mrz", "date", "1.3 (a decimal number)"],
      ["Eyl-15", "gene-date", "SEPT15 (now SEPTIN15)"],
    ]);
  });
});

describe("baştaki sıfırlar, az satırda", () => {
  it("üç satırın ikisi sıfırlıysa kısa kalan işaretlenir; tek sıfırlı değer yetmez", () => {
    expect(scanOne(parseCsv("id\n123\n00124\n00125\n").rows).map((f) => f.original)).toEqual(["00123"]);
    expect(scanOne(parseCsv("id\n123\n124\n00125\n").rows)).toEqual([]);
  });
});

describe("Almanca Excel: nokta ve boşlukla ay", () => {
  it("01. Dez ve 12. Mai ondalık sayı olarak tahmin edilir", () => {
    const findings = scanOne(parseCsv("a;b\n01. Dez;12. Mai\n").rows);
    expect(findings.map((f) => [f.value, f.kind, f.original])).toEqual([
      ["01. Dez", "date", "1.12 (a decimal number)"],
      ["12. Mai", "date", "12.5 (a decimal number)"],
    ]);
  });
});
