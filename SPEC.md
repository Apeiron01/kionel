# Kionel Protokolü — SPEC v0.1 (taslak)

Durum: **taslak**. Faz 0 çıktısı. Uyumluluk garantisi yok; `version` alanı 1'de kalır,
kırıcı değişiklikte 2'ye çıkar.

## 1. Kapsam

Bu sürüm simplex fountain ve zaman bölmeli **duplex ARQ** aktarımını tanımlar.
El sıkışmadaki yetenek kaydıyla ortak taşıma, kapasite ve kare hızı seçilir. İki
taraflı kamera/ekran kullanımı mümkün değilse oturum hata vermeden simplex'e düşer.

Kapsam dışı: color-grid otomatik finder tespiti, native kamera SDK'ları ve donanım
anahtar kasası. Color-grid raster codec'i deneysel ek olarak tanımlanır.

## 2. Çerçeve formatı

Her çerçeve **kendi kendini tanımlar**. Alıcı akışa herhangi bir noktadan
katılabilir; ayrı bir manifest/başlangıç çerçevesi yoktur. Bu, oturum başlatmayı
bir "senkronizasyon" problemi olmaktan çıkarır.

Bayt sırası: big-endian.

| Ofset | Boyut | Alan         | Açıklama                                              |
|-------|-------|--------------|-------------------------------------------------------|
| 0     | 1     | `version`    | 1                                                     |
| 1     | 1     | `type`       | `0x01` DATA, `0x10` ACK, `0x11` CONTROL.             |
| 2     | 2     | `blockSize`  | Kaynak blok boyutu (bayt). Payload uzunluğuna eşittir.|
| 4     | 4     | `sessionId`  | Oturum ayracı. Aynı kadrajda iki gönderici olursa ayırır. |
| 8     | 4     | `seed`       | LT komşu kümesi türetme tohumu (§3).                  |
| 12    | 4     | `totalBytes` | İçeriğin toplam boyutu. Blok sayısı buradan çıkar.    |
| 16    | N     | `payload`    | Kodlanmış blok (`blockSize` bayt).                    |
| 16+N  | 4     | `crc32`      | `[0, 16+N)` üzerinden CRC-32 (IEEE, ters poli 0xEDB88320). |

Sabit yük: **20 bayt/çerçeve**.

CRC uyuşmazlığı, bilinmeyen `version`, veya eksik uzunluk → çerçeve **sessizce
atılır**. Bozuk kare bir hata değil, beklenen durumdur.

`type` alanının varlığı, üst katmanların (ACK, el sıkışma, makbuz) aynı çerçeve
zarfını yeniden kullanmasını sağlar — L1 taşıması değişmeden.

## 3. LT fountain kodlaması (L2)

- `k = ceil(totalBytes / blockSize)` kaynak bloğu. Son blok sıfırla doldurulur;
  alıcı `totalBytes` ile kırpar.
- Derece dağılımı: **Robust Soliton**, `c = 0.03`, `delta = 0.5`.
- Komşu türetme: `rng = mulberry32((seed ^ 0x9E3779B9) >>> 0)`, bir ısınma çekilişi,
  ardından CDF'den derece `d`, ardından `[0, k)` üzerinde kısmi Fisher-Yates ile
  `d` tekrarsız indeks.
- **Zorunluluk:** komşu kümesi yalnızca `(seed, k)`'nın fonksiyonudur. Çağrı sırası,
  geçmişi veya kaybolan çerçeveler sonucu etkileyemez. (Bu kural Faz 0'da bir kez
  ihlal edildi ve testle yakalandı; `core.test.ts` bu değişmezi korur.)
- Simplex fallback'te gönderen `seed = 1, 2, 3, …` sırasıyla sınırsız fountain
  çerçevesi üretir. Duplex modda sistematik ön ek ve ACK seçici tekrar kullanılır;
  geri kanal kaybolursa fountain üretimi otomatik olarak devralır.

