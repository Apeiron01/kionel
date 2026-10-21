# Kionel — sınırları nasıl açarız

Bugün üç şey ürünü kısıtlıyor: **ekran + kamera zorunluluğu**, **iki cihaz
zorunluluğu** ve **hız**. Bu belge, her birinin nasıl açılabileceğini ve hangi
sırayla denenmesi gerektiğini tutar.

Güncelleme 2026-09-08: güncel kanıtlar ve öncelikler
yayımlanmayan bir karar raporunda. `pnpm bench:optical` sentetik codec
ölçümü üretir; fiziksel kamera ölçümü değildir. Pazar tezleri müşteri görüşmeleriyle
henüz doğrulanmadı.

---

## 0. Önce en büyük fikir: dar boğaz kanal değil, kanalın satılıyor olması

Kionel'in değeri optik kanal değil, **kanıt**. Optik kanal o kanıtı üreten
taşıyıcılardan yalnızca biri.

Kanıt katmanı (çift imzalı sevk/teslim, hash-zincirli defter, çevrimdışı
doğrulayıcı, RFC 3161 zaman damgası) taşıyıcıdan tamamen bağımsız yazıldı. Bunu
kod zaten gösteriyor: `TransportDriver` arayüzü taşıma ile kanıtı ayırıyor.

Bu şu anlama geliyor: **kamerası olmayan müşteriye "o zaman alamazsınız" demek
zorunda değiliz.**

| Taşıyıcı | Kionel ne katar |
|---|---|
| Optik (bugün) | Ortam yok, radyo yok, ayrıca kanıt |
| USB | Ortam riski müşteride kalır ama **ne taşındığı ve kimin imzaladığı** kanıtlanır |
| Veri diyodu | Diyot tek yönlülüğü sağlar, Kionel teslimin gerçekleştiğini kanıtlar |
| Elden teslim / kurye | Fiziksel zincirin dijital karşılığı |

Bu, ürünü büyütmez — **pazarı büyütür**. "Kamera yasak" itirazının (İ-4) tek
gerçek cevabı budur ve maliyeti neredeyse sıfırdır, çünkü katman zaten ayrık.

**Durum: teknik tarafı yapıldı.** `pnpm attest` ile dosya hiçbir optik kanaldan
geçmeden iki taraflı imzalı, çevrimdışı doğrulanabilir kanıt üretiliyor
(`apps/attest/`). Sevk kaydı ~335 bayt olduğu için tek bir QR karesine sığıyor:
içerik USB ile geçerken kanıt ekrandan geçebilir.

**Konumlandırma da yapıldı.** "Kionel Proof" satış kataloğunda ayrı bir teklif ve
ürün ızgarasının **başında**; ihtiyaç seçicide "Dosyam zaten taşınıyor" seçeneği
doğrudan ona götürüyor.

### Neden giriş noktası bu

Yerleşik bir sistemi değiştirmek için 10 kat iyi olmak gerekir. USB'yi hızda
yenemeyiz — 100 kat geridir. Ama USB'yi **değiştirmek zorunda değiliz**.

USB politikası ve mevcut kayıt sistemi kurumdan kuruma değişir. Yönetilen ortam
ürünleri tarama/audit, laboratuvar yazılımları elektronik imza ve onay sunabilir.
İlk müşterinin mevcut sisteminde açık kalan belirli adım bulunmalıdır.
Kanıtı mevcut taşıyıcıya eklemek bir giriş tezi olabilir. Anahtar dağıtımı,
eğitim, entegrasyon ve validasyon maliyeti vardır; geçiş maliyeti sıfır değildir.

---

## 0.5 Asıl özgün fikir: dosyanın kendi onay geçmişini taşıması

Kanıt tek başına "A'dan B'ye gitti" der. Laboratuvarın gerçekte ihtiyaç duyduğu
cümle bu değil:

> **"Bu sonucu X üretti, Y inceledi, Z serbest bıraktı, W teslim aldı."**

Bugün bu cümlenin parçaları **üç ayrı yerde** durur — cihazın kendi kaydında,
LIMS denetim izinde, kâğıt bir formda — ve hiçbiri dosyayla birlikte seyahat
etmez. İzole bir cihazda ise LIMS zaten yoktur: GxP'nin zorunlu kıldığı ikinci
göz incelemesi omuz üstünden yapılır ve hiçbir yere yazılmaz.

