# Lisans dosyası mekanizması (yalnız ticari lisans için)

**Güncel durum (21 Ekim 2026):** Kionel açık kaynaktır (AGPL-3.0, doğrulayıcılar
Apache-2.0). Açık sürüm hiçbir özelliği lisans dosyasına bağlamaz ve lisans
dosyası istemez (`apps/web/src/app.ts` içinde `OPEN_EDITION`). Aşağıda anlatılan
imzalı lisans dosyası mekanizması, ticari lisans müşterilerine gerektiğinde imzalı
bir kullanım belgesi verebilmek için korunur. Aşağıdaki "kapalı kaynak" ve "demo"
gerekçeleri 17 Eylül 2026 kararına aittir ve artık geçerli değildir.
Ticari lisans: [COMMERCIAL.md](COMMERCIAL.md). Hangi kod hangi lisansla:
[LICENSING-MAP.md](LICENSING-MAP.md).

`pnpm license authority --out=public.json` otoriteyi açıkça oluşturur. `issue` eksik
otoriteyi üretmez; `verify` için `--authority=public.json` zorunludur ve özel anahtar
gerekmez. Çıktı dosyalarının üzerine yazılmaz.

## 1. Sunucu yokken lisans nasıl zorlanır?

Microsoft modeli iki şeye dayanır: çevrimiçi aktivasyon ve işletim sistemi
seviyesinde zorlama. Bizde ikisi de yok ve olmayacak: aktarım uygulaması hiçbir
sunucuya bağlanmaz, bu ürünün vaadidir.

Zorlama bu yüzden **imzalı, süreli, çevrimdışı doğrulanan lisans dosyasına** dayanır:

- Dosyayı yalnız Kionel otoritesi imzalayabilir; özel anahtar istemciye gitmez.
- Uygulama gömülü açık anahtarla dosyayı yerelde doğrular. Dosyanın kendi `issuer`
  alanına güvenilmez.
- `entitlement()` tek karar noktasıdır: `licensed` → tam kullanım, `grace` (süre
  bitiminden sonraki 14 gün) → tam kullanım + yenileme uyarısı, `demo` → yalnız
  örnek veri.

**Tavan:** istemci kodu yamalanabilir, cihaz saati geri alınabilir. Kabul ediyoruz:
kaynak yayımlanmıyor, kod küçültülüyor ve alıcı denetlenen bir kurum. ISO/IEC
27001:2022 Ek A 5.32 ve ISO/IEC 17025 kapsamında lisanssız veya atlatılmış yazılım
kurumun kendi denetim bulgusudur. Aşılırsa: donanım kasasında monoton sayaç veya
imzalı zaman damgası.

## 2. Asla yapmayacaklarımız

- **Veriyi rehin almak yok.** Süre bitince yeni aktarım kapanır; daha önce üretilmiş
  kayıtlar, müşterinin dosyaları ve doğrulama (Apache-2.0 yolu) asla kapanmaz.
- **Aktivasyon çağrısı yok.** Aktarım uygulaması hiçbir sunucuya bağlanmaz.
- **Güvenliği katmana bölmek yok.** Demo ile lisanslı sürümün kriptografisi aynıdır.
- **Uyarısız durdurma yok.** Süre bitiminden sonra 14 gün ek süre ve görünür uyarı.

## 3. Lisans dosyasının biçimi

```
{
  "schema": "kionel-license/v1",
  "v": 1,
  "licensee": "...",           // ticari unvan
  "tier": "pilot | oem | enterprise",
  "scope": { "sites": 3, "devices": 40, "productLines": ["..."] },
  "issuedAt": "...",
  "validUntil": "...",
  "issuer": "...",           // SEC1 P-256 açık anahtarı, base64url
  "sig": "..."
}
```

- İmzalanan baytlar alan alan ve sırayla kurulur; ek alan kabul edilmez.
- Uygulamada tek satır olarak görünür: kurum, katman, bitiş tarihi, kalan gün.
- Web uygulamasında açık anahtar derlemeye gömülür (`apps/web/vite.config.ts`,
  kaynağı `config/commerce.local.json > licensePublicKey`). Anahtar yoksa uygulama
  yalnız demo çalışır.

