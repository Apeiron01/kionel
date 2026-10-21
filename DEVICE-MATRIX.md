# Fiziksel cihaz matrisi — operatör talimatı

PRODUCT-READINESS P0/1. Kapı: **en az 5 cihaz, 5 yönlü çift, çift başına 1.000
aktarım, en az %99 başarı, sıfır sessiz bozulma.** Bu kapı yeni donanım, sertifika
veya denetçi istemez; elinizdeki telefonları ister.

## Sessiz bozulma neden özel bir yük gerektiriyor

Sessiz bozulma = aktarım **başarıyla tamamlandı** (fountain çözüldü, CRC geçti,
AES-GCM etiketi doğrulandı) ama içerik yanlış. Bu kanalın değil kodun hatasıdır.

Rastgele bir kullanıcı dosyası gönderildiğinde alıcının karşılaştıracağı bir
referans yoktur; dolayısıyla bu kapı ölçülemez. Bu yüzden matris koşusunda yük
her iki tarafta da aynı şekilde türetilir (`attemptPayload`), alıcı beklediğini
yeniden hesaplar ve bayt bayt karşılaştırır.

> Not: bu doküman yazılmadan önce web akışındaki `silentCorruptions` sayacı
> hiçbir yerde artırılmıyordu — kapı düşemeyeceği için hiçbir şey kanıtlamıyordu.
> Artık gerçek karşılaştırma yapılıyor.

## Hazırlık

1. Beş cihaz seçin ve her birine kısa, sabit bir etiket verin (`pixel-9-a`,
   `lab-ipad-b`, …). Etiketler kanıta imzalanır; sonradan değiştirmeyin.
2. Beş **yönlü** çift kurun. Yön önemlidir: `a→b` ile `b→a` ayrı çiftlerdir.
   Halka en kolayıdır: a→b, b→c, c→d, d→e, e→a.
3. Her cihazda demoyu `?qualification=1` ile açın:
   `https://<sunucu>:5173/?qualification=1`
4. Ölçüm koşusu boyunca ışık, mesafe ve tutuş biçimini sabit tutun; değiştirirseniz
   ayrı bir koşu olarak kaydedin.

## Bir deneme

Alıcı cihazda **Fiziksel cihaz kalifikasyonu** panelini açın, gönderici ve alıcı
etiketlerini girin.

1. **Gönderici:** panelde `Matris yükü üret` → 4 KB'lık deterministik yük dosya
   olarak yüklenir (`kionel-matrix-<n>.bin`).
2. Normal akış: alıcı teklif QR'ını gösterir, gönderici okur, iki ekranda **6 hane
   ve 5 sembol** karşılaştırılır, onaylanır, aktarım başlar.
3. Alıcı tamamladığında sonucu kendi kimliğiyle kaydeder. İçerik beklenen yükle
   eşleşmezse aktarım **SESSİZ BOZULMA** olarak reddedilir ve sayaca işlenir.
4. `Sonraki deneme` ile devam edin. Başarısız/yarım kalan deneme için
   `Açık denemeyi başarısız kapat`.

## Kanıtın toplanması

Her alıcı cihazda `İmzalı cihaz matrisini indir` → `kionel-device-matrix.json`.
Dosyalar cihazın kendi anahtarıyla imzalıdır; içeriği elle düzenlenirse imza düşer.

```bash
pnpm matrix:merge lab-a.json lab-b.json lab-c.json lab-d.json lab-e.json --out=matrix.json
pnpm qualify --device-matrix=matrix.json --out=qualification.json
```

`qualify` sıfır dönerse kapı geçilmiştir. Aksi hâlde `physical.reason` hangi
çiftin neden düştüğünü söyler.

## Süre beklentisi

Deneme başına 4 KB, QR v27 @ ~24 kare/sn: aktarım birkaç saniye, el sıkışma ve
onay dahil deneme başına ~10–15 saniye. Çift başına 1.000 deneme, tek tek elle
yapıldığında gerçekçi değildir.

## Otomatik koşu

Elle 1.000 deneme gerçekçi olmadığı için gönderici tarafta zincirleme mod vardır.

1. Yukarıdaki adımlarla **bir kez** el sıkışın ve SAS'ı elle karşılaştırıp onaylayın.
2. Aktarım başlayınca göndericide `Matris koşusunu başlat (1000)` görünür.
3. Koşu boyunca tek kripto oturumu korunur: **yeni el sıkışma ve yeni SAS onayı
   yoktur.** Otomasyon SAS onayını asla kendi vermez — o adım insanda kalır.
4. Alıcı her denemeden sonra decoder'ı sıfırlayıp taramaya devam eder; makbuz QR'ı
   gösterilmez, çünkü kamerayı kapatırdı.

Denemeler arasında 700 ms boşluk bırakılır. Uçuşta kalan kareler bir sonraki
denemenin decoder'ına karışabilir; bu durumda AES-GCM etiketi düşer ve deneme
**başarısız** sayılır. Sessiz bozulma olarak raporlanamaz — sessiz bozulma için
bütünlük kontrollerinin tamamının geçmesi gerekir. Yani otomasyonun en kötü etkisi
başarı oranını bir miktar düşürmektir, ölçümü yanıltmak değil.

Simplex modda bitiş sinyali olmadığı için deneme başına 60 kare bütçesi vardır;
duplex ARQ'da ACK "tamamlandı" dediği anda sonraki denemeye geçilir.

> **Önce doğrula:** bu otomasyon gerçek kamerayla henüz koşulmadı. İlk çiftte
> 20–30 denemelik kısa bir koşu yapıp başarı oranına bakın. Oran beklenmedik
> şekilde düşükse `MATRIX_GAP_MS` ve `MATRIX_FRAME_BUDGET` değerlerini
> ölçtüğünüz davranışa göre ayarlayın; bu iki sayı tahminle konmuştur.

## Kapsam

Bu matris optik kanalın gerçek cihazlarda çalıştığını ölçer. Donanım anahtar
kanıtı (TPM/StrongBox/Secure Enclave) ayrı bir kapıdır ve bu koşudan bağımsızdır.