**Durum: yapıldı** (`pnpm attest approve`, `packages/crypto/src/endorsement.ts`).
Onaylar dosyanın yanında gider, sunucu ve hesap gerektirmez, çevrimdışı doğrulanır.

Üç tasarım kararı, sırayla:

1. **Rol serbest metin değil.** Anlamı belirsiz bir onay, onay değildir. Kapalı
   liste: üreten, inceleyen, serbest bırakan, zilyetliği devralan, teslim alan.
2. **Zincir bağlı.** Her halka bir öncekinin imzasına bağlanır, yani **sıra da
   kanıtlanabilir**. İncelemenin serbest bırakmadan *önce* olduğunu göstermek,
   incelemenin olduğunu göstermek kadar önemlidir. Bir halkayı çıkarmak, kalan
   imzalar tek tek geçerli olsa bile zinciri düşürür.
3. **Kural ürüne gömülmedi.** Hangi rolün zorunlu olduğu kurumdan kuruma değişir;
   `hasRole` ve `rolePrecedes` ile kurum kendi kuralını ifade eder.

### Neden bu, aktarımdan daha değerli olabilir

Onay akışının ayrı bir bütçesi olduğu henüz gösterilmedi. Adobe dijital imza
araçları ve in-toto gibi kanıt sistemleri zaten vardır. Fark, belirli cihaz ve
iş akışında daha kolay ve doğrulanabilir entegrasyonla gösterilmelidir.

### Aynı akıştaki diğer adaylar

- **Metot/reçete sevki** — cihaza *giden* yön, sonuç çıkan yönden daha risklidir:
  yanlış metot sessizce yanlış sonuç üretir. İmzalı metot + uygulamadan önce
  operatörün doğrulaması.
- **Numune zinciriyle birleşme** — fiziksel numunenin kâğıt zinciri ile dijital
  sonucun izi bugün hiç bağlanmıyor. `reference` alanı ikisini tek kayıtta birleştirir.
- **Cihaz kalifikasyon kayıtları (IQ/OQ/PQ)** — tam olarak küçük, hassas ve
  izole ortamda üretilen dosyalar. Aynı ürün, farklı içerik.

---

## 1. Hızı açmak

Kapasite hesabı saha hızı değildir. Profilin sınırı QR üretimi, toplam görüntü
çözümü, ekran ve kamera hızı, odak, hareket, ışık ve termal davranışla belirlenir.

### 1.1 Kare hızı
Gönderim artık geçen zamana göre sınırlandırılıyor. 120/144 Hz ekranın hedefi
katlaması engellendi. Kameranın gerçekten yakaladığı yeni kare sayısı ölçülmeli.

### 1.2 QR sürümü
v15/v27/v40 seçenekleri var. Kapasite artışı daha küçük modüller ve işlemci maliyeti
getirir. Büyük sürümün daha hızlı olması zorunlu değildir.

### 1.3 Renk
Deneysel renkli sürücü var; fiziksel renk kalibrasyonu ve farklı cihazlarda güvenilir
okuma gösterilmedi. Siyah-beyaz taban ve gerçek ihtiyaç doğrulanınca ele alınır.

### 1.4 QR dışı ızgara
Fountain eksik blokları, QR Reed-Solomon sembol içi hataları ele alır. Birinin
varlığı diğerini gereksiz kılmaz. Bulucu/hizalama desenlerinin kaldırılması ayrı
algoritma, güvenilirlik ve optik test yükü getirir. Öncelikli ürün işi değildir.

### 1.5 Büyük ekran — uygulandı; fiziksel hız kazancı açık
4 ve 9 QR aynı görüntüde gösterilebiliyor. Önceki test codec davranışını gösteriyordu;
4–9 kat saha hızını göstermiyordu. Yeni `pnpm bench:optical`, eşit piksel alanında
27 profilin kodlama/çözme sürelerini ve tam bayt doğruluğunu ölçüyor.

