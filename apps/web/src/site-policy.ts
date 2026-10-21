/**
 * Site politikası: kalite ya da BT biriminin hazırladığı bir dosya, gönderen
 * tarafta hangi dosyaların ve bağlamın kabul edileceğini söyler (izin verilen
 * türler, boyut, iş emri biçimi, sınıflar). USB kiosk'larının "dosya türü
 * politikası"nın karşılığı.
 *
 * Bu bir erişim denetimi değil, bir hata önleyicidir: tarayıcıdaki kullanıcı
 * politikayı kaldırabilir. O yüzden hangi politikanın etkin olduğu her
 * aktarımda günlüğe yazılır; gözden geçiren politikasız aktarımı görür.
 * Saf fonksiyonlar, birim testli.
 */
export interface SitePolicy {
  kind: "kionel-policy";
  version: 1;
  name: string;
  revision?: string;
  allowedExtensions?: string[];
  maxBytes?: number;
  referencePattern?: string;
  referenceHint?: string;
  classifications?: string[];
  /** true ise her gönderimde operatör (ad ya da kimlik) yazılmalı. */
  requireOperator?: boolean;
}

const KEYS = new Set(["kind", "version", "name", "revision", "allowedExtensions", "maxBytes", "referencePattern", "referenceHint", "classifications", "requireOperator"]);
const CLASSES = new Set(["internal", "confidential", "restricted"]);

/** Politika metnini doğrular; sorun varsa politikayı yazan kişinin düzeltebileceği bir cümleyle reddeder. */
export function parsePolicy(text: string): SitePolicy {
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("the file is not valid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("the file is not a Kionel site policy");
  const p = value as Record<string, unknown>;
  if (p.kind !== "kionel-policy" || p.version !== 1) throw new Error('it must contain "kind": "kionel-policy" and "version": 1');
  const unknown = Object.keys(p).filter((key) => !KEYS.has(key));
  if (unknown.length) throw new Error(`unknown field "${unknown[0]}" (check the spelling)`);
  if (typeof p.name !== "string" || !p.name.trim() || p.name.length > 80) throw new Error('"name" must be text, up to 80 characters');
  if (p.revision !== undefined && (typeof p.revision !== "string" || p.revision.length > 40)) throw new Error('"revision" must be text, up to 40 characters');
  if (p.allowedExtensions !== undefined) {
    if (!Array.isArray(p.allowedExtensions) || !p.allowedExtensions.length ||
        !p.allowedExtensions.every((e) => typeof e === "string" && /^[a-z0-9]{1,10}$/.test(e))) {
      throw new Error('"allowedExtensions" must list extensions in lower case without dots, e.g. ["csv", "pdf"]');
    }
  }
  if (p.maxBytes !== undefined && (!Number.isSafeInteger(p.maxBytes) || (p.maxBytes as number) < 1)) {
    throw new Error('"maxBytes" must be a whole number of bytes, e.g. 10485760 for 10 MB');
  }
  if (p.referencePattern !== undefined) {
    if (typeof p.referencePattern !== "string" || p.referencePattern.length > 200) throw new Error('"referencePattern" must be text, up to 200 characters');
    try { new RegExp(p.referencePattern); } catch { throw new Error('"referencePattern" is not a valid regular expression'); }
  }
  if (p.referenceHint !== undefined && (typeof p.referenceHint !== "string" || p.referenceHint.length > 120)) {
    throw new Error('"referenceHint" must be text, up to 120 characters');
  }
  if (p.classifications !== undefined) {
    if (!Array.isArray(p.classifications) || !p.classifications.length || !p.classifications.every((c) => typeof c === "string" && CLASSES.has(c))) {
      throw new Error('"classifications" must list some of "internal", "confidential", "restricted"');
    }
  }
  if (p.requireOperator !== undefined && typeof p.requireOperator !== "boolean") throw new Error('"requireOperator" must be true or false');
  return p as unknown as SitePolicy;
}

const extension = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** Dosya politikaya uymuyorsa nedenini döndürür. */
export function checkFile(policy: SitePolicy, name: string, bytes: number): string | undefined {
  if (policy.allowedExtensions && !policy.allowedExtensions.includes(extension(name))) {
    return `${name}: the site policy "${policy.name}" allows only ${policy.allowedExtensions.map((e) => `.${e}`).join(", ")} files`;
  }
  if (policy.maxBytes !== undefined && bytes > policy.maxBytes) {
    return `${name}: the site policy "${policy.name}" allows files up to ${formatSize(policy.maxBytes)}`;
  }
  return undefined;
}

/** İş emri ve sınıf politikaya uymuyorsa nedenini döndürür. */
export function checkContext(policy: SitePolicy, context: { reference?: string; classification?: string; operator?: string }): string | undefined {
  // Tam eşleşme: politikayı yazan ^ ve $ koymayı unutsa da kısmi eşleşme geçmez.
  if (policy.referencePattern && !new RegExp(`^(?:${policy.referencePattern})$`).test(context.reference ?? "")) {
    return `the work order does not match the site policy "${policy.name}"${policy.referenceHint ? `: ${policy.referenceHint}` : ""}`;
  }
  if (policy.classifications && !policy.classifications.includes(context.classification ?? "")) {
    return `the site policy "${policy.name}" allows the classification ${policy.classifications.join(" or ")}`;
  }
  if (policy.requireOperator && !context.operator) return `the site policy "${policy.name}" requires the operator's name or ID`;
  return undefined;
}

export function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${+(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

/** Politikanın insanın okuyacağı özeti. */
export function describePolicy(policy: SitePolicy): string {
  const parts = [
    policy.allowedExtensions ? `files ${policy.allowedExtensions.map((e) => `.${e}`).join(", ")}` : "any file type",
    policy.maxBytes !== undefined ? `up to ${formatSize(policy.maxBytes)}` : "",
    policy.referencePattern ? `work order ${policy.referenceHint ?? "in the required format"}` : "",
    policy.classifications ? `classification ${policy.classifications.join("/")}` : "",
    policy.requireOperator ? "operator required" : "",
  ].filter(Boolean);
  return `Site policy "${policy.name}"${policy.revision ? ` (${policy.revision})` : ""}: ${parts.join("; ")}.`;
}

/** Günlükte politikayı adıyla ve revizyonuyla anmak için. */
export const policyLabel = (policy: SitePolicy) => `${policy.name}${policy.revision ? ` (${policy.revision})` : ""}`;
