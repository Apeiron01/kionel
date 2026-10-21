# Gizlilik ve Kişisel Verilerin Korunması Politikası

**Yürürlük tarihi:** [YÜRÜRLÜK TARİHİ]
**Sürüm:** 1.3

---

## 0. Doldurulması zorunlu alanlar

Aşağıdaki alanlar yayına alınmadan önce gerçek değerlerle doldurulmalıdır. Köşeli
parantezli bir alan yayında kalırsa bu politika geçersizdir.

| Alan | Değer |
|---|---|
| Veri sorumlusu | Taha Bayar (şahıs işletmesi) |
| MERSİS numarası | [MERSİS NO — ticaret siciline kayıtlı değilse "Yok" yazın] |
| Adres | Bademli 259. Cad., Kırkkonaklar, Çankaya / Ankara |
| Gizlilik başvuru adresi | [privacy@ALAN-ADI] |
| Güvenlik bildirim adresi | [security@ALAN-ADI] |
| KEP adresi | [KEP ADRESİ — şahıs işletmesi için zorunlu değildir; yoksa "Yok" yazın] |
| Barındırma sağlayıcısı ve bölgesi | Cloudflare, Inc. — küresel uç ağı (ABD merkezli) |

**Vergi numarası neden burada yok?** KVKK, veri sorumlusunun *kimliğinin*
belirlenebilir olmasını ister; vergi kimlik numarasının yayımlanmasını değil. Ad,
adres ve başvuru kanalı bu yükümlülüğü karşılar. Vergi numarası, fatura ve sözleşme
üzerinde gerçek müşteriye verilir — hukuken ait olduğu yer orasıdır. Yayımlamak,
karşılığında bir yarar sağlamadan sahibini gereksiz risk altına sokar.

**Şahıs işletmesi hakkında.** Veri sorumlusu bir tüzel kişi değil, gerçek kişidir.
MERSİS numarası yalnız ticaret siciline kayıtlı işletmelerde bulunur; esnaf ve
sanatkâr siciline kayıtlı ya da yalnız vergi dairesine kayıtlı bir işletmede
bulunmayabilir. KEP adresi ise 6102 sayılı Türk Ticaret Kanunu uyarınca sermaye
şirketleri için zorunludur; şahıs işletmesi için zorunlu değildir. Bulunmayan bir
alana uydurma değer yazmak, boş bırakmaktan daha ağır bir sorundur.

---

## 1. Kısa özet

Kionel uygulaması, aktarılan dosyaları hiçbir sunucuya göndermez. İçerik iki cihaz
arasında doğrudan, ekrandan kameraya geçer. Biz aktarılan içeriği görmeyiz,
saklamayız, yedeklemeyiz ve geri getiremeyiz.

Bu bir pazarlama cümlesi değil, uygulamanın yapısıdır: uygulama kodunda hiçbir ağ
çağrısı bulunmaz ve tarayıcıya gönderilen içerik güvenlik politikası
(`Content-Security-Policy: connect-src 'self'`) dışarıya bağlantı kurulmasını
tarayıcı seviyesinde engeller.

Aktarım ve numune karşılaştırma araçları dosya/listelerin içeriğini sunucuya
göndermez. Kionel artık lisans satmadığı için satın alma akışı ve ödeme verisi
yoktur. Reklam, analitik betiği veya üçüncü taraf analitik
pikseli eklenmez. Yalnızca barındırma sağlayıcısının erişim kayıtlarından ürettiği,
kimseyi tanımlamayan toplu trafik sayılarını görürüz (§4).

Import Check, seçilen CSV dosyalarını, kuralları ve beklenen listeleri o sekmenin
belleğinde işler; içerik Kionel'e yüklenmez ve kendiliğinden kaydedilmez. Excel
görev bölmesi sürümünde Office.js Microsoft'un CDN'inden yüklenir; yalnız okuma
düğmesine bastığınızda biçimlenmiş seçim okunur, çalışma kitabına yazılmaz.
Office ortamını ve kendi çalışma zamanını Microsoft işletir. İndirilen dosyalar
cihazınızda kalır.