7 Eylül sentetik deneyinde 1080 px/v40/9 kod için hızlı tarama 24/72 kod okuyordu.
Çoklu kodda kapsamlı taramaya geçince 72/72 oldu. Aynı koşuda p95 kodlama 86.30 ms,
çözme 40.38 ms: 30–60 görüntü/sn varsayımı bu bilgisayarda sağlanmıyor.
Fiziksel kamera, açı ve ısınma bu deneyde yok. Sayıları saha sonucu diye sunmayacağız.

### Toplam
Çarpanlar bağımsız değildir; aynı piksel, kare ve işlemci bütçesini paylaşırlar.
Önceki 28x/10–15x kazanç ve 300–500 KB/sn beklentisi doğrulanmış hedef olarak
kullanılmayacak. Profil seçimi doğru, benzersiz alınan bayt/sn ve toplam iş süresiyle
ölçülecek. Henüz otomatik fiziksel profil kalibrasyonu uygulanmadı.

### Ama: her hız artışı cihaz uyumluluğunu daraltır
Renk, yüksek sürüm ve yüksek kare hızı; iyi kamerada çalışır, ucuz kamerada
çalışmaz. Tek bir profil seçmek zorunda kalırsak ya hızı ya uyumluluğu kaybederiz.

**Çözüm: profil seçmeyelim, pazarlık edelim.**

El sıkışmadan hemen sonra kısa bir kalibrasyon patlaması gönderilir; iki uç da
hangi profili sürdürebildiğini ölçer ve **ikisinin de kaldırabildiği en yüksek
profil** seçilir. Modemler ve Wi-Fi tam olarak bunu yapar. Kod bunu zaten
destekliyor: `negotiateCapabilities` ve `TransportDriver` var.

Bunun ikinci bir faydası var ve ticari olarak daha değerli: **cihaz matrisi
geçti/kaldı kapısı olmaktan çıkıp her cihaz çiftine bir hız sınıfı veren şeye
dönüşür.** "Bu iki cihaz Profil C'de sertifikalıdır" satılabilir bir çıktıdır.

---

## 2. İki cihaz zorunluluğunu açmak

Zorunlu olan iki *cihaz* değil, **bir ekran ve bir sensör**. Bu ayrım dört kapı açıyor.

### 2.1 Alıcı telefon olmak zorunda değil — YAPILDI
Uygulama kullanılabilir kameraları listeliyor ve seçimi hatırlıyor
(`apps/web/src/camera.ts`). Dizüstünün kendi kamerası, USB kamera, doküman kamerası.

Küçük ama kritik bir ayrıntı: açık bir cihaz seçildiğinde `facingMode` artık
gönderilmiyor. İkisini birlikte göndermek, seçilen kameranın sessizce yok
sayılmasına yol açıyordu — kullanıcı bir kamera seçer, başka bir kamera açılır,
nedenini kimse anlamaz.

Kalan: birden fazla kameralı bir makinede saha denemesi.

### 2.2 Aynı makine, iki güvenlik alanı — kamera hiç yok
Sanal makine ile ana makine arasında, ya da kilitli bir kapsayıcı ile masaüstü
arasında aktarım. Burada "optik" kanal bir kamera değil, **ekran belleğinin
okunması** olabilir: gönderen çizer, alıcı aynı pikselleri doğrudan okur.

Kamera yok, ikinci cihaz yok, ama izolasyon korunuyor — çünkü aradan geçen tek
şey yine piksel; ortak dosya sistemi, pano veya ağ yok.

Bu **gerçek bir air-gap deseni**: güvenilmeyen dosyaları açmak için kilitli sanal
makine kullanan kurumlar bunu bugün USB ile veya hiç yapamıyor. `TransportDriver`
sayesinde bu yeni bir ürün değil, yeni bir sürücü.
**Yüksek değer, orta maliyet. En umut verici ikinci madde.**

### 2.3 Mühürlü okuyucu cihaz — kamera yasağının tek cevabı
Kamerası olan ama **saklayamayan ve iletemeyen** küçük bir cihaz: yalnız çözer ve
kablodan çıktı verir. "Kamera yasak" kuralını "onaylı okuyucu" durumuna çevirir —
kart okuyucuların ve diyotların onaydan geçme biçimi tam olarak budur.
**Donanım işi, yani ortaklık. Ama İ-4'ün tek gerçek cevabı.**

