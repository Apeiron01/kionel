# Kionel — Tehdit Modeli

Bu belgenin amacı sistemi savunmak değil, **sınırlarını göstermek**. Koruyamadığımız
şeyleri yazmak, koruduklarımızı abartmaktan daha değerli. Bir iddia burada yazmıyorsa,
o iddiayı yapmıyoruz.

Durum: v0.1. **Bağımsız güvenlik denetimi yapılmamıştır.**

## Varsayımlar

- Tarayıcının/çalışma ortamının Web Crypto uygulaması doğrudur (kendi primitifimizi yazmıyoruz).
- `crypto.getRandomValues` gerçekten öngörülemez.
- Her iki uçtaki cihaz ve işletim sistemi temizdir.
- **Kullanıcılar SAS kodunu gerçekten karşılaştırır.** Bu adım atlanırsa ortadaki-adam
  koruması yoktur. Tasarımın en zayıf halkası bir insan davranışıdır ve bunu gizlemiyoruz.

## Koruduklarımız

| Tehdit | Nasıl |
|---|---|
| Radyo dinleme, cihaz takibi | Hiç RF üretilmez. Bluetooth/WiFi/NFC'ye düşüş **yoktur** |
| Sunucu ele geçirilmesi, veri sızıntısı | Sunucu yok. Veri hiçbir üçüncü sisteme uğramaz |
| Yanlış alıcıya gönderim | Hedef seçimi menüden değil; kamera fiziksel olarak o ekrana doğrultulur |
| Aktarımı uzaktan filmleyen üçüncü kamera | Yakaladığı şey şifreli metindir. Açık anahtarları görmesi işine yaramaz |
| Optik kanalda ortadaki adam | X25519 + ayrı türetilen 6 hane ve 5 çizili işaretten oluşan iki SAS gösterimi |
| İçeriğin yolda değiştirilmesi | AES-256-GCM kimlik doğrulama etiketi |
| Kazara bozulma | Çerçevede CRC32, içerikte CRC32, kayıp karelerde fountain kodu |
| Teslim kaydının sonradan uydurulması | Ed25519 imzalı makbuz; tek alan değişse imza düşer |
| Makbuzu doğrulamak için bize bağımlılık | Doğrulama tamamen çevrimdışıdır (`pnpm verify`) |

## KORUMADIKLARIMIZ

Bunlar eksiklik değil, kapsam dışıdır. Bir kısmı hiçbir yazılımın çözemeyeceği şeylerdir.

- **Ele geçirilmiş cihaz.** Uç noktada kötücül yazılım, ekran kaydedici veya bozulmuş
  işletim sistemi varsa hiçbir şifreleme işe yaramaz — veri zaten düz metin olarak
  oradadır. Buna karşı hiçbir iddiamız yok.
- **Kilitsiz cihaz, omuz üstünden bakan.** Cihaza fiziksel erişimi olan biri zaten
  içeriğe erişebilir.
- **SAS'ı karşılaştırmayan kullanıcı.** Kodu onaylamadan geçen kullanıcı ortadaki-adama açıktır.
- **Trafik analizi.** Bir gözlemci aktarımın *gerçekleştiğini*, ne kadar sürdüğünü ve
  kabaca boyutunu görür. Gizlediğimiz şey içeriktir, aktarımın varlığı değil.
- **Zaman damgası — damgasız makbuzlarda.** Makbuzdaki `at` alanı cihazın kendi
  saatidir. Güvenilir zaman kaynağı değildir; anlaşan iki taraf geçmişe tarih atabilir.
  Bu sınır artık kapatılabilir: makbuza RFC 3161 zaman damgası **eklenebiliyor** ve
  doğrulayıcı onu çevrimdışı kontrol ediyor (`--tsa-anchor`). Damga jetonu imzalı
  baytların dışında taşınır; imzayı ve dolayısıyla imzanın o an var olduğunu mühürler.
  **Damga eklenmemiş bir makbuz için yukarıdaki sınır aynen geçerlidir** ve doğrulayıcı
  bunu açıkça yazar. Hangi TSA ile çalışılacağı ve kök sabitleme politikası henüz
  kararlaştırılmadı; o karar verilene kadar üretimde damga yoktur.
