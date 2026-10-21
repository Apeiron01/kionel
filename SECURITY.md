# Kionel Güvenlik Politikası

Durum: güvenlik sertleştirmesi devam ediyor. Kionel henüz bağımsız denetimden
geçmemiştir ve sertifikalı bir medikal, adli veya sınıflandırılmış bilgi sistemi
olarak sunulmamalıdır.

## Güvenlik sınırı

Kionel; temiz iki uç cihaz, doğru Web Crypto uygulaması ve kullanıcıların iki SAS
faktörünü gerçekten karşılaştırdığı varsayımıyla optik kanal üzerindeki dinleme,
değiştirme ve ortadaki-adam saldırılarına karşı koruma sağlar. Ele geçirilmiş uç
cihaz, ekran kaydedici, fiziksel zorlama ve anahtarın gerçek kişi/kuruma bağlanması
protokol kapsamı dışındadır. Ayrıntılar [THREAT-MODEL.md](THREAT-MODEL.md)'dedir.

## Uygulanan kontroller

- X25519 geçici oturum anahtarları ve HKDF-SHA256 ile ileri gizlilik.
- AES-256-GCM içerik gizliliği ve bütünlüğü.
- Ed25519 ile teklif, cevap, sevk, teslim ve audit kaydı imzaları.
- Altı hane ve beş sembolden bağımsız türetilen iki SAS faktörü.
- Tek kullanımlık, süre sınırlı ve rol ayrımlı el sıkışma kayıtları.
- Dışa aktarılamayan özel Ed25519 anahtarı; IndexedDB'de `CryptoKey` saklama.
- Tarayıcı anahtarını donanım anahtarı olarak göstermeyen açık güven düzeyi;
  Enterprise için P-256, kalıcı donanım anahtarı ve bağımsız doğrulanmış attestation kapısı.
- Native anahtar köprüsünden bağımsız attestation doğrulayıcı ve açık anahtara bağlı
  enrollment güven deposu sözleşmesi; P-256'nın Ed25519/v1 hattında kullanımını reddeden sürüm kapısı.
- Kionel v2'de P-256/SHA-256, kanonik 64 bayt low-S imza, algoritma/sürümü handshake
  transkripti ve HKDF etiketlerine bağlayan downgrade ayrımı.
- v2 sevk, çift imzalı teslim, audit ve qualification kayıtlarında açık anahtar
  digest'inden türetilen global `urn:kionel:key:sha256` kimliği ve katı alan doğrulaması.
- Enterprise SDK'da yerel doğrulanmış donanım politikası ve karşılıklı kurum
  enrollment/iptal kontrolü; resolver yoksa kapalı davranış.
- Kurum köküne sabitlenen tenant/site/rol trust snapshot'ı; 90 günlük bundle,
  400 günlük enrollment ve 24 saatlik attestation-to-enrollment üst sınırı.
- Minimum sequence ile imzalı eski snapshot rollback'ini, zaman-etkili kayıtla
  kayıp/kompromize cihazı reddetme; doğrulama sonrası snapshot'ın dondurulması.
- CRC doğrulamasından sonra dahi frame türü, boyutu, blok sayısı ve payload
  tutarlılığı kontrolü.
- SDK için 1 GiB, web demo için 64 MiB aktarım sınırı; en fazla 1.000.000 kaynak blok.
- Makbuz ve audit JSON'unda katı tür, uzunluk ve base64url biçim kontrolü.
- İmzalı, önceki kayıt hash'ine bağlı ve silme/sıralama/değiştirmeyi gösteren audit zinciri.
- Üretim web başlıklarında dış bağlantıyı kapatan CSP ve daraltılmış Permissions Policy.
- Üretim bağımlılık taraması: bilinen açık yok (`pnpm audit --prod`, 3 Ağustos 2026).

## Anahtar yaşam döngüsü

Kalıcı cihaz kimliği Ed25519'dur. Özel anahtar dışa aktarılamaz; aynı origin'in
IndexedDB alanında saklanır. Eski çıkarılabilir JWK anahtarı varsa aynı açık anahtar
korunarak non-extractable `CryptoKey`'e geçirilir ve eski kopya yalnız başarılı
yazımdan sonra silinir. IndexedDB kullanılamazsa sistem çıkarılabilir anahtara geri
düşmez; sekmeye özel korumalı anahtar üretir ve kalıcılık uyarısı gösterir.

Tarayıcı profilinin silinmesi cihaz kimliğini geri döndürülemez biçimde siler.
Kurumsal sürümde anahtar kaybı/yenileme prosedürü, cihaz envanteri ve mümkünse
platform anahtar kasası entegrasyonu zorunludur.

`@kionel/platform-keys` Secure Enclave, Android Keystore/StrongBox ve Windows TPM
sağlayıcılarının ortak güven sınırını tanımlar. Windows CNG/Microsoft Platform Crypto
Provider hostu ve hash-pinned Node adaptörü uygulanmış, gerçek yerel TPM ile geçici
sign/verify/low-S qualification yapılmıştır. Windows remote attestation verifier'ı,
signed paket ve Android/Apple hostları tamamlanmamıştır. Enterprise donanım kimliği
P-256/v2, enrollment ve bağımsız kanıt doğrulaması birlikte tamamlanmadan satışa hazır
kabul edilmez. Ayrıntı [KEY-MANAGEMENT.md](KEY-MANAGEMENT.md) ve
[WINDOWS-TPM.md](WINDOWS-TPM.md) belgelerindedir.

## Audit zinciri

Her doğrulanmış teslim olayı; makbuz hash'i, sıra numarası, önceki kayıt hash'i,
cihaz saati, olay türü ve aktör açık anahtarını içerir. Kayıt Ed25519 ile imzalanır.
Zincir çevrimdışı doğrulanır:

```bash
pnpm audit:verify kionel-audit-ledger.json [makbuz1.json ...]
```

Bu zincir güvenilir zaman damgası sağlamaz. Düzenlemeye tabi laboratuvarlarda cihaz
saatleri yönetilmeli veya dış TSA/mühürleme sistemiyle ayrıca zaman kanıtı alınmalıdır.

## Açık bildirme

Doğrulanmış, izlenen bir güvenlik iletişim adresi, PGP anahtarı, yetkili test kapsamı
ve güvenli liman metni henüz yapılandırılmamıştır. Bu bilgiler eklenene kadar canlı
sistemlerde güvenlik testi yapılmamalı ve hassas bulgular herkese açık issue'lara
konulmamalıdır. Gerçek kanal açıldığında bu belge ve `/.well-known/security.txt`
birlikte sürümlenecektir. Rapor şablonu; etkilenen sürüm, tekrar adımları, beklenen
etki ve varsa kavram kanıtını içerecektir. Bağımsız güvenlik denetimi tamamlanmadan
Kionel için “denetlenmiş”, “sertifikalı” veya “regülasyon uyumlu” iddiası yapılmaz.
