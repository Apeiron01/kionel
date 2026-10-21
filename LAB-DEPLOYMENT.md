# Kionel Lab Pilot ve Dağıtım Planı

## Hedef kullanım

İlk ticari paket, ağ bağlantısının yasak veya istenmeyen olduğu laboratuvarlarda
küçük/orta boy doğrulanabilir veri teslimidir: cihaz konfigürasyonu, kalibrasyon
dosyası, numune manifesti, sonuç özeti ve imzalı teslim tutanağı. Kionel bir LIMS'in
yerine geçmez; LIMS veya cihaz yazılımına gömülen çevrimdışı teslim katmanıdır.

## Pilot paketi

- `@kionel/core`, `@kionel/crypto` ve `qr-v1` SDK'ları.
- Çevrimdışı, kilitli web referans uygulaması.
- Makbuz ve audit ledger CLI doğrulayıcıları.
- Tehdit modeli, protokol spesifikasyonu ve bağımlılık envanteri.
- İki günlük entegrasyon çalışması ve pilot boyunca hata düzeltme desteği.
- Kuruma özel dosya boyutu, saklama ve anahtar yenileme politikası.

Renkli ızgara pilot kapsamına alınmaz; perspektif düzeltme ve gerçek cihaz matrisi
tamamlanana kadar yalnız Ar-Ge özelliğidir.

## Pilot kabul kapıları

1. En az beş telefon ve hedef laboratuvar ekranlarıyla cihaz matrisi tamamlanmalı.
2. Her cihaz çiftinde 1.000 ardışık aktarımda sessiz veri bozulması sıfır olmalı.
3. `%20` sentetik kare kaybında tamamlama başarısı en az `%99` olmalı.
4. Güç/kamera kesintisi sonrası aynı oturum checkpoint'ten devam edebilmeli.
5. Yanlış SAS, değiştirilmiş frame, makbuz ve audit kaydı reddedilmeli.
6. Ağ trafiği kaydında uygulama kaynaklı dış bağlantı görülmemeli.
7. Bağımsız kriptografi ve web uygulama güvenlik incelemesi yüksek/kritik açık
   bırakmadan kapanmalı.
8. Kurumun veri sınıflandırması, saklama süresi ve olay müdahale prosedürü yazılı onaylanmalı.

Sentetik qualification ve release checksum manifesti:

```bash
pnpm qualify -- --size=262144 --trials=100 --out=qualification.json
```

Fiziksel koşu sonuçları `apps/qualification/device-matrix.example.json` şemasında
toplanır ve tam pilot kapısı şu komutla değerlendirilir:

```bash
pnpm qualify -- --trials=100 --device-matrix=device-matrix.json --out=pilot-report.json
```

Ölçüm toplamak için web uygulamasını `?qualification=1` sorgusuyla açın. Alıcı cihaz ve
gönderici etiketlerini girin; tamamlanan aktarım otomatik, başarısız deneme paneldeki
düğmeyle kaydedilir. **İmzalı cihaz matrisini indir** çıktısı yukarıdaki komuta verilir.
Qualification aracı eski imzasız dizileri veya sonradan değiştirilmiş sayaçları kabul etmez.
Birden çok alıcı cihazın çıktısını imzaları değiştirmeden birleştirin:

```bash
pnpm matrix:merge cihaz-a.json cihaz-b.json cihaz-c.json --out=device-matrix.json
```

## Güvenli dağıtım

- Uygulama laboratuvarın yönettiği HTTPS origin'den veya imzalı native sarmalayıcıdan sunulur.
- `_headers` dosyasındaki CSP ve güvenlik başlıkları dağıtım katmanında doğrulanır.
- Origin yalnız Kionel'a ayrılır; aynı origin'de üçüncü taraf script çalıştırılmaz.
- Tarayıcı profili cihaz politikasıyla kilitlenir, geliştirici araçları ve uzantılar sınırlandırılır.
- Cihaz işletim sistemi güncel tutulur; kamera ve ekran dışındaki izinler kapatılır.
- Audit ledger vardiya/iş günü sonunda kurumun salt-eklemeli arşivine aktarılır.
- Anahtar yenileme ve cihaz kaybı olayları cihaz envanterinde kayıt altına alınır.

## Pilot dışı iddialar

Bağımsız kanıt oluşmadan Kionel için GLP/GMP, ISO 17025, HIPAA, GDPR veya benzeri
mevzuata “otomatik uyum” iddia edilmez. Kionel teknik kontrol sağlar; uyumluluk süreç,
insan, fiziksel güvenlik ve kurum politikalarının birlikte değerlendirilmesini gerektirir.

## Ticarileştirme sırası

1. Yalnız örnek veriyle çalışan web demo (kullanım hakkı vermez).
2. Tek laboratuvarda ücretli, dar kapsamlı pilot.
3. Ölçüm raporu ve bağımsız güvenlik incelemesi.
4. Lab SDK lisansı: sürüm sabitleme, entegrasyon desteği ve doğrulama araçları.
5. Enterprise paket: cihaz envanteri, merkezi politika, dış TSA/audit arşivi ve SLA.

İlk satış mesajı hız değildir: “ağa çıkmadan, fiziksel olarak hedeflenmiş ve iki
tarafça imzalanmış teslim.”
