# Kionel Android StrongBox cihaz kimliği

Android Keystore, donanımda üretilen bir anahtar için sertifika zinciri döndürür.
Zincirdeki güvenilir attestation sertifikası, anahtarın nasıl oluşturulduğunu ve donanımın ona ne
yapmasına izin verdiğini anlatan bir **key attestation** eklentisi taşır
(OID `1.3.6.1.4.1.11129.2.1.17`). Zincir Google'ın yayımladığı donanım
attestation köküne çıkar.

Windows TPM yolundan farkı: **üretici taraf özel bir makine istemez.** StrongBox
destekleyen herhangi bir Android cihaz bu zinciri üretir.

## Doğrulayıcı — tamamlandı

`@kionel/attestation-android`, enrollment tarafında çalışır. İstemcinin gönderdiği
hiçbir karara güvenmez; her bağı kendisi yeniden türetir.

### Neyi kanıtlar

1. **Zincir.** Kurumun yapılandırdığı Google köküne çıkmalı. Kanıtın içinde gelen
   bir kök kendini doğrular — bu yüzden anchor yoksa her şey reddedilir.
2. **İptal.** Google'ın yayımladığı durum listesindeki `REVOKED` ve `SUSPENDED`
   seri numaraları zinciri düşürür. Liste çevrimdışı verilir; doğrulayıcı ağa
   çıkmaz. `fetchedAt`/`nextUpdate` aralığı geçmişse doğrulama fail-closed düşer.
3. **Eklenti seçimi.** Eklentinin leaf'te olduğu varsayılmaz. Zincir kök yönünden
   yürünür ve ilk key-attestation eklentisi seçilir; saldırganın başa eklediği
   sertifika cihaz anahtarını veya challenge'ı değiştiremez.
4. **Anahtar bağlama.** Güvenilir attestation sertifikasının açık anahtarı, kaydın iddia ettiği SEC1
   anahtarla birebir eşleşmeli.
5. **Challenge.** `attestationChallenge` bu enrollment'ın tek kullanımlık
   değeri olmalı. Replay kapısı budur.
6. **Donanım seviyesi.** `attestationSecurityLevel` ve `keymasterSecurityLevel`
   politikanın alt sınırını (varsayılan StrongBox) karşılamalı. Kayıt, donanımın
   imzaladığından daha yüksek bir seviye iddia edemez.
7. **Anahtar özellikleri — yalnız `teeEnforced` listesinden okunur.**
   `origin = GENERATED` (içeri aktarılmamış), EC P-256, 256 bit, amaç yalnız
   `SIGN`, digest SHA-256, `allApplications` yok.
8. **Cihaz durumu.** `rootOfTrust` içinde `deviceLocked = true` ve
   `verifiedBootState = Verified`.

### Neden `teeEnforced` / `softwareEnforced` ayrımı kritik

