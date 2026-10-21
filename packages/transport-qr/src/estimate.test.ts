import { describe, expect, it } from "vitest";
import {
  MAX_CONTENT_LIMIT_BYTES, RESUMABLE_ABOVE_SECONDS,
  durationLabel, estimateTransfer, formatBytes,
} from "./estimate.ts";

describe("aktarım süresi tahmini", () => {
  it("protokolün taşıyabildiği dosya reddedilmez, süresi söylenir", () => {
    // Sınır ürünü değil, kullanıcının sabrini ilgilendirir: tavana kadar kabul
    // ediyoruz ama süreyi başlamadan önce söylüyoruz.
    const ceiling = estimateTransfer(MAX_CONTENT_LIMIT_BYTES, { version: 27, hold: 2 });
    expect(ceiling.seconds).toBeGreaterThan(RESUMABLE_ABOVE_SECONDS);
    expect(ceiling.needsResume).toBe(true);
    expect(ceiling.label).toMatch(/hours|minutes/);
  });

  it("kısa aktarımda ara verme önerilmez", () => {
    const quick = estimateTransfer(200_000, { version: 27, hold: 2 });
    expect(quick.needsResume).toBe(false);
    expect(estimateTransfer(5 * 1024 * 1024, { version: 27, hold: 2 }).needsResume).toBe(true);
  });

  it("daha büyük dosya daha uzun sürer", () => {
    const small = estimateTransfer(100_000, { version: 27, hold: 2 });
    const large = estimateTransfer(1_000_000, { version: 27, hold: 2 });
    expect(large.seconds).toBeGreaterThan(small.seconds * 5);
  });

  it("düşük kare hızı süreyi uzatır, yüksek QR sürümü kısaltır", () => {
    const base = estimateTransfer(500_000, { version: 27, hold: 2 });
    expect(estimateTransfer(500_000, { version: 27, hold: 4 }).seconds).toBeGreaterThan(base.seconds);
    expect(estimateTransfer(500_000, { version: 40, hold: 2 }).seconds).toBeLessThan(base.seconds);
  });

  it("30 fps ve %25 kayıp varsayımını model olarak etiketler", () => {
    const { bytesPerSecond } = estimateTransfer(1_000_000, { version: 27, hold: 2 });
    expect(bytesPerSecond).toBeGreaterThan(20_000);
    expect(bytesPerSecond).toBeLessThan(45_000);
    expect(estimateTransfer(1_000_000, { version: 27, hold: 2 }).basis).toBe("model");
  });

  it("süreyi olduğundan hassas göstermez", () => {
    expect(durationLabel(0.4)).toBe("under a second");
    expect(durationLabel(37)).toBe("about 37 seconds");
    expect(durationLabel(277)).toBe("about 5 minutes");
    expect(durationLabel(5400)).toBe("about 1.5 hours");
  });

  it("boyutu okunur biçimde yazar", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});

describe("büyük ekran profili", () => {
  it("dört kod aynı anda gösterilince süre dörde bölünür", () => {
    const phone = estimateTransfer(5 * 1024 * 1024, { version: 27, hold: 2, tiles: 1 });
    const monitor = estimateTransfer(5 * 1024 * 1024, { version: 27, hold: 2, tiles: 4 });
    // Tam eşitlik değil: hız yuvarlanmış bir sayı, dolayısıyla birkaç baytlık
    // sapma beklenir. Önemli olan oranın dört olması.
    expect(monitor.bytesPerSecond / phone.bytesPerSecond).toBeCloseTo(4, 3);
    expect(monitor.seconds).toBeCloseTo(phone.seconds / 4, 0);
  });

  it("tüm dokuz kod okunabiliyorsa model daha kısa süre hesaplar", () => {
    expect(estimateTransfer(5 * 1024 * 1024, { version: 27, hold: 2, tiles: 1 }).needsResume).toBe(true);
    expect(estimateTransfer(5 * 1024 * 1024, { version: 40, hold: 1, tiles: 9 }).needsResume).toBe(false);
  });

  it("30 fps kamera için 60 fps gösterim hız kazancı varsaymaz", () => {
    expect(estimateTransfer(1_000_000, { version: 27, hold: 1 }).seconds)
      .toBe(estimateTransfer(1_000_000, { version: 27, hold: 2 }).seconds);
  });
  it("çoklu kodun toplam çözüm süresi hızı sınırlayabilir", () => {
    const base = estimateTransfer(1_000_000, { version: 27, hold: 2 });
    const slow = estimateTransfer(1_000_000, { version: 27, hold: 2, tiles: 4, decodeMs: 200 });
    expect(slow.seconds).toBeGreaterThan(base.seconds);
  });
  it("NaN, sonsuz ve desteklenmeyen model girdilerini reddeder", () => {
    for (const value of [NaN, Infinity, -1]) expect(() => estimateTransfer(value, { version: 27, hold: 2 })).toThrow();
    expect(() => estimateTransfer(1, { version: 27, hold: 2, tiles: 2 })).toThrow();
    expect(() => estimateTransfer(1, { version: 27, hold: NaN })).toThrow();
    expect(() => estimateTransfer(1, { version: 27, hold: 2, lossRate: 1 })).toThrow();
  });

  it("döşeme verilmezse davranış değişmez", () => {
    const withoutTiles = estimateTransfer(1_000_000, { version: 27, hold: 2 });
    const oneTile = estimateTransfer(1_000_000, { version: 27, hold: 2, tiles: 1 });
    expect(withoutTiles).toEqual(oneTile);
  });
});