Satış döneminden kalan sipariş, ödeme oturumu ve abonelik kayıtları (lisans sahibi
unvanı, sağlayıcı sipariş kimliği, lisans dosyası) son güncellemeden 13 ay sonra
kendiliğinden silinir. Bu süre hukuki bir saklama süresi iddiası değildir; yasal
saklama yükümlülükleri ayrıca uygulanır.

Buna rağmen iki konuda şeffaf olmamız gerekiyor ve aşağıda ayrıntılı anlatılıyor:
barındırma sağlayıcısının tuttuğu erişim kayıtları (§4) ve uygulamanın kendi
cihazınızda sakladığı veriler (§5).

## 2. Veri sorumlusu

Bu politika kapsamında veri sorumlusu Taha Bayar'dır (§0). 6698 sayılı Kişisel
Verilerin Korunması Kanunu (KVKK) ve Avrupa Birliği Genel Veri Koruma Tüzüğü
(GDPR) bakımından yükümlülükler bu tüzel kişiye aittir.

**Veri Sorumluları Sicili (VERBİS):** Veri sorumlusu, yıllık çalışan sayısı 50'den
az ve yıllık mali bilanço toplamı ilgili eşiğin altında olduğu ve ana faaliyet
konusu özel nitelikli kişisel veri işleme olmadığı için VERBİS'e kayıt
yükümlülüğünden istisnadır. Bu istisna yalnızca sicile kayıt yükümlülüğünü
kaldırır; aydınlatma yükümlülüğü, veri güvenliği tedbirleri ve ilgili kişi
haklarına ilişkin yükümlülükler aynen devam eder ve bu politika bunları karşılar.
Eşikler aşıldığında kayıt yapılacak ve bu bölüm güncellenecektir.

## 3. Aktarılan içerik

**İşlenmez.** Aktardığınız dosyalar, bunların adları, boyutları ve içerikleri
hiçbir aşamada bize ulaşmaz.

Teknik olarak: içerik gönderen cihazda AES-256-GCM ile mühürlenir, ekranda optik
kodlara dönüştürülür, alıcı cihazın kamerası tarafından okunur ve orada çözülür.
Aradaki tek ortam ışıktır. Bir ağ bağlantısı devrede değildir; optik kanal
kurulamazsa aktarım başarısız olur, hiçbir koşulda ağa geçilmez.

**Mikrofon** yalnızca iki cihazı sesle eşleştirmek için "Listen for the
receiver" ya da teslim makbuzunu sesle almak için "Listen for the delivery
receipt" düğmesine bastığınızda açılır. Ses o sayfada, bellekte çözülür;
kaydedilmez, saklanmaz, bize ya da başka bir yere gönderilmez. Beklenen ses
duyulunca ya da siz durdurunca mikrofon kapanır. Sesle taşınan bilgi gizli
değildir: alıcının ekranda QR olarak da gösterdiği eşleşme teklifi ve teslim
makbuzunun imzası ile imza anıdır.

**Güvenilir zaman damgası açıksa** (alan cihazdaki bir seçenek): her teslim
makbuzunun yalnızca SHA-256 parmak izi — dosya veya adı hakkında hiçbir şey
söylemeyen 32 bayt — sunucumuz üzerinden DigiCert'in genel zaman damgası
hizmetine gider ve zamanla imzalanmış olarak döner. İsteği DigiCert'e cihazınız
değil sunucumuz iletir; bu işlemle ilgili hiçbir şey saklamayız. Amaç: makbuzun
ne zaman var olduğuna dair bağımsız kanıt. Dayanak: talebiniz üzerine
sözleşmenin ifası.

Sonuç: aktarılan içerik bakımından veri sorumlusu **siz**siniz. Kurumsal bir
ortamda kullanıyorsanız, aktardığınız kişisel verilerin hukuki dayanağı ve
saklanması sizin sorumluluğunuzdadır.

## 4. Barındırma erişim kayıtları

Uygulama içeriği görmese de, uygulamayı **indirmek** için bir web sunucusuna
bağlanırsınız. Bu bağlantı, barındırma sağlayıcısının altyapısında olağan erişim
kayıtları oluşturur.