Attestation iki yetki listesi taşır. `softwareEnforced` Android kullanıcı alanı
tarafından doldurulur; `teeEnforced` güvenli donanım tarafından. Güvenlikle
ilgili bir özelliği yanlış listeden okuyan doğrulayıcı, tam olarak attestation'ın
güvenmemek için var olduğu yazılıma güvenmiş olur. Bu klasik atlatma yolu
(`software-enforced-swap` fixture'ı) testlerde uçtan uca kapalı.

`attestationApplicationId` bilinçli istisnadır: bu alan `softwareEnforced`
içindedir ve keystore daemon'u tarafından yazılır. Derinlemesine savunma olarak
kullanılır, donanım garantisi olarak değil — kodda ve burada böyle işaretli.

### ASN.1 sertleştirme

Eklenti saldırgan tarafından üretilebilen ASN.1'dir. Ayrıştırıcı belirsiz uzunluk,
minimal olmayan uzunluk/tam sayı kodlaması, kesik değer, artık bayt ve sırasız
veya tekrarlanan yetki etiketlerini reddeder. Bilinmeyen yetki etiketleri
yok sayılır, asla güvenilmez.

## Fixture'lar

`packages/attestation-android/test-fixtures/generate.mjs` sertifikaları yeniden
üretir (openssl gerekir). Fixture'lar gerçek Google köküne bağlı **değildir**;
ayrıştırıcıyı, politikayı ve zincir mantığını kanıtlarlar.

## Üretici uygulama — derleme tamam, fiziksel kanıt açık

`native/android` artık tam Gradle projesidir. AGP 8.12.2 + Gradle 8.13 + JDK 17
ile `assembleDebug` ve `lintDebug` başarıyla çalıştırıldı. Wrapper dağıtımı SHA-256
ile, Maven/Google bağımlılıkları `verification-metadata.xml` ile sabitlenmiştir.
Uygulama:

- `setIsStrongBoxBacked(true)` ile P-256/SHA-256/sign-only anahtar üretir;
- StrongBox özelliği yoksa TEE'ye düşmeden durur;
- tek kullanımlık challenge'ı sertifika zincirine bağlar;
- PEM zinciri ve SEC1 açık anahtarı Kionel kaydı olarak üretir;
- ağ ve depolama izni istemez; JSON'u sistem belge seçicisiyle dışa aktarır;
- uygulama verisini bulut veya cihaz aktarımı yedeğine dahil etmez.

## Google güven materyali — uygulama tamamlandı

İki etkin Google Hardware Attestation kökü `config/android-google-roots.json`
içinde DER sertifika SHA-256 parmak izleriyle sabitlenmiştir. Bu politika normal bir
çalışma zamanı ayarı değildir; kök ekleme veya çıkarma güven değişikliğidir ve kod
incelemesi, imzalı sürüm ve kontrollü dağıtım gerektirir. Google'ın kök ucu sabitlenmiş
kümeyle birebir uyuşmazsa senkronizasyon yeni kökü otomatik kabul etmez.

```bash
pnpm android:trust:sync
pnpm android:trust:verify
```

Senkronizasyon yalnız sabit HTTPS uçlarına yönlendirmesiz istek yapar; JSON içerik
türünü, gövde boyutunu, X.509 CA/self-signature/geçerlilik koşullarını, Google `Date`
başlığına göre yerel saat sapmasını ve durum listesinin `Cache-Control: max-age`
değerini doğrular. Tazelik en çok 24 saattir. Çıktı tek-yazarlı kilit, `0600`, geçici
dosya + `fsync` + atomik `rename`, monoton sıra ve bütünlük özetiyle
`artifacts/android-trust-material.json` konumuna yazılır. Var olan dosya bozuksa veya
saat geriye giderse üzerine yazılmaz.

Enrollment servisi paketi şu şekilde bağlar:

```ts
const loaded = await readAndroidTrustMaterial(cachePath, reviewedRootPolicy);
assertAndroidTrustMaterialFresh(loaded);
const verifier = new AndroidKeyAttestationVerifier({
  verifierId: "kionel-android-attestation/1",
  trustAnchors: loaded.trustAnchors,
  revocationStatus: loaded.revocationStatus,
});
```

Bu dosyanın özeti kazara/yarım yazılmayı saptar; tek başına dağıtım imzası değildir.
Cache yalnız ayrıcalıklı enrollment servis hesabınca yazılmalı ve düğümler arasında
çıplak kopyalanmamalıdır. Çok düğümlü dağıtımda aynı içerik HSM otoritesinin imzaladığı
tenant trust bundle içine alınmalıdır. Kök politika dosyası release manifestine dahildir.

Açık kalan gerçek ürün kapıları:

1. APK'yı gerçek StrongBox cihazına kurup gerçek Google-köklü kanıt üretmek.
2. Debug anahtarı yerine kurumsal Android kod imzası ve imzalı release paketi.
3. Üretim enrollment servisinde periyodik senkronizasyonu, alarmı ve HSM-imzalı
   çok düğümlü dağıtımı işletmek.

Fiziksel cihaz koşusu tamamlanana kadar hiçbir Android cihazı `verified` saha kanıtı taşımaz ve
Enterprise politikası bu cihazları kabul etmez.