## 4. Katman bazında ne yapar

| Katman | Lisans dosyası | Açılan | Açılmayan |
|---|---|---|---|
| Demo | Yok | Örnek veriyle aktarım ve doğrulama | Kendi verisiyle her şey |
| Lab Pilot | 1 ay | Kendi verisiyle aktarım, karşı imza | Destek, SLA, kalifikasyon |
| Lab Subscription | 12 ay, yenilenir | Kendi verisiyle aktarım, karşı imza, güncellemeler | SLA ve hizmet paketleri |
| OEM | Yıllık | Ticari gömme, karşı imza | — |
| Kurumsal | Yıllık | Yukarıdakiler + güven hizmeti (enrollment, iptal beslemesi) | — |

Süre bitince her katman aynı yola girer: 14 gün ek süre → demo. Süresi dolmuş
lisansla yeni karşı imza atılmaz.

## 5. Durum

- `packages/licensing/` imzalar, çevrimdışı doğrular ve `entitlement()` hesaplar;
  `pnpm license` üretir ve kontrol eder.
- Web uygulaması lisans dosyası yükleme, demo modu ve süre kapısını uygular
  (`apps/web/src/app.ts`, "lisans" bölümü). Kapı gönderen tarafta: kendi dosyası
  lisans ister; alıcı kapatılmaz, çünkü lisanslı gönderenin teslimini bozardı.
- Kionel Proof ve metot sevki CLI'ları (`pnpm attest`, `pnpm method`) imza atan
  her komutta lisans ister; salt doğrulama komutları istemez. Açık anahtar yalnız
  kurulumla gelen `config/license-public.json` dosyasından okunur, komut satırından
  alınmaz. Tavan: CLI TypeScript kaynağı olarak dağıtılırsa yamalanabilir; müşteri
  paketi tek dosyalık derlenmiş sürüm olmalı.
- **Açık:** otorite özel anahtarı bir dosyada duruyor. Kaybolursa yeni lisans
  imzalanamaz, sızarsa herkes bizim adımıza lisans üretir. Üretimde HSM/KMS gerekir.
- Lab Subscription uygulandı: her yenileme siparişinde 12 aylık yeni lisans
  imzalanır; müşteri ilk satın almada gösterilen lisans anahtarıyla güncel dosyayı
  `/purchase.html` üzerinden istediği zaman indirir. İade edilen abonelik gecikmiş
  ödeme olayıyla canlanmaz. **Açık:** gerçek Polar hesabında sandbox yenileme testi.

## 6. Kionel karşı imzası

`packages/licensing/src/countersign.ts`. Laboratuvar ölçümü yapar ve kendi adına
imzalar. Bunun **üstüne**, geçerli lisansı olan müşteri için Kionel otorite
anahtarıyla karşı imza atılır.

| | Kopyalanabilir mi? | Bize bağımlı mı? |
|---|---|---|
| Kendi imzalı kalifikasyon raporu | Evet | Hayır |
| **Kionel karşı imzası** | **Hayır** | **Evet** |

Üç kural, hepsi test edilmiş durumda:

1. **Süresi dolmuş lisansla YENİ karşı imza atılmaz.**
2. **Daha önce atılmış karşı imza sonsuza kadar geçerli kalır.**
3. **Karşı imzasız belge reddedilmez.** Kendi imzasıyla geçerli bir rapordur,
   yalnız bağımsız bir karşı imza taşımaz.

Denetçi açısından *"bu ölçümü biz yaptık"* ile *"bu ölçümü biz yaptık ve tedarikçi
bağımsız olarak karşı imzaladı"* aynı cümle değildir.

## 7. Ödeme akışı

Polar merchant of record olarak ödemeyi ve uluslararası vergiyi üstlenir; yurt
dışı B2B satış için uygun araçtır. Ödeme tamamlandığında Worker lisans dosyasını
**bizim anahtarımızla** imzalar ve teslim eder.

Polar'ın kendi lisans anahtarı özelliği kullanılmaz: doğrulaması çevrimiçidir.
Kasa Polar, lisans otoritesi biz.