| İşlenen veri | IP adresi, tarayıcı/işletim sistemi bilgisi (user agent), istenen dosya yolu, zaman damgası, HTTP durum kodu |
|---|---|
| Toplayan | Cloudflare, Inc. (§0) |
| Amaç | Sitenin sunulması, kötüye kullanım ve saldırı tespiti, hata teşhisi; kimseyi tanımlamayan toplu trafik sayıları (istek, ülke, sayfa) |
| Hukuki dayanak | KVKK m.5/2-f meşru menfaat · GDPR m.6(1)(f) meşru menfaat |
| Saklama süresi | Sağlayıcının varsayılan günlük saklama süresi; ek bir kopya tarafımızca tutulmaz |
| Yurt dışına aktarım | Evet — Cloudflare uç ağı üzerinden, ziyaretçiye en yakın konumda işlenir |

Bu kayıtlar aktardığınız içeriği **içermez**; yalnızca uygulamanın indirildiğini
gösterir. Sağlayıcı bizim adımıza veri işleyen sıfatıyla hareket eder ve
aramızdaki sözleşme veri işleme şartlarını içerir.

Yurt dışına aktarım burada söz konusudur ve gizlemiyoruz: Cloudflare küresel bir
uç ağıdır, ziyaretçinin bağlantısı Türkiye dışında sonlanabilir.

KVKK m.9 bakımından dayanak **standart sözleşme**dir (7499 sayılı Kanun'la
değişik m.9/2-b). Standart sözleşmenin imzalanmasından itibaren beş iş günü içinde
Kişisel Verileri Koruma Kurumu'na bildirilmesi zorunludur. GDPR m.46 bakımından
sağlayıcının Standart Sözleşme Maddeleri (SCC) uygulanır.

**Yayın kapısı:** bu bildirim yapılmadan üretim yayını açılmamalıdır. Bu satır,
işlem tamamlandığında bildirim tarihiyle güncellenmelidir.

## 5. Cihazınızda saklanan veriler

Uygulama, çalışabilmek için tarayıcınızın yerel depolama alanlarını kullanır. Bu
veriler **cihazınızdan hiç çıkmaz**; bize iletilmez, bizim tarafımızdan
okunamaz ve senkronize edilmez.

Avrupa Veri Koruma Kurulu'nun 2/2023 sayılı kılavuzu uyarınca, cihazda bilgi
saklamak veya cihazdaki bilgiye erişmek — çerez olsun olmasın, IndexedDB ve
localStorage dahil — ePrivacy Direktifi m.5(3) kapsamındadır. Aşağıdaki tabloda
her kalem için hangi istisnaya dayandığımız ayrı ayrı belirtilmiştir.