### 2.4 Baskı + tarayıcı — eşzamansızlık
Küçük veri için QR sayfası basılır, doküman tarayıcıyla okunur. İki cihaz aynı
anda aynı odada olmak zorunda kalmaz. Yalnız küçük veri için işe yarar ve
yol haritasındaki **doğrulanabilir kartvizit** fikriyle aynı teknolojidir.

---

## 3. Yapmayacaklarımız

Bunlar akla geliyor ve hepsi çıkmaz. Yazıyoruz ki tekrar tekrar düşünmeyelim.

- **Ses / ultrasonik kanal.** Akustik emisyon da güvenli tesislerde kısıtlı, üstelik
  optikten yavaş. Bir kısıtı başka bir kısıtla değiştirmek ilerleme değildir.
- **Kamerasız ekran-ekran.** Optik kanal bir sensör ister. Fizik.
- **Veri diyotlarını hızda yenmek.** Yanlış oyun. Diyot tek yönlülük satar, biz
  kanıt satıyoruz; rakip değiliz, tamamlayıcıyız (bkz. §0).
- **Video dosyasını aracı yapmak.** Aradaki şey yine bir dosya olur ve ürünün
  tanımı çöker.

---

## 4. Sıra

Değer / maliyet oranına göre:

1. **Kanıt katmanını taşıyıcıdan bağımsız konumlandır** (§0) — maliyet neredeyse sıfır, pazarı büyütür
2. **Alıcı olarak webcam/USB kamera desteği** (§2.1) — ucuz, iki cihaz zorunluluğunu bugün gevşetir
3. **Büyük ekran profili** (§1.5) — bedava, en büyük tek hız kaldıracı
4. **Profil pazarlığı + kalibrasyon** (§1) — hız ile uyumluluk arasındaki seçimi ortadan kaldırır
5. **Renkli ızgara kalibrasyonu** (§1.3) — sürücü zaten var
6. **Aynı makine / ekran belleği sürücüsü** (§2.2) — yeni pazar açar
7. **Özel ızgara, QR'sız** (§1.4) — en pahalısı, en sona
8. **Mühürlü okuyucu** (§2.3) — donanım, ortaklık gerektirir

Bu sıra bilinçli olarak **hız işlerini konumlandırma ve uyumluluk işlerinden sonraya
koyuyor**. Hız, satamadığınız bir üründe işe yaramaz; uyumluluk ise satılabilirliğin
kendisidir.

---

## 5. Önceki çalışma taraması (1 Ekim 2026)

Soru: "Her şey yapılmış mı; piyasada olmayan ne satabiliriz?" Web taraması,
patent bürosu araması değildir. Rakamlar aksi yazılmadıkça üreticinin kendi beyanıdır.

### 5.1 Yapılmış olanlar

| Alan | Kim | Not |
|---|---|---|
| Hareketli QR + fountain | txqr (2018), qrs, libcimbar (~106 KB/s beyan), Decimen (2026) | Decimen telefondan telefona 50–186 KB/s, dizüstünden telefona uzaktan "birkaç KB/s"; şifreleme ve imza yok; CC BY-NC-SA |
| Uyarlamalı, geri bildirimli ekran-kamera bağı | COBRA, LightSync, SoftLight, MAMBA (Aalto), FareQR | Akademik; hız ve kare boyutu ortama göre ayarlanıyor |
| Yapay zekâ ile kod | StegaStamp (56 bit), Light Field Messaging, DeepLight (~1 kbps) | Görünmez gömme için; hız için değil, dosya taşımaya yetmez |
| Işıkla ileri, sesle geri | AirgapLink (ilk commit 25 Eyl 2026, tarayıcı) | Sesle eşleşme + sesle ACK; bitişte 12 baytlık HMAC etiketi. İmzalı makbuz yok, fiziksel ölçüm yok, lisans yok |
| Optik aktarımda imzalı zarf + alıcı imzalı kayıt | GlassBridge/AGX (ön-alfa, Apache-2.0) | Politika kapısı, karantina; hızlar "kayıp öncesi bütçe, telefon sonucu değil" |
| Seri kablo veri diyodu | Iowa Üniv. RS-232 Data Diode (oy makineleri için) | Kendin yap bilgisi yıllardır açık |
| Donanım diyot | Fend XE5 4.499 $, XE15 6.899 $; eski nesil >100.000 $/bağlantı | Ethernet |
| USB uç nokta diyodu | ST Engineering Endpoint Data Diode | USB 2.0'da 300–400 Mbps; kurum/devlet; fiyat yayımlanmıyor |
| USB tarama kioskları | OPSWAT MetaDefender Kiosk, Honeywell SMX | Tarama + denetim; fiyat teklifle |
| Hava boşluğunda ses/ışık sızdırma | Guri ve ark. (BRIGHTNESS, LED-it-GO, DiskFiltration) | Güvenlik ekipleri bu kanalları tehdit olarak tanır |

