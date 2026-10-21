# Değişiklik günlüğü

## Unreleased

- Ticari modele sürdürülebilirlik bölümü eklendi: tek seferlik satışın gelir tavanı,
  güven malzemesinin gerçekten süreli olması (kök rotasyonu, iptal listesi tazeliği,
  cihaz matrisi tazelemesi) ve aboneliğin bitmesi hâlinde yazılımın çalışmaya devam
  edeceği etik sınırı.
- GA'ya kadar faz planı eklendi (ROADMAP-GA.md): her fazın tartışılamaz bitiş
  koşulu ve segment sayfası listesi.
- Erişilebilirlik: `#8A8578` küçük metin rengi WCAG AA'da kalıyordu (3.53:1);
  tasarım sistemi genelinde 5.18:1 olan `#6E6A5E` ile değiştirildi.
- `_headers` dosyasına eksik olan `Strict-Transport-Security` eklendi.

- Kanonik hukuki metin seti eklendi (`legal/`): KVKK aydınlatma ile GDPR
  bilgilendirmesini birleştiren gizlilik politikası, kullanım şartları, kabul
  edilebilir kullanım, güvenlik açığı bildirim politikası ve RFC 9116
  `security.txt`. Barındırma erişim kayıtları ayrı bir işleme faaliyeti olarak
  hukuki dayanağıyla, yerel depolama ise EDPB 2/2023 kılavuzuna göre kalem kalem
  gerekçelendirildi; sorumluluk sınırı TBK m.115 karşısındaki sınırıyla yazıldı.
- Uiverse.io kaynaklı etkileşim desenleri için MIT bildirimleri
  `THIRD-PARTY-NOTICES.md` içine alındı.

- Satış yüzeyi baştan sona gelişmiş, statik/SEO görünür ürün kataloğu, çözüm
  yönlendirici, protokol ve dağıtım anlatımı, kanıt terminali, FAQ, mobil menü,
  scroll-progress ve IntersectionObserver tabanlı kaydırma animasyonlarıyla yenilendi.
  Reduced-motion, görünür odak ve yüksek kontrast davranışları eklendi.
- Gerçek istemci veri akışına ve resmî KVKK/GDPR/WCAG/VDP kaynaklarına bağlı
  gizlilik, çerez/yerel depolama, kullanım, kabul edilebilir kullanım, güvenlik
  bildirimi ve erişilebilirlik merkezi eklendi. Bilinmeyen tüzel işletmeci, hosting,
  saklama ve başvuru kanalları sahte veriyle doldurulmadı; `noindex` yayın kapısı oldu.
- Web debug turunda Lighthouse'ın bulduğu marka erişilebilir ad çakışması, küçük
  metin kontrastı, favicon ve robots fallback hataları giderildi.
- Lab Bridge, Chain Proof, Core SDK/OEM ve Personal için ayrı hedef alıcı, kullanım,
  dağıtım, lisans ve hazırlık durumları sunan responsive satış arayüzü eklendi.
  Yerel ürün yönlendirici, çalışan aktarım profiline derin bağlantı ve iletişim/içerik
  toplamayan katı `kionel-pilot-brief/v1` teknik kapsam çıktısı eklendi.
- Google'ın iki etkin Android hardware-attestation kökü SHA-256 parmak iziyle
  sabitlendi. Resmî kök/durum uçlarını yönlendirmesiz ve boyut sınırlı okuyan;
  `Date`/`Cache-Control` tazeliği, kök kümesi değişimi, rollback ve eşzamanlı yazarı
  fail-closed reddeden atomik güven materyali cache'i ile operasyon CLI'ı eklendi.
- CVE-2026-67213 için Vite/PostCSS üzerinden gelen `nanoid` 3.x, düzeltilmiş
  3.3.18 sürümüne workspace override ile sabitlendi.
- Enterprise Control Plane endpoint kataloğu, tenant/RBAC/MFA yetki kapıları ve iki
  kişilik kritik işlem onayı eklendi.
- OpenAPI 3.1 dışa aktarımı ile kanıta dayalı `/phases.html` ürün takip ekranı eklendi.
- Yazılım fallback yapmayan Windows TPM/CNG P-256 hostu, hash-pinned Node adaptörü ve
  geçici anahtar qualification aracı eklendi; remote attestation kapısı açık tutuldu.
