# Kionel Android cihaz kaydı

StrongBox içinde Kionel v2 cihaz kimliği üretir ve Android'in döndürdüğü key
attestation zincirini `@kionel/attestation-android` doğrulayıcısının beklediği
biçimde dışarı verir.

**Durum: debug APK derlendi ve lint temiz. Fiziksel cihaz koşusu yapılmadı.**
AGP 8.12.2, Gradle 8.13, JDK 17 ve API 36 ile `assembleDebug`/`lintDebug`
başarıyla çalıştırıldı. Bağımlılık ve Gradle dağıtım doğrulamaları depoda sabittir.
Gerçek Google-köklü kanıt ancak StrongBox cihazında üretilebilir.

## Uygulanan güvenlik sınırı

- Yalnız P-256 (`secp256r1`), yalnız SHA-256, yalnız `PURPOSE_SIGN`.
  Doğrulayıcı bu üçünü de zorunlu tutar; farklı bir anahtar reddedilir.
- `setIsStrongBoxBacked(true)`. StrongBox yoksa **kayıt yapılmaz**; TEE'ye
  sessizce düşülmez. Kurumun StrongBox sandığı cihazın aslında StrongBox
  olmaması, kanıtın tamamını anlamsızlaştırır.
- Challenge enrollment servisinden gelir ve 16..64 bayt olmalıdır. Cihazın
  kendi ürettiği challenge, replay'e karşı hiçbir şey ifade etmez.
- Özel anahtar hiçbir zaman uygulama belleğine gelmez; `AndroidKeyStore`
  yalnız tutamak verir.
- Aynı alias varsa silinip yeniden üretilir: eski anahtarla yeni challenge
  eşleşemez.

## Derleme

Android SDK ve JDK 17 gerekir; Gradle wrapper depodadır:

```bash
cd native/android
./gradlew :app:assembleDebug :app:lintDebug
adb install app/build/outputs/apk/debug/app-debug.apk
```

`minSdk` 28 (StrongBox API'sinin geldiği sürüm). Cihaz StrongBox desteklemiyorsa
uygulama açıkça hata verir — beklenen davranış budur.

## Kullanım

1. Enrollment servisinden tek kullanımlık challenge'ı alın (base64url).
2. Uygulamaya yapıştırın, **Kaydı üret**'e basın.
3. Android belge seçicisinden `kionel-android-attestation.json` dosyasını kaydedip
   enrollment tarafına taşıyın.
4. Doğrulayıcı `AndroidKeyAttestationVerifier` ile kararı verir; Google
   donanım attestation kökleri ve iptal listesi kurumda yapılandırılmış olmalıdır.

Ayrıntı ve doğrulanan tüm koşullar: [../../ANDROID-STRONGBOX.md](../../ANDROID-STRONGBOX.md).

## Açık işler

- Gerçek StrongBox cihazında ilk koşu ve Google-köklü fixture'ın doğrulanması.
- Challenge'ın elle yapıştırılması yerine Kionel optik kanalıyla alınması.
- Uygulama imzası ve `attestationApplicationId` beklentisinin kuruma sabitlenmesi.