- **Kimlik.** Makbuz "bu iki *anahtar* arasında" der, "bu iki *kişi* arasında" demez.
  Anahtarı kimliğe bağlamak (PKI, kurumsal dizin) bu katmanın dışındadır. Yüz yüze
  teslimde bunu göz teması sağlar; uzaktan bir senaryoda sağlamaz.
- **Makbuz “okundu” demek değildir.** Gönderen sevk kaydını, alıcı teslim kaydını
  imzalar. Bu iki anahtar arasında aktarımı kanıtlar; alıcının içeriği anlayarak
  okuduğunu veya tarafların hukuki kimliğini kanıtlamaz.
- **Zorlama.** Kullanıcı tehdit altında transferi kendisi onaylarsa protokolün yapabileceği bir şey yoktur.
- **Anahtar saklama.** Web demosu Ed25519 özel anahtarını dışa aktarılamayan `CryptoKey`
  olarak IndexedDB'de saklar. Aynı origin'deki kötü amaçlı kod anahtar baytlarını
  çıkaramasa da anahtarla imza attırabilir; XSS hâlâ uç nokta ele geçirilmesidir.
  Yüksek güvence isteyen üretim SDK'sı platform/donanım anahtar kasasını kullanmalıdır.
- **Native host değiştirme.** Windows adaptörü DLL/EXE runtime artifact setini SHA-256
  release pinine bağlar ve yazılım KSP'ye fallback yapmaz. Yerel yönetici yine hostu,
  release pinini veya çağıran uygulamayı birlikte değiştirebilir; signed paket, kod
  imzası ve bağımsız TPM attestation olmadan bu sınır kurumsal cihaz kanıtı değildir.
- **Yerel trust store.** Enrollment kararları sağlama toplamlı ve atomik yazılır; bu,
  kısmi yazımı ve kazara bozulmayı yakalar, **yerel yöneticiyi yakalamaz**. Dosyayı
  yeniden yazabilen biri native host ikilisini de değiştirebilir. Trust store'un
  otoritesi kurumun kendi imzaladığı snapshot'tır, diskteki kopya değil.
- **Attestation üretici tarafı.** Doğrulayıcı hazır olsa da native host henüz TPM
  claim üretmiyor. Bu tamamlanana kadar hiçbir Windows cihazı `verified` attestation
  taşıyamaz ve Enterprise politikası bu cihazları kabul etmez — kapı açık değil, kapalı.
- **Yan kanallar.** Ekran parlaklığından, güç tüketiminden veya kamera gürültüsünden
  bilgi sızması incelenmedi.

## Bilinçli tasarım kararları

- **Hiçbir koşulda ağa düşüş yok.** Optik kanal kurulamazsa aktarım başarısız olur.
  Bu bir eksiklik değil, ürünün tanımıdır — "sıfır radyo" iddiası ancak istisnasızsa anlamlıdır.
- **ECC seviyesi düşük (L).** Karedeki bozulmayı ECC, kaybolan kareyi fountain katmanı
  çözer. İkisi farklı problemdir; ECC'yi yükseltmek kapasiteyi boşuna harcar.
- **İki SAS gösterimi.** Altı hane ve beş işaret ayrı HKDF etiketleriyle türetilir.
  Bunlar bağımsız MFA kimlik doğrulama faktörleri değildir; aynı oturumun iki
  karşılaştırma gösterimidir. Kullanıcının karşılaştırması gerekir.
  Kullanıcı ikisini de karşılaştırmalıdır; yalnızca birini kontrol etmek belirtilen
  ortadaki-adam güvencesini sağlamaz.
- **İşaretler emoji değildir.** Emoji bir resim değil, bir kod noktasıdır ve Apple,
  Google, Samsung'da farklı çizilir. Karşılaştırılması gereken iki ekranda farklı
  görünen bir karşılaştırma kodu, karşılaştırma kodu değildir. Kripto katmanı beş
  indeks (0-31) üretir; çizim tamamen istemcinin işidir ve her platformda aynıdır.
