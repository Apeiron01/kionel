import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { KIONEL_V2_PROTOCOL, p256KeyReferenceFromPublicKey } from "@kionel/crypto";

/**
 * Marka adı değişebilir; tel biçimi değişemez.
 *
 * "Kionel" adı bugün iki ayrı yerde geçiyor ve ikisi bambaşka şeyler:
 *
 *  - Kozmetik olan: paket adları, dosya başlıkları, site metni, lisans metni.
 *    Bunların hepsi bir oturumda toplu değiştirilebilir; nitekim bu depo bir kez
 *    PHOS'tan Kionel'e geçti.
 *
 *  - Kozmetik OLMAYAN: aşağıdaki dizeler. Bunlar ya imzalanan kanonik baytların
 *    içine giriyor ya da HKDF etiketleri olarak türetilen anahtarları belirliyor.
 *    Birini değiştirmek, o güne kadar üretilmiş HER kaydın doğrulamasını bozar ve
 *    eski istemcilerle yeni istemcilerin farklı SAS üretmesine yol açar — yani
 *    sessizce uyumsuz iki ürün oluşur.
 *
 * Bu ayrım şu anda ticari olarak önemli: marka tescili ertelendiği için ismin
 * ileride değişmesi gerçek bir ihtimal. O gün gelirse yapılacak iş "her yerde
 * ara-değiştir" olacak ve bu test tam olarak o hareketi durdurmak için var.
 * Yeniden adlandırma ucuz kalsın diye yazıldı, pahalı olsun diye değil.
 *
 * Kırılırsa doğru tepki dizeyi teste uydurmak DEĞİL: markayı değiştirip tel
 * biçimini olduğu gibi bırakmaktır. Tel biçimini gerçekten değiştirmek gerekirse
 * yeni bir protokol sürümü açılır (v1 ve v2 yan yana yaşıyor, örnek burada).
 */
const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Yorumlar elenir: bir sabitin ADI yorumda geçtiği için testin geçmesi, sabitin
 * kodda durduğu anlamına gelmez. Ayrıca sabitlerin bir kısmı çift tırnakta, bir
 * kısmı şablon dizesinde duruyor; tırnak biçimine bağlanmamak için ham metinde
 * aranıyorlar.
 */
const source = (path: string) =>
  readFileSync(join(ROOT, path), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

/** İmzalanan baytların içine giren etiketler. Dosya yolu → dondurulmuş dizeler. */
const SIGNED_TAGS: Record<string, readonly string[]> = {
  "packages/crypto/src/audit.ts": ["kionel-audit", "kionel-receipt"],
  "packages/crypto/src/audit-v2.ts": ["KIONEL-V2-AUDIT", "KIONEL-V2-AUDIT-ENTRY"],
  "packages/crypto/src/evidence-v2.ts": [
    "kionel-v2", "urn:kionel:key:sha256:",
    "KIONEL-V2-DISPATCH", "KIONEL-V2-RECEIPT", "KIONEL-V2-COMPLETE-RECEIPT",
  ],
  "packages/crypto/src/qualification-evidence.ts": ["kionel-qualification-evidence"],
  "packages/crypto/src/qualification-evidence-v2.ts": ["KIONEL-V2-QUALIFICATION"],
  "packages/crypto/src/method.ts": [
    "kionel-method/v1", "kionel-method-release/v1",
    "kionel-method-policy/v1", "kionel-method-approval/v1",
  ],
  "packages/issue/src/evidence.ts": ["kionel-method/v1", "kionel-method-release/v1"],
};

/**
 * HKDF etiketleri. Bunlar imzalanan baytlarda görünmez ama türetilen anahtarı
 * belirler: değişirse iki cihaz aynı el sıkışmadan FARKLI oturum anahtarı ve
 * farklı SAS üretir. Sessiz uyumsuzluk en pahalı hata türüdür, çünkü test değil
 * saha ortaya çıkarır.
 */
const HKDF_LABELS: Record<string, readonly string[]> = {
  "packages/issue/src/session-v1.ts": [
    "kionel/confirm", "kionel/content", "kionel/sas", "kionel/sas-emoji", "kionel/session",
  ],
  "packages/issue/src/session-v2.ts": [
    "kionel/v2/confirm", "kionel/v2/content",
    "kionel/v2/sas-digits", "kionel/v2/sas-symbols", "kionel/v2/session-id",
  ],
};

test.each(Object.entries({ ...SIGNED_TAGS, ...HKDF_LABELS }))(
  "%s içindeki tel sabitleri dondurulmuş",
  (path, literals) => {
    const text = source(path);
    for (const literal of literals) {
      expect(text, `${path}: "${literal}" tel sabiti kayboldu veya yeniden adlandırıldı`)
        .toContain(literal);
    }
  },
);

test("protokol tanımlayıcısı ve anahtar URN'si markadan bağımsız sabittir", async () => {
  // Kaynak taraması bir dizenin VAR olduğunu gösterir; bu iki kontrol onun
  // gerçekten dışarı çıkan değer olduğunu gösterir.
  expect(KIONEL_V2_PROTOCOL).toBe("kionel-v2");

  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  ) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const reference = await p256KeyReferenceFromPublicKey(raw);

  expect(reference.kid.startsWith("urn:kionel:key:sha256:")).toBe(true);
  expect(reference.alg).toBe("ES256");
});
