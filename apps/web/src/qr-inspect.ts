/**
 * Bir QR kodun içinde ne olduğunu sınıflandırır: parola, tek kullanımlık kod sırrı,
 * belirteç taşıyan bağlantı, özel anahtar; ya da insanın okuyamadığı bir yığın.
 * Hiçbir şeyi çözmeye çalışmaz: "okunamıyor" ile "şifreli" arasındaki farkı bir araç
 * dışarıdan bilemez, bunu da söyler.
 */
export type QrKind = "wifi" | "wifi-open" | "otp" | "otp-export" | "link-secret" | "private-key" | "link" | "contact" | "opaque" | "text";
/** secret: kodu gören sırrı da görür. opaque: bilinemez. plain: gizli bir şey bulunmadı. */
export type QrLevel = "secret" | "opaque" | "plain";

export interface QrFinding {
  kind: QrKind;
  level: QrLevel;
  /** Kodun metni; UTF-8 değilse onaltılık döküm. */
  text: string;
  /** Türe göre: ağ adı ya da sır taşıyan parametrenin adı. */
  detail: string;
  bytes: number;
}

const SECRET_PARAM = /^(pass(word|wd)?|pwd|token|access_token|id_token|secret|api_?key|key|sig(nature)?|auth|session(id)?)$/i;

/** WIFI:T:WPA;S:ad;P:parola;; — ayırıcılar ters eğik çizgiyle kaçırılabilir. */
function wifiField(text: string, name: string): string {
  const match = new RegExp(`(?:^WIFI:|;)${name}:((?:\\\\.|[^;\\\\])*)`, "i").exec(text);
  return match ? match[1]!.replace(/\\(.)/g, "$1") : "";
}

function secretParam(text: string): string | undefined {
  let url: URL;
  try { url = new URL(text); } catch { return undefined; }
  if (url.password) return "password";
  // Belirteçler çoğu zaman # sonrasına konur; ikisine de bakılır.
  for (const part of [url.search.slice(1), url.hash.slice(1)]) {
    for (const [name, value] of new URLSearchParams(part)) {
      if (SECRET_PARAM.test(name) && value.length >= 8) return name;
    }
  }
  return undefined;
}

export function inspectQr(bytes: Uint8Array): QrFinding {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    const hex = Array.from(bytes.subarray(0, 64), (b) => b.toString(16).padStart(2, "0")).join(" ");
    return { kind: "opaque", level: "opaque", text: bytes.length > 64 ? `${hex} …` : hex, detail: "", bytes: bytes.length };
  }
  const found = (kind: QrKind, level: QrLevel, detail = ""): QrFinding => ({ kind, level, text, detail, bytes: bytes.length });
  const trimmed = text.trim();

  if (/^WIFI:/i.test(trimmed)) {
    const ssid = wifiField(trimmed, "S");
    return wifiField(trimmed, "P") && !/^nopass$/i.test(wifiField(trimmed, "T")) ? found("wifi", "secret", ssid) : found("wifi-open", "plain", ssid);
  }
  if (/^otpauth-migration:\/\//i.test(trimmed)) return found("otp-export", "secret");
  if (/^otpauth:\/\//i.test(trimmed)) return found("otp", "secret");
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(trimmed) || /^[5KL][1-9A-HJ-NP-Za-km-z]{50,51}$/.test(trimmed)) return found("private-key", "secret");
  // Cüzdan kurtarma cümlesi: 12–24 kısa küçük harfli sözcük. Sözlük taşımadan, biçimden tanınır.
  const words = trimmed.split(/\s+/);
  if ([12, 15, 18, 21, 24].includes(words.length) && words.every((word) => /^[a-z]{3,8}$/.test(word))) return found("private-key", "secret");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    const name = secretParam(trimmed);
    return name ? found("link-secret", "secret", name) : found("link", "plain");
  }
  if (/^(BEGIN:VCARD|MECARD:)/i.test(trimmed)) return found("contact", "plain");
  // Boşluksuz, uzun ve yalnız kodlama alfabesinden: insan için anlamsız bir yığın.
  if (trimmed.length >= 24 && /^[A-Za-z0-9+/_=-]+$/.test(trimmed)) return found("opaque", "opaque");
  return found("text", "plain");
}
