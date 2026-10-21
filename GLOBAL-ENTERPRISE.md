# Kionel Global Enterprise ürün standardı

Kionel Global Enterprise, optik veri düzlemini çevrimdışı tutarken cihaz, lisans ve
politika yönetimini kurumsal ölçekte sunar. “Global” tek bir ortak veritabanı veya
içerik bulutu anlamına gelmez; bölgesel izolasyon, açık veri yerleşimi ve aynı
protokolün platformlar arası doğrulanması anlamına gelir.

## Mimari sınır

```text
Hassas içerik:  Kaynak cihaz -> ekran/kamera -> hedef cihaz
Yönetim verisi: Tenant -> cihaz enrollment/iptal -> politika -> audit ihracı
```

Yönetim katmanı dosya içeriğini, AES oturum anahtarını veya kamera karelerini almaz.
İçerik özeti dahi müşteri politikası açıkça istemedikçe merkezi servise gönderilmez.
Tam air-gap müşteri; imzalı offline enrollment paketi ve yerel iptal listesiyle
yönetim servisi olmadan çalışabilir.

## Zorunlu kurumsal kapılar

1. **Tenant izolasyonu:** tenant kimliği her yönetim nesnesinde zorunlu; veri erişimi
   servis, sorgu ve audit katmanında tenant sınırına bağlıdır.
2. **Kurumsal IAM:** OIDC/SAML 2.0 SSO, SCIM lifecycle, MFA koşulu ve en az
   `security-admin`, `device-admin`, `auditor`, `operator`, `read-only` rolleri.
3. **Cihaz güveni:** P-256 Kionel v2, doğrulanmış donanım attestation, kurum enrollment
   kaydı, kısa ömürlü politika belgesi ve çevrimdışı kullanılabilen imzalı iptal listesi.
4. **Anahtar yaşam döngüsü:** üretim, kullanıcı varlığı, yenileme, çapraz imzalı geçiş,
   iptal, kayıp cihaz ve geçmiş makbuz doğrulaması için saklanan açık anahtar geçmişi.
5. **Bölgesel veri yerleşimi:** tenant seçimine göre AB, Türkiye, ABD veya müşteri
   kontrollü kurulum; bölgeler arası varsayılan replikasyon yok.
6. **Değiştirilemez audit:** WORM uyumlu dışa aktarım, tenant mührü, güvenilir zaman
   damgası ve doğrulama aracının çevrimdışı çalışması.
7. **Tedarik zinciri:** iki kişilik release onayı, imzalı commit/tag, SBOM, provenance,
   native kod imzası, geri alma paketi ve güvenlik güncelleme süresi.
8. **İşletim:** yayımlanmış SLA, bölgesel durum sayfası, 7/24 kritik olay kanalı,
   RTO/RPO, yedek geri dönüş testi ve müşteri çıkış/veri silme prosedürü.

## Global ürün davranışı

- Protokol alanları ve imzalı zamanlar UTC/ISO 8601'dir; arayüz tarihi kullanıcı
  yereline dönüştürür.
- Kimlik ve referans metinleri Unicode NFC kullanır; kontrol ve bidi override
  karakterleri imzalanmadan önce reddedilir.
- İngilizce ana ürün dili; Türkçe ilk tam yerelleştirme. Metinler koddan ayrılmadan
  üçüncü dil GA kapsamına alınmaz.
- Erişilebilirlik hedefi WCAG 2.2 AA; kamera kullanamayan iş akışı için aynı güven
  iddiasını bozmayan kiosk/harici okuyucu seçeneği sağlanır.
- Veri saklama, audit dışa aktarımı ve destek erişimi tenant politikasıdır; küresel
  tek varsayılan yasal saklama süresi yoktur.

İmzalı tenant/site enrollment ve offline iptal snapshot çekirdeği uygulanmıştır.
Tenant bağlı RBAC/MFA, iki kişilik onay durum geçişi, içerik reddi ve OpenAPI 3.1 yönetim
sözleşmesi de uygulanmıştır. Kalıcı bölgesel servis, gerçek IAM/HSM ve native istemci
kurulana kadar bu işletilen global control plane değildir. Ayrıntılar
[CONTROL-PLANE.md](CONTROL-PLANE.md) içindedir.

## API ürün sınırı

Yönetim API'si şu kaynaklarla sınırlıdır:

- `/tenants`, `/sites`, `/devices`, `/enrollments`, `/revocations`
- `/policies`, `/roles`, `/licenses`
- `/audit-exports`, `/timestamp-seals`, `/release-channels`

API dosya yükleme veya aktarım proxy endpoint'i sunmaz. OEM SDK lisansı aynı Kionel v2
wire ve doğrulama kurallarını kullanır; müşteri markası protokol güvenlik alanlarını
değiştiremez.

## Satış ve uygunluk dili

ISO 27001, SOC 2, ISO 17025, GLP/GMP, 21 CFR Part 11, GDPR veya KVKK için kontrol
eşlemesi hazırlanabilir; ürün bağımsız kanıt ve müşteri konfigürasyonu olmadan
“otomatik uyumlu” diye satılmaz. Regülasyona tabi kullanım için intended-use,
validasyon sorumluluğu ve müşteri kontrol matrisi sözleşmede açıkça ayrılır.

## Global GA çıkış ölçütü

- En az üç işletim sistemi ailesinde signed native istemci ve donanım anahtarı.
- İki bölgede bağımsız felaket kurtarma ve tenant izolasyon testi.
- Dış protokol/kriptografi denetimi ile native/web pentest; açık kritik/yüksek bulgu yok.
- Hedef cihaz matrisinde sıfır sessiz bozulma ve tanımlı başarı/goodput eşiği.
- İmzalı reproducible release, SBOM/provenance ve doğrulanmış rollback tatbikatı.
- En az iki tasarım ortağıyla kurumsal pilot ve tamamlanmış işletim kabul testi.
