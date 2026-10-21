// SPDX-License-Identifier: AGPL-3.0-only
/** Exact sample-ID comparison. No case folding or automatic typo correction. */
export interface SampleComparison {
  schema: "kionel-sample-comparison/v1";
  expectedCount: number;
  receivedCount: number;
  missing: string[];
  unexpected: string[];
  duplicateExpected: string[];
  duplicateReceived: string[];
  matches: boolean;
}

export function sampleIds(text: string): string[] {
  if (text.length > 1_000_000) throw new Error("En fazla 1 MB metin kullanın.");
  const ids = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.length > 0);
  if (ids.length > 10_000) throw new Error("En fazla 10.000 kimlik kullanın.");
  if (ids.some((id) => id.length > 128 || id.trim() !== id || /[\u0000-\u001f\u007f]/.test(id))) {
    throw new Error("Her satıra tek kimlik yazın (en fazla 128 karakter); baş/son boşlukları açıkça düzeltin.");
  }
  return ids;
}

export function compareSamples(expectedText: string, receivedText: string): SampleComparison {
  const expected = sampleIds(expectedText);
  const received = sampleIds(receivedText);
  if (!expected.length || !received.length) throw new Error("İki liste de en az bir kimlik içermeli.");
  const count = (ids: string[]) => {
    const map = new Map<string, number>();
    for (const id of ids) map.set(id, (map.get(id) ?? 0) + 1);
    return map;
  };
  const a = count(expected), b = count(received);
  const missing = [...a.keys()].filter((id) => !b.has(id));
  const unexpected = [...b.keys()].filter((id) => !a.has(id));
  const duplicateExpected = [...a].filter(([, n]) => n > 1).map(([id]) => id);
  const duplicateReceived = [...b].filter(([, n]) => n > 1).map(([id]) => id);
  return {
    schema: "kionel-sample-comparison/v1", expectedCount: expected.length, receivedCount: received.length,
    missing, unexpected, duplicateExpected, duplicateReceived,
    matches: !(missing.length || unexpected.length || duplicateExpected.length || duplicateReceived.length),
  };
}
