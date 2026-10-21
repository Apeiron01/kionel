# Kionel Apple Secure Enclave cihaz kimliği

iOS'ta cihaz anahtarı Secure Enclave içinde üretilir ve Apple'ın **App Attest**
servisi bu anahtar için bir attestation nesnesi döndürür. Nesne CBOR'dur; içinde
Apple App Attest köküne çıkan bir X.509 zinciri, cihazın ürettiği `authData` ve
nonce'u taşıyan bir sertifika eklentisi (OID `1.2.840.113635.100.8.2`) bulunur.

## Doğrulayıcı — tamamlandı

`@kionel/attestation-apple` enrollment tarafında çalışır ve istemcinin hiçbir
kararına güvenmez.

### Neyi kanıtlar

1. **Zincir.** Kurumun yapılandırdığı Apple App Attest köküne çıkmalı. Anchor
   tanımlı değilse her kanıt reddedilir.
2. **Anahtar bağlama.** Uç sertifikanın açık anahtarı kaydın iddia ettiği SEC1
   anahtarla birebir eşleşmeli.
3. **nonce = SHA256(authData ‖ SHA256(challenge))**, sertifika eklentisindeki
   değerle karşılaştırılır. Bu tek eşitlik challenge'ı **ve** authData'yı aynı
   anda bağlar: ikisinden biri değişirse nonce tutmaz. Replay ve authData
   kurcalaması tek kontrolde kapanır.
4. **Uygulama kimliği.** `authData.rpIdHash`, `SHA256("TEAMID.bundle.id")`
   olmalı. Başka bir uygulamanın kanıtı kabul edilmez.
5. **Sayaç.** Attestation anında `counter` sıfır olmalı.
6. **Ortam.** `aaguid` üretim (`appattest` + 7 sıfır) olmalı; geliştirme ortamı
   (`appattestdevelop`) varsayılan olarak **reddedilir**, açıkça izin verilmesi gerekir.
7. **Anahtar kimliği.** `credentialId`, açık anahtarın SHA-256'sı olmalı —
   Apple'ın anahtar kimliği tanımı budur ve uydurulamaz.

### CBOR sertleştirme

Attestation nesnesi istemciden gelen CBOR'dur. Çözücü yalnız bu biçimin
kullandığı türleri tanır ve şunları reddeder: belirsiz uzunluk, minimal olmayan
tam sayı kodlaması, etiketler, float/simple değerler, metin olmayan eşleme
anahtarları, tekrarlanan anahtarlar, kesik veri ve artık bayt.

Gevşek bir CBOR çözücü klasik attestation atlatma kaynağıdır: iki uygulamanın
aynı baytlar hakkında anlaşamaması saldırgana yeter.

## Fixture'lar

`packages/attestation-apple/test-fixtures/generate.mjs` sertifikaları ve
`fixtures.json` dosyasını yeniden üretir (openssl gerekir). Gerçek Apple köküne
bağlı **değildirler**; ayrıştırmayı, nonce bağlamayı ve authData politikasını
kanıtlarlar.

## Açık kalan: gerçek cihaz kanıtı

1. `DCAppAttestService.shared` ile `generateKey()` ve
   `attestKey(_:clientDataHash:)` çağıran küçük bir iOS uygulaması.
   `clientDataHash` = SHA-256(enrollment challenge).
2. Attestation nesnesinin Kionel enrollment'ına verilmesi.
3. Apple App Attest kök sertifikasının kuruma yapılandırılması.
4. Uygulama kimliğinin (`TEAMID.bundle.id`) politikaya sabitlenmesi.

Not: App Attest yalnız gerçek cihazlarda çalışır; simülatörde kanıt üretilemez.
Bu tamamlanana kadar hiçbir Apple cihazı `verified` attestation taşımaz.

## Assertion akışı kapsam dışı

Bu doğrulayıcı yalnız **attestation**'ı (anahtarın kaydı) doğrular. Apple'ın
`generateAssertion` akışı ve sayaç takibi Kionel'ta kullanılmıyor: cihaz kimliği
bir kez kaydedilir, sonraki imzalar Kionel v2 protokolüyle yapılır.