Ölçülen fazlalık: kayıpsız kanalda **1.09–1.30×** (blok sayısı arttıkça 1.09'a yaklaşır).

## 3b. qr-v1 taşıması (L1)

- QR **byte mode**, ECC seviyesi **L**. Yüksek ECC kullanılmaz: karedeki bozulmayı
  ECC, kaybolan kareyi fountain katmanı çözer; ikisi farklı problemlerdir ve
  ECC'yi yükseltmek kapasiteyi boşuna yer.
- Ölçülen: rastgele ikili veri (NUL, 0xFF, satır sonu dahil) byte mode'dan
  **bozulmadan** döner — metin kodlamasına (base45 vb.) gerek yok. `qr.test.ts`
  bu değişmezi kamerasız korur.
- Sürüm → kapasite (bayt, ECC-L): v15 = 520, v27 = 1465, v40 = 2953.
  Çerçeve yükü 20 bayt düşülür → `blockSize`.
- Kenar boşluğu 2 modül (standart 4 der; ekran-kamera bağında 2 yeterli ve alan kazandırır).
- **Ekran zamanlaması:** her kare en az 2 tazeleme döngüsü ekranda kalmalı.
  60 Hz → 30 kare/sn, 120 Hz → 60 kare/sn üst sınır. Daha hızlı gösterim
  kameranın iki karenin karışımını yakalamasına ve hiçbirinin çözülememesine yol açar.
- **Alıcı:** `requestVideoFrameCallback` ile her kamera karesi denenir; çözücü
  meşgulse kare düşürülür. Düşen kare hata değildir — fountain katmanı telafi eder.

## 3c. Duplex kanal ve seçici tekrar (L3)

El sıkışma kontrol mesajı kripto kaydının yanında şu yetenekleri taşır: protokol
sürümü, taşıma sürücüleri, azami kare kapasitesi/FPS ve `duplex`, `arq`, `resume`
bayrakları. Ortak değer yoksa oturum başlamaz; karşı kayıt okunamazsa simplex
fountain modu seçilir.

Duplex aktarımda:

1. Gönderen her kaynak bloğu bir kez sistematik olarak yollar. Sistematik seed'in
   yüksek biti 1, kalan 31 bit kaynak blok indeksidir.
2. Alıcı çözülmeyen blok indekslerini `[start, endExclusive)` aralıklarına sıkıştırıp
   ACK karesinde gösterir.
3. Gönderen yalnız bu aralıkları tekrarlar. Parçalı liste QR kapasitesini aşarsa
   küçük alınmış boşluklar birleştirilir; gereksiz birkaç tekrar doğruluğu etkilemez.
4. ACK okunamazsa veri akışı fountain blokları üretmeye devam eder. Geri kanal
   performans iyileştirmesidir; tamamlanmanın tek koşulu değildir.
5. Decoder checkpoint'i yalnız çözülmüş kaynak bloklarını saklar. Bekleyen fountain
   denklemleri kaybedilebilir; yeniden başlatmada eksik aralıklar tekrar istenir.

ACK payload biçimi:

```text
[ver 1 | flags 1 | rangeCount 2 | sequence 4 | received 4 | total 4 | decodeMicros 4 |
 (start 4 | endExclusive 4) × rangeCount]
```

Akış kontrolü ACK penceresindeki kayıp ve çözme süresini izler. Kayıp `%20`'yi
aşarsa veya decoder kare süresine yetişemezse FPS `%20` düşürülür; üç sağlıklı
pencereden sonra `%10` artırılır.

## 3d. color-grid-v1-experimental taşıması (L1)

Laboratuvar codec'i sekiz RGB küp köşesini kullanır; her hücre 3 bit taşır. İlk
hücre satırındaki sekiz referans rengi, kanal kazancı ve beyaz dengesi değişimine
karşı nearest-color kalibrasyonunu sağlar. 120×120 düzenin kullanılabilir ham
kapasitesi 5.347 bayttır; bu QR v27-L'nin 1.465 bayt kapasitesinin 3,65 katıdır.

İç raster zarfı `["PH" | length u16 | payload | CRC32]` biçimindedir. Bu ek CRC,
yanlış renge sınıflanan hücrenin Kionel DATA çerçevesine ulaşmadan reddedilmesini
sağlar.

Izgaranın dört köşesinde 3×3 siyah/beyaz finder bulunur. Kamera adaptörü köşeleri
verdiğinde decoder ters homografiyle rasteri kareye normalize eder ve finder
bütünlüğünü veriden önce doğrular.

**Deneysel sınır:** otomatik finder/köşe tespiti, gama modeli ve en az beş gerçek
telefonla ölçüm tamamlanmadan bu kapasite bir kamera goodput iddiası değildir ve
otomatik taşıma müzakeresinde ilan edilmez.

## 4. Bütünlük

- Çerçeve düzeyi: CRC-32 (yukarıda).
- İçerik düzeyi: **içerik zarfı** (L5, `envelope.ts`) dosya adını ve içeriğin
  CRC32'sini taşır. Zarf, çerçeve formatının içinde şeffaf bir yüktür; yeni meta
  alanı eklemek protokol sürümünü kırmaz.

  | Ofset | Boyut | Alan |
  |-------|-------|------|
  | 0 | 1 | `version` = 1 |
  | 1 | 1 | `nameLen` (utf8 bayt, ≤255) |
  | 2 | 4 | içerik CRC32 |
  | 6 | — | ad (utf8) + veri |

- CRC32 kazara bozulmayı yakalar, **sahteciliği yakalamaz**. Güvenli akışta
  AES-GCM içeriği doğrular; SHA-256 ve iki Ed25519 imzası kaynak ile teslim
  kaydını güvenli aktarım zarfına bağlar.

## 4b. Güvenlik (L4)

El sıkışma **sürekli çift yönlü kanal gerektirmez**. Alıcı tek bir sabit kare
gösterir, gönderen onu bir kez okur; gerisi tek yönlü akıştır.

```
1. alıcı   -> ekranda teklif karesi        [ver|rol|edPub 32|xPub 32|nonce 16|zaman 8|teyit 16|imza 64] = 170 B
2. gönderen: rolü, süreyi ve imzayı doğrular; aynı nonce'a bağlı cevap üretir
3. her iki ekranda 6 hane + 5 sembol belirir -> kullanıcılar iki faktörü de karşılaştırır
4. gönderen: zarf -> AES-256-GCM -> fountain -> QR akışı
5. alıcı   -> ekranda imzalı makbuz karesi
6. gönderen: makbuzu okur                  -> iki tarafta da kanıt
```

- Anahtar değişimi X25519. Oturum anahtarı HKDF-SHA256 ile **transkriptten**
  (iki kaydın tamamı) türetilir; anahtar, gerçekten görülen el sıkışmaya bağlıdır.
- SAS faktörleri aynı transkriptten ayrı HKDF etiketleriyle türetilen 6 hane ve
  5 semboldür. Farklı bir anahtar araya girerse iki ekrandaki değerler tutmaz.
- İçerik `iv(12) || AES-256-GCM(zarf)` olarak mühürlenir, sonra fountain kodlanır.
  **Çerçeve formatı değişmez** — şifreleme L2'nin üstünde, L5'in altında oturur.
- Gönderen Ed25519 ile sevk kaydını, alıcı ise bu kaydı da kapsayan teslim
  makbuzunu imzalar. Üçüncü taraf iki imzayı çevrimdışı doğrular (`pnpm verify`).

Neyi koruduğu ve **neyi korumadığı**: [THREAT-MODEL.md](THREAT-MODEL.md).

### 4c. Güvenli aktarım zarfı

İmzalı sevk kaydı ile mühürlü içerik fountain kodlamasından önce tek bir L5
zarfında birleştirilir:

```text
[version u8 = 1 | metadataLength u32 | dispatch JSON UTF-8 | iv 12 | AES-GCM ciphertext+tag]
```

`dispatch` gönderenin Ed25519 imzasını, içerik SHA-256 özetini, açık anahtarını,
oturum kimliğini, bayt sayısını ve cihaz saatini taşır. Alıcı şifreyi açıp içeriği
doğruladıktan sonra bu sevk kaydını da kapsayan Ed25519 teslim imzasını üretir.
Teslim makbuzu son bir statik QR ile gönderene geri verilir.

### 4d. Kurumsal audit zinciri

Doğrulanmış makbuzlar yerel, salt-eklemeli bir denetim zincirine bağlanabilir.
Her kayıt `seq`, önceki tam kaydın SHA-256 özeti, makbuz özeti, olay türü, cihaz
saati ve aktör Ed25519 açık anahtarını içerir. Kayıt aktör anahtarıyla imzalanır.
Bir kaydın silinmesi, sırasının veya herhangi bir alanının değiştirilmesi zincir
veya imza doğrulamasını düşürür. Bu yapı güvenilir zaman damgası sağlamaz.

### 4e. Kaynak sınırları

Bir Kionel v1 DATA çerçevesi işlenmeden önce bilinen tür, pozitif `blockSize`, DATA
payload/block eşitliği ve `totalBytes` sınırı doğrulanır. SDK en fazla 1 GiB ve
1.000.000 kaynak blok kabul eder. Referans web uygulaması mobil bellek baskısını
sınırlamak için ayrıca 64 MiB üst sınır uygular. Bu sınırlar güvenilmeyen optik
girdinin bellek/CPU tüketimi saldırısına dönüşmesini engelleyen protokol parçasıdır.

### 4f. Kionel v2 kurumsal kimlik profili

v2 taşıma DATA çerçevesini değiştirmez; kimlik, handshake ve kanıt kayıtlarını
P-256/SHA-256'ya yükseltir. Handshake kaydı 204 bayttır:

```text
[version=2 1 | role 1 | algorithm=ES256 1 | P-256 SEC1 pub 65 |
 X25519 pub 32 | nonce 16 | unix-ms 8 | confirm 16 | P1363 signature 64]
```

- P-256 açık anahtarı sıkıştırılmamış SEC1 (`0x04 || X || Y`) ve 65 bayttır.
- İmza IEEE P1363 `r || s`, 64 bayt ve low-S kanoniktir. Sıfır, eğri sırası dışı
  veya yüksek-S skalerleri doğrulayıcı reddeder.
- Sürüm, rol ve algoritma imzalı gövdededir. `KIONEL-V2-HANDSHAKE` domain'i ile iki
  kayıt transkripte; `kionel/v2/*` etiketleriyle confirm, AES anahtarı, SAS ve session
  kimliği HKDF'ye bağlanır.
- AES-256-GCM v2 içeriği `KIONEL-V2-CONTENT` additional authenticated data ile açılır.
- Sevk, teslim, audit ve qualification kayıtları `protocol = "kionel-v2"`, `alg =
  "ES256"` ve `urn:kionel:key:sha256:<digest>` anahtar kimliğini imzalı alana bağlar.
- v1 kayıtları v1 doğrulayıcıda kalır; v1/v2 parserları birbirinin kayıtlarını kabul etmez.

## 5. Sürümleme kuralı

Protokol değişikliği önce bu dosyaya yazılır, sonra kodlanır. Her yeni alan
`type` ile ayrılmış yeni bir çerçeve tipine gider; mevcut DATA çerçevesinin
düzeni v1 içinde değişmez.

## 6. Açık sorular (Faz 1'de kapanacak)

- **Sistematik önek:** ilk `k` çerçeve ham blok olarak gönderilirse temiz kanalda
  fazlalık 1.00'a iner ve ilk-bayta-kadar-süre anlamlı hale gelir. Dağılımı
  bozma riski ölçülmeli.
- **Gerçek `blockSize`:** QR sürüm/ECC seçimi ile kamera okunabilirliği arasındaki
  denge cihazda ölçülmeli. `PROFILES` içindeki değerler şu an veri sayfası
  tahminleridir.
- **fps:** tarayıcıda ekran yenileme + kamera yakalama + çözme zincirinin gerçek
  hızı. Tüm goodput rakamları buna doğrusal bağlı.
