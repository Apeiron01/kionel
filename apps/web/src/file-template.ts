/**
 * Klasöre kayıtta dosya adı şablonu. LIMS ve veri sistemlerinin içe aktarıcıları
 * dosyayı çoğu zaman adından eşler ("WO-004213_sonuc.csv"); alanlar imzalı
 * kayıttan gelir, elle yeniden adlandırma gerekmez. Uzantı her zaman korunur.
 * Saf fonksiyonlar, birim testli.
 */
export const TEMPLATE_FIELDS = ["name", "workorder", "class", "operator", "date", "time"];
export const DEFAULT_TEMPLATE = "{name}";

/** Şablon kullanılamıyorsa nedenini döndürür. */
export function checkTemplate(template: string): string | undefined {
  if (template.length > 120) return "the pattern is longer than 120 characters";
  const unknown = [...template.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).find((field) => !TEMPLATE_FIELDS.includes(field));
  if (unknown !== undefined) return `{${unknown}} is not a field; use ${TEMPLATE_FIELDS.map((f) => `{${f}}`).join(" ")}`;
  return undefined;
}

const EMPTY = "\u0000";
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Şablonu doldurur. Boş kalan alan yanındaki ayırıcıyla birlikte düşer:
 * "{workorder}_{name}" iş emri yoksa "_sonuc.csv" değil "sonuc.csv" olur.
 */
export function applyTemplate(
  template: string,
  f: { name: string; at: Date; reference?: string; classification?: string; operator?: string },
): string {
  const dot = f.name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [f.name.slice(0, dot), f.name.slice(dot)] : [f.name, ""];
  const values: Record<string, string | undefined> = {
    name: stem, workorder: f.reference, class: f.classification, operator: f.operator,
    date: `${f.at.getFullYear()}-${pad(f.at.getMonth() + 1)}-${pad(f.at.getDate())}`,
    time: `${pad(f.at.getHours())}${pad(f.at.getMinutes())}${pad(f.at.getSeconds())}`,
  };
  const filled = template.replace(/\{(\w+)\}/g, (_, key: string) => values[key]?.trim() || EMPTY)
    .replace(/[ _.-]*\u0000(?:[ _.-]*\u0000)*[ _.-]*/g, (run: string, at: number, all: string) =>
      at === 0 || at + run.length === all.length ? "" : (/[ _.-]/.exec(run)?.[0] ?? ""));
  return `${filled.trim() || stem}${ext}`;
}