| Teknoloji | Anahtar | Amaç | Süre | Dayanak |
|---|---|---|---|---|
| IndexedDB | `kionel-secure-identity` | Dışa aktarılamayan cihaz imza anahtarı, alıcı kartının gizli anahtarı (kart oluşturulduysa), yerel denetim kaydı, aktarım günlüğü (gönderilen, alınan ve mühürlenen dosyaların adı, boyutu, SHA-256 özeti, iş emri alanları, gönderenin beyan ettiği operatör adı veya kimliği (girildiyse) ve imzalı kaydı) ve alınan dosyaların yazılacağı klasörün bağlantısı (klasör seçildiyse; klasörün içeriği okunmaz, sunucuya gitmez) | Site verisi silinene kadar | **Kesinlikle gerekli** — bu anahtar olmadan teslim makbuzu imzalanamaz, yani kullanıcının açıkça talep ettiği hizmet sunulamaz |
| localStorage | `kionel.qualification.*` | Laboratuvar ölçüm sayaçları | Site verisi silinene kadar | **Kesinlikle gerekli değildir.** Yalnızca `?qualification=1` parametresiyle açılan test modunda ve operatörün kendi isteğiyle oluşur; genel kullanımda hiç yazılmaz |
| localStorage | Arayüz tercihleri (dil, ürün profili, seçilen kamera, hareket tercihi, yenilikler notunun görüldüğü) | Seçimin hatırlanması | Site verisi silinene kadar | **Kesinlikle gerekli** — kullanıcının kendi yaptığı seçimin korunması |
| localStorage | `kionel.license.v1`, `kionel.clock.v1` | Kullanıcının yüklediği lisans dosyası ve saat geri alındığında lisans süresinin doğru hesaplanması için görülen en ileri tarih | Site verisi silinene veya lisans değiştirilene kadar | **Kesinlikle gerekli** — kullanıcının yüklediği lisansın tanınması |
| localStorage | `kionel.receiver-card.v1` | Kullanıcının oluşturduğu alıcı kartı (açık anahtar ve etiket) | Kart silinene veya site verisi silinene kadar | **Kesinlikle gerekli** — kullanıcının talep ettiği kartla alma |
| localStorage | `kionel.folder-template.v1` | Klasöre kaydedilen dosyaların adlandırma biçimi (ör. `{workorder}_{name}`); dosya içeriği ya da adı değil, yalnız biçim | Boşaltılana veya site verisi silinene kadar | **Kesinlikle gerekli** — kullanıcının seçtiği ayarın hatırlanması |
| localStorage | `kionel.site-policy.v1` | Kurumun yüklediği site politikası (izin verilen dosya türleri, boyut, iş emri biçimi) | Kaldırılana veya site verisi silinene kadar | **Kesinlikle gerekli** — kullanıcının yüklediği kuralın uygulanması |
| localStorage | `kionel.timestamp.v1` | Güvenilir zaman damgası seçeneğinin açık olup olmadığı | Site verisi silinene kadar | **Kesinlikle gerekli** — kullanıcının kendi yaptığı seçim |
| localStorage | `kionel.flash-warning.v1` | Yanıp sönen görüntü uyarısının onaylandığı zaman | Site verisi silinene kadar; 30 günden eski onay geçersiz sayılır ve uyarı yeniden gösterilir | **Kesinlikle gerekli** — sağlık uyarısının onayı |
| sessionStorage | `kionel.transfer-code.v1` | Aktarım kodu; sayfa yenilenirse kaydın sonradan okunabilmesi için | Sekme kapanana kadar, en fazla 24 saat | **Kesinlikle gerekli** — kullanıcının başlattığı aktarım |
| Cache Storage | `kionel-app-*` | Uygulama dosyalarının çevrimdışı çalışması için kopyası; kişisel veri içermez | Yeni sürüm yüklenene kadar | **Kesinlikle gerekli** — çevrimdışı çalışma |

**Çerez kullanılmamaktadır.** Üçüncü taraf çerezi, izleme pikseli, parmak izi
çıkarma ve reklam kimliği de kullanılmamaktadır. Bu nedenle çerez onay bandı
gösterilmez: gösterilecek bir onay konusu yoktur.

Bu verileri istediğiniz zaman tarayıcınızın "site verilerini temizle" işleviyle
silebilirsiniz. Silme işlemi cihaz kimlik anahtarını da yok eder; bu anahtarla
imzalanmış geçmiş makbuzlar doğrulanabilir kalır, ancak aynı kimlikle yeni imza
atılamaz.

## 6. Yazı tipleri ve dış kaynaklar

Uygulama arayüzü, yazı tiplerini kendi sunucusundan sunar. Google Fonts veya
benzeri bir üçüncü taraf yazı tipi servisine bağlantı kurulmaz; bu tür bir
bağlantı, ziyaretçinin IP adresini üçüncü tarafa iletirdi.

Uygulamada üçüncü taraf betiği, CDN bağlantısı, gömülü video veya harici çerçeve
(iframe) bulunmaz. Ağ erişimi içerik güvenliği politikasıyla kendi kaynağıyla
sınırlandırılmıştır.

## 7. Doğrudan bize ulaştığınız durumlar

Bize e-posta ile yazarsanız (pilot talebi, güvenlik bildirimi, hak talebi), o
e-postanın içeriği ve gönderen adresi doğal olarak bize ulaşır.

| Amaç | Hukuki dayanak | Saklama |
|---|---|---|
| Talebinize yanıt vermek | KVKK m.5/2-c sözleşmenin kurulması, m.5/2-f meşru menfaat · GDPR m.6(1)(b), 6(1)(f) | Yazışmanın kapanmasından itibaren 24 ay |
| Hak talebi kayıtlarının tutulması | KVKK m.13 ve GDPR m.12 kapsamındaki hukuki yükümlülük | Mevzuatın öngördüğü süre |