Patent: IBM US12003709B1 (öncelik 16 Kas 2022, yürürlükte), "hava boşluklu sistemden
görsel veri iletimi". 1. istem: kamerayla okuma sırasında hata algılanınca alıcı uyarı
verir, gönderen kullanıcı girdisiyle görsel kodun bir kısmını yeniden gösterir. txqr
(2018) gibi daha eski açık çalışmalar var; ABD'de satış büyümeden bir patent vekiline
gösterilmeli. Bu bir hukuki görüş değildir.

### 5.2 Sonuç

- Kanal tarafında yeni bir fiziksel yöntem yok: ekran, kamera, hoparlör, mikrofon ve
  kablo dışında tarayıcının eriştiği bir ortam yok, hepsi denenmiş.
- "Işıkla gider, sesle döner" fikrini bizden altı gün önce biri yayımlamış. Bizdeki
  fark sesle dönen şeyin üçüncü tarafça doğrulanabilir imzalı makbuz olması. "İlk" denmez.
- Hızda lider değiliz: sizin ölçümünüz monitörden telefona ~7 KB/s; açık kaynak
  araçlar telefondan telefona 50–186 KB/s beyan ediyor.
- Taramada bulunmayan: (a) bağımsız, gerçek cihazda ölçülmüş karşılaştırma. Herkes
  kendi rakamını veriyor, ikisi açıkça "fiziksel ölçüm yok" diyor. (b) Ucuz olan ile
  denetime hazır olanın birleşimi: validasyon paketi, çevrimdışı doğrulayıcı, RFC 3161,
  yazılı sınırlar. Açık kaynak tarafı hız yarışıyor, donanım tarafı 4.500 $'dan başlıyor.

### 5.3 Buradan çıkan sıra

1. **Açık ölçüm seti ("optik aktarım kıyası").** Aynı dosya, aynı telefon, aynı ekran,
   aynı mesafe; txqr, libcimbar, Decimen, Kionel. Ön baskı ve ölçüm betiği zaten var.
   İsim yapmanın en ucuz yolu: başkalarının atıf yaptığı tabloyu yayımlamak.
2. **USB seri kablo seti ("Kionel Link").** Yazılım hazır (Web Serial, 921.600 baud,
   ~80 KB/s). FT232H sınıfı adaptörler 3–12 Mbaud destekliyor; ölçülmeden hız yazılmaz.
   Önce parça listesi + doğrulanmış adaptör olarak, donanım satıcısı olmadan.
3. **Sektör girişleri mevcut ürünle:** adli bilişim (delil dışa aktarımı), seçim
   sistemleri, eski tıbbi görüntüleme cihazları. Entegrasyon: aktarım günlüğünün SIEM'e
   (syslog/JSON) aktarımı.

Kaynaklar: github.com/rrborja/airgaplink · github.com/humancto/glass-bridge ·
betterstack.com/community/guides/linux/decimen-optical · github.com/divan/txqr ·
research.aalto.fi (MAMBA) · arxiv.org/abs/1904.05343 (StegaStamp) ·
patents.google.com/patent/US12003709 · fend.tech (XE5, XE15) ·
stengg.com/en/cybersecurity/products/endpoint-data-diode ·
homepage.cs.uiowa.edu/~dwjones/voting/diode/RS232tech.pdf · arxiv.org/pdf/2002.01078