- `@kionel/attestation-windows`: TCG TPM 2.0 yapı ayrıştırıcısı ve fail-closed remote key
  attestation doğrulayıcısı eklendi (challenge/isim/anahtar bağlama, TPMA_OBJECT
  zorunlulukları, kurumca yapılandırılan anchor'a zincirleme, AIK imza doğrulaması).
- Enrollment kararları için sağlama toplamlı, atomik (temp+fsync+rename) ve seri
  yazan dosya tabanlı trust store eklendi.
- `@kionel/attestation-core`: platform doğrulayıcılarının paylaştığı X.509 zincir
  doğrulama ve trust store tek uygulamaya indirildi.
- `@kionel/attestation-apple`: katı CBOR çözücüsü ve Apple App Attest doğrulayıcısı
  eklendi (nonce ile challenge+authData çift bağlama, uygulama kimliği, sayaç,
  üretim/geliştirme ortamı ayrımı, anahtar kimliği özeti, Apple köküne zincirleme).
- ASN.1 okuyucusu ve X.509 eklenti yürüyüşü `@kionel/attestation-core` içine alındı;
  Android ve Apple aynı sertleştirilmiş ayrıştırıcıyı paylaşıyor.
- `@kionel/qualification`: fiziksel cihaz matrisi ölçüm kaydedicisi, deterministik
  deneme yükü ve imzalı kanıt üretimi eklendi; toplama ile qualification kapısının
  aynı sözleşmeyi konuştuğu testle sabitlendi.
- Pazara çıkış planı eklendi (GO-TO-MARKET.md): USB'ye karşı konumlandırma, hedef
  arama sorguları, GEO teknik ön koşulları (Bing indeksi, OAI-SearchBot/PerplexityBot)
  ve bloke eden dört çıkış maddesi.
- Doğrulanabilir kartvizit tasarım notu eklendi (VERIFIABLE-CARD.md): basılı QR'a
  sığan imzalı vCard, boyut bütçesi ve kopyalanabilirlik sınırı açıkça yazıldı.
- Matris koşusu için otomatik zincirleme modu eklendi: tek oturumda arka arkaya
  deterministik yük yayınlanır, alıcı denemeler arasında decoder'ı sıfırlar.
  SAS onayı otomatikleştirilmedi ve otomatikleştirilemez.
- Web kalifikasyon akışında sessiz bozulma artık gerçekten tespit ediliyor.
  Önceden sayaç hiçbir yerde artırılmıyordu, yani "sıfır sessiz bozulma" kapısı
  düşemiyordu; matris yükü iki tarafta türetilip bayt bayt karşılaştırılıyor.
- Android cihaz kaydı için StrongBox anahtar üreten uygulama kaynağı eklendi
  ve tam Gradle/manifest/UI projesine dönüştürüldü; debug APK ile lint doğrulandı,
  Gradle dağıtımı ve bağımlılıklar SHA-256 metadata ile sabitlendi.
- `@kionel/attestation-android`: katı DER ayrıştırıcısı ve Android Keystore/StrongBox
  key attestation doğrulayıcısı eklendi (challenge/anahtar bağlama, yalnız
  `teeEnforced` özellik politikası, verified boot ve bootloader kilidi, Google
  köküne zincirleme, çevrimdışı iptal listesi).
- Ortak X.509 zincirinde issuer/anchor CA rolü, yinelenen sertifika ve gerçek
  P-256 eğrisi kontrolleri eklendi. Android verifier, resmî kurala uygun biçimde
  kök yönünden ilk attestation eklentisini seçiyor ve taze Google durum listesi
  olmadan fail-closed kapanıyor.
- Coverage-guided fuzzing, Apple CBOR metnindeki geçersiz UTF-8'in ham `TypeError`
  üretmesini buldu; ayrıştırıcı bunu artık kararlı `CborError/invalid-utf8` olarak
  fail-closed sınıflandırıyor ve crash girdisi regresyon testinde.

## 0.1.0 — pilot öncesi

- QR duplex/fountain optik aktarım ve güvenli web referans uygulaması.
- X25519/AES-256-GCM oturumu, iki faktörlü SAS ve Ed25519 çift imzalı makbuz.
- Lab Bridge, Chain Proof, Personal ürün profilleri ve `@kionel/sdk`.
- İmzalı audit ve fiziksel qualification kanıtları.
- Conformance, Jazzer.js fuzzing, CodeQL, CycloneDX SBOM ve attested release zinciri.
