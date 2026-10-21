# Kionel platform anahtarları ve kurumsal kimlik geçişi

Bu belge Kionel'un anahtar güven düzeylerini ve v1'den donanım destekli kurumsal
kimliğe geçişini tanımlar. `CryptoKey.extractable === false` tek başına donanım
kanıtı değildir; Kionel bunu `software-protected` olarak raporlar.

## Ürün politikaları

| Profil | Kalıcılık | Donanım | Kanıt | Bugünkü durum |
|---|---|---|---|---|
| Personal | isteğe bağlı | gerekmez | gerekmez | v1 Ed25519 Web Crypto kullanılabilir |
| Lab pilot | zorunlu | pilot kapsamına bağlı | pilot kapsamına bağlı | v1 Ed25519, yönetilen origin ve cihazlarla sınırlı |
| Enterprise | zorunlu | zorunlu | bağımsız doğrulanmış | v2 SDK hazır; native kasa ve gerçek enrollment servisi tamamlanana kadar kapalı |

`@kionel/platform-keys` bu kapıları kod seviyesinde uygular. Enterprise politikası
yalnız `ecdsa-p256-sha256`, kalıcı donanım anahtarı ve `verified` kanıtı kabul eder.
Native köprünün kendi güven beyanı doğrulama sayılmaz. Kanıt kararı, istemci güven
sınırı dışındaki bir doğrulayıcıdan gelmeli ve `keyId + publicKey` ikilisine bağlı
güven deposunda tutulmalıdır.

## Platform hedefleri

- **Apple:** Secure Enclave P-256 imza anahtarı. Genel amaçlı Secure Enclave
  anahtarının kuruma bağlanması için App Attest veya kuruma özgü enrollment
  kanıtının aynı açık anahtara kriptografik olarak bağlanması ayrıca tasarlanıp
  denetlenmelidir.
- **Android:** Android Keystore P-256; varsa StrongBox tercih edilir. X.509 key
  attestation zinciri sunucu tarafında güvenilir köke, beklenen challenge'a,
  güvenlik düzeyine ve güncel iptal listesine karşı doğrulanır. StrongBox olmayan
  cihaz açıkça `tee` olarak sınıflanır; StrongBox varmış gibi gösterilmez.
- **Windows:** Microsoft Platform Crypto Provider ile TPM'ye bağlı, dışa
  aktarılamayan P-256 host ve hash-pinned Node adaptörü uygulanıp yerel geçici anahtarla
  sign/verify/low-S testi yapılmıştır. TPM remote key attestation verifier'ı, signed
  paket ve çoklu fiziksel cihaz qualification'ı hâlâ zorunludur. Ayrıntılar
  [WINDOWS-TPM.md](WINDOWS-TPM.md) içindedir.

Anahtarlar signed native shell içinde oluşturulur. Özel anahtar hiçbir zaman
JavaScript'e, yedek dosyasına, loga veya yönetim API'sine çıkmaz. Native köprü
yalnız capabilities, provision, load, sign ve remove işlemlerini sunar.

## Wire sürümü sınırı

Mevcut Kionel v1 kayıtları sabit 32 bayt Ed25519 açık anahtarı ve 64 bayt imza taşır.
Apple Secure Enclave Ed25519 sunmadığı için bir P-256 anahtarını v1 kimliği gibi
etiketlemek protokol ve güvenlik hatasıdır. `requireWireCompatibility` bunu kapalı
biçimde reddeder.

Kionel v2 kriptografik wire dilimi aşağıdaki kontrolleri birlikte uygular:

1. Handshake, dispatch, receipt, audit ve qualification kayıtlarında imzalı
   algoritma kimliği ve kanonik P-256 açık anahtar biçimi.
2. P-256 imzası için tek kanonik 64 bayt `r || s` biçimi; DER/native çıktının
   köprüde katı dönüşümü ve malleability testleri.
3. v1/v2 downgrade engeli: seçilen wire sürümü ve algoritma handshake
   transkriptine ve HKDF bağlamına dahil edilir.
4. v1 doğrulayıcı desteği korunurken v2 kayıtlarının v1 parserına düşmemesi.
5. Kanonik kayıt golden vectors ve bozuk anahtar/imza parser testleri. Gerçek native
   platformlar arası vektörler ve bağımsız protokol/kriptografi incelemesi hâlâ zorunludur.

`IMPLEMENTED_WIRE_VERSIONS` v1 ve v2 içerir. v2; handshake, sevk, teslim, audit,
qualification ve yüksek seviye SDK akışında uygulanmıştır. Bu durum native platform
kasalarının, enrollment/iptal servisinin veya Enterprise ürün kabulünün tamamlandığı
anlamına gelmez.

## Enrollment ve yaşam döngüsü

Kurumsal akış şu sırayı izler:

1. Yönetici tek kullanımlık, kısa ömürlü enrollment challenge üretir.
2. Signed native istemci donanım kasasında anahtar üretir ve platform kanıtını alır.
3. Kurum verifier'ı zinciri, challenge'ı, güvenlik düzeyini ve iptal durumunu
   doğrular; kararı açık anahtar digest'ine bağlar.
4. Cihaz kimliği kurum, tesis, rol, politika sürümü ve son kullanma tarihiyle
   kaydedilir. İçerik yönetim servisine gönderilmez.
5. Her imza öncesi yerel politika; kritik işlemlerde kullanıcı varlığı uygular.
6. Yenileme eski ve yeni anahtarı çapraz imzalı geçiş kaydına bağlar. Kayıp/çalıntı
   cihaz iptal edilir; eski makbuzların doğrulanabilmesi için geçmiş açık anahtarlar
   ve iptal zamanı korunur.
7. Silme işleminden sonra anahtar geri getirilemez; audit olayı ayrıca kaydedilir.

Tenant/site/rol, cryptoperiod, zaman-etkili iptal ve rollback korumalı offline snapshot
çekirdeği `@kionel/enterprise` içinde uygulanmıştır. İşletim modeli
[ENTERPRISE-TRUST.md](ENTERPRISE-TRUST.md) belgesindedir. Gerçek attestation verifier,
HSM otoritesi ve yönetim servisi tamamlanmadan bu kayıtlar üretim enrollment kanıtı değildir.

## Uygulama sırası

1. ~~P-256/v2 protokol kayıtları, karşılıklı enrollment kapılı SDK ve golden vectors.~~
2. Android Keystore/StrongBox bridge + sunucu tarafı attestation verifier.
   (**Doğrulayıcı hazır** — bkz. [ANDROID-STRONGBOX.md](ANDROID-STRONGBOX.md); cihaz
   üzerinde anahtar üreten Android uygulaması ve Google kök yapılandırması açık.)
3. Windows TPM/CNG bridge + enrollment verifier. (Bridge, yerel TPM imza qualification'ı
   ve remote attestation **doğrulayıcısı** hazır; claim **üreticisi** — AIK +
   `NCryptCreateClaim` + EK zinciri — açık.)
4. Apple Secure Enclave bridge + denetlenmiş anahtar/uygulama bağlama kanıtı.
   (**Doğrulayıcı hazır** — bkz. [APPLE-APP-ATTEST.md](APPLE-APP-ATTEST.md); App Attest
   çağıran iOS uygulaması ve Apple kök yapılandırması açık.)
5. ~~Enrollment/iptal snapshot şeması ve SDK enforcement.~~ Yönetim API'si, HSM
   otoritesi, iki kişilik onay, yenileme ve RBAC kullanıcı arayüzü.
6. Native paket imzası, saldırı testleri ve gerçek cihaz qualification matrisi.