Bu yazışmalar Cloudflare Email Routing üzerinden yönlendirilir ve işletmecinin posta kutusunda saklanır. Cloudflare bu akışta veri işleyen sıfatıyla hareket eder.

## 8. Kimlere aktarılır

Aktarılan içerik hiç kimseye aktarılmaz, çünkü bize hiç ulaşmaz.

Erişim kayıtları ve yazışmalar bakımından alıcı grupları: barındırma sağlayıcısı
ve e-posta sağlayıcısı (veri işleyen sıfatıyla), ile mevzuat gereği talep hâlinde
yetkili kamu kurum ve kuruluşları. Zaman damgası açıksa DigiCert, Inc. yalnızca
makbuz parmak izini alır; bu kişisel veri değildir.

Reklam ağlarına, veri simsarlarına ve analitik sağlayıcılarına hiçbir veri
aktarılmaz. Kişisel veri satılmaz.

## 9. Haklarınız

KVKK m.11 uyarınca; kişisel verinizin işlenip işlenmediğini öğrenme, işlenmişse
bilgi talep etme, işlenme amacını ve amacına uygun kullanılıp kullanılmadığını
öğrenme, yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme, eksik
veya yanlış işlenmişse düzeltilmesini isteme, silinmesini veya yok edilmesini
isteme, bu işlemlerin aktarıldığı üçüncü kişilere bildirilmesini isteme, münhasıran
otomatik sistemlerle analiz edilmesi suretiyle aleyhinize bir sonuç doğmasına
itiraz etme ve kanuna aykırı işleme sebebiyle zarara uğramanız hâlinde zararın
giderilmesini talep etme haklarına sahipsiniz.

GDPR kapsamındaysanız ayrıca erişim (m.15), düzeltme (m.16), silme (m.17), işlemenin
kısıtlanması (m.18), veri taşınabilirliği (m.20) ve itiraz (m.21) haklarınız ile
ilgili denetim makamına şikâyet hakkınız bulunmaktadır.

**Başvuru:** [privacy@ALAN-ADI] veya §0'daki adres. Başvurular KVKK m.13 uyarınca
en geç **otuz gün** içinde sonuçlandırılır. Başvurunuzu değerlendirebilmek için
kimliğinizi doğrulamamız gerekebilir.

Türkiye'de şikâyet mercii Kişisel Verileri Koruma Kurumu'dur.

## 10. Veri güvenliği

Alınan teknik tedbirler:

- Aktarılan içerik uçtan uca AES-256-GCM ile şifrelenir; anahtar değişimi X25519
  ile yapılır ve iki cihazda görsel olarak karşılaştırılan iki faktörlü doğrulama
  kodu, araya girme saldırısına karşı koruma sağlar.
- Cihaz kimlik anahtarı, tarayıcı dışına çıkarılamayan biçimde saklanır.
- Katı içerik güvenliği politikası, çerçeveleme engeli, MIME tipi zorlaması ve
  referans bilgisi gönderilmemesi başlıklarla uygulanır.
- Kaynak kod statik analiz, bulanık test (fuzzing) ve bağımlılık denetiminden
  geçirilir; sürümler imzalı köken kanıtıyla yayımlanır.

**Sınırlar açıkça belirtilir:** Uç noktası ele geçirilmiş bir cihazda hiçbir
şifreleme koruma sağlamaz. Doğrulama kodunu karşılaştırmayan kullanıcı araya girme
saldırısına açıktır. Bu sınırların tam listesi teknik tehdit modeli belgesinde
yayımlanmaktadır.

## 11. Çocuklar

Uygulama çocuklara yönelik değildir ve bilerek çocuklardan veri toplamaz. Zaten
kullanıcıdan veri toplanmamaktadır.

## 12. Değişiklikler

Bu politika değiştiğinde sürüm numarası ve yürürlük tarihi güncellenir. Esaslı
değişiklikler, değişikliğin yürürlüğe girmesinden önce bu sayfada duyurulur.
Politikanın önceki sürümleri sürüm kontrol geçmişinde erişilebilir kalır.
