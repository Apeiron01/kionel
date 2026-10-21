# Kionel bağımsız güvenlik inceleme paketi

Bu belge denetimin yerine geçmez; dış denetçinin kapsamını ve teslim kanıtlarını sabitler.

## İnceleme kapsamı

- `packages/core`: tüm tel parserları, frame/CRC, fountain decoder, ACK ve yetenek müzakeresi.
- `packages/crypto`: X25519 el sıkışması, HKDF etiket ayrımı, AES-GCM, Ed25519 kimlik/sevk/makbuz/audit/qualification imzaları.
- `packages/platform-keys`: ürün anahtar politikaları, native bridge güven sınırı,
  attestation verifier/trust-store bağlama ve v1/v2 algoritma uyumluluk kapısı.
- `packages/sdk`: SAS kapısı, kaynak sınırları, sevk doğrulaması ve makbuz üretim sırası.
- `packages/transport-qr`: QR byte taşıması ve yerel WASM yükleme sınırı.
- `apps/web`: kamera/ekran akışı, IndexedDB anahtar saklama, CSP ve dosya dışa aktarımı.
- Release zinciri: lockfile, CycloneDX SBOM, qualification raporu ve SHA-256 release manifesti.

Deneysel `color-grid-v1` genel ürün güvenlik iddiasına dahil değildir; ayrı optik inceleme ve fiziksel qualification gerektirir.

## Denetçinin cevaplaması gerekenler

1. El sıkışma MITM, replay, reflection, unknown-key-share ve rol karışıklığına dayanıklı mı?
2. HKDF bağlam/etiket ayrımı ve transkript bağlama doğru mu?
3. Nonce/IV üretimi ve AES-GCM kullanımı anahtar başına tekrar riskini engelliyor mu?
4. Sevk, ürün bağlamı, teslim ve audit kayıtları sökülüp başka oturuma takılabilir mi?
5. Parserlar saldırgan kontrollü boyutlarla CPU/bellek tükenmesine yol açabilir mi?
6. Web origin, CSP, WASM ve IndexedDB sınırlarında anahtar/içerik sızıntısı var mı?
7. Qualification ve release kanıtları değiştirilebilir veya yanlış sürüme bağlanabilir mi?
8. Native bridge, kanıt doğrulamasını atlatabilir veya bir cihazın enrollment
   kararını başka `keyId/publicKey` ikilisine taşıyabilir mi?
9. P-256/v2 geldiğinde algoritma veya sürüm downgrade'i transkript ve imzalı
   kayıtlar tarafından engelleniyor mu?
10. Low-S normalizasyonu native DER/P1363 dönüşümlerinde tüm platformlarda aynı mı;
    yüksek-S ikizleri, bozuk skalerler ve geçersiz eğri noktaları reddediliyor mu?
11. Peer enrollment resolver; bilinmeyen, süresi dolmuş veya iptal edilmiş cihazda
    ağ yokken de kapalı davranıyor mu?
12. Trust snapshot sequence değeri atomik ve rollback'e dayanıklı depolanıyor mu;
    saldırgan eski ama geçerli imzalı paketi tekrar yükleyebiliyor mu?
13. Tenant/site/rol ayrımı, zaman-etkili iptal, root rotasyonu ve managed-clock
    başarısızlıklarında sistem kapalı davranıyor mu?

## Tekrarlanabilir kontroller

```bash
pnpm install --frozen-lockfile
pnpm release:check
pnpm fuzz -- --seconds=3600
pnpm sbom -- --out=artifacts/review.cdx.json
```

Coverage-guided hedef `packages/conformance/fuzz/protocol.ts`, sabit başlangıç seed'leri
`packages/conformance/fuzz-seeds`, büyüyen corpus `artifacts/fuzz-corpus` ve crash çıktıları
`artifacts/fuzz-crashes` altındadır.

## Beklenen teslimatlar

- Sürüme veya commit hash'ine bağlı kapsam beyanı.
- Tehdit modeli sapmaları ve CWE/CVSS içeren bulgu listesi.
- Her bulgu için yeniden üretim girdisi veya kavram kanıtı.
- Kritik/yüksek bulgular kapandıktan sonra yeniden test mektubu.
- İncelenen SBOM ve release manifest digest'i.

Kritik veya yüksek bulgu açıkken genel satış yapılmaz. Orta bulgular için yazılı risk kabulü,
sorumlu ve kapanış tarihi gerekir. İnceleme “FIPS doğrulaması”, “ISO 17025 uyumu” veya
başka bir sertifikasyon yerine geçmez.
