# Metot sevki — çalışan referans akış

Durum: 2026-09-07, CLI ve kriptografik kabul kontrolü. Bir cihaz sürücüsü veya
valide edilmiş laboratuvar uygulaması değildir. Cihaza komut göndermez.

İş: operatörün elindeki dosyanın doğru cihaz için, izin verilen sürümde ve yetkili
kişilerin onayladığı içerikle aynı olduğunu uygulama öncesinde denetlemek.
Dosya optik kanalla veya kurumun izin verdiği başka bir taşıyıcıyla gelebilir.

## Hemen dene

Proje kökünde `pnpm method:demo` çalıştır. Komut `artifacts/method-demo-*` altında
kurmaca dosya, üç geçici yazılım anahtarı, yerel yetki politikası ve imzalı paketler
oluşturur. Gerçek CLI üzerinden hazırlama → inceleme → serbest bırakma → kontrol
adımlarını koşar. Önce `KABUL`, dosyayı değiştirdikten sonra `RED` çıkmalıdır.
Son dosya bilerek değiştirilmiş durumda bırakılır. Demo kimlikleri gerçek kişileri
temsil etmez; bu anahtarları üretimde kullanma veya dağıtma.

## Gerçek akışın komutları

Kimlikler mevcut `pnpm attest identity --identity=...` komutuyla oluşturulabilir.
Her imzalayan kendi anahtarını kendi cihazında tutar. Aşağıdaki isimler örnektir.
`--expires` ISO UTC tarihi olmalı; bu örnekteki tarihin kullanım gününde geçerli
olduğunu kontrol et. Çıktı dosyası zaten varsa komut üzerine yazmayı reddeder.

```powershell
pnpm method prepare method.txt --method=HPLC-42 --target=LAB-01 --revision=3 --expires=2026-10-01T00:00:00.000Z --identity=publisher.json --out=pending.json
pnpm method approve method.txt --release=pending.json --identity=reviewer.json --out=reviewed.json
pnpm method approve method.txt --release=reviewed.json --identity=approver.json --out=released.json
pnpm method check method.txt --release=released.json --policy=local-policy.json
```

Alıcı kurum yöneticisi `local-policy.json` dosyasını dosya sevkinden bağımsız
kurmalıdır. Güveni gönderenin paketinden almak, saldırganın kendi kendisine yetki
vermesi anlamına gelir. `publishers`, `reviewers`, `approvers` alanları kimlik
komutunun verdiği 43 karakterli base64url açık anahtarları içerir. Politika şeması:

| Alan | Anlam |
|---|---|
| `schema` | `kionel-method-policy/v1` |
| `methodId` | Kurumun beklediği metot kimliği |
| `target` | Operatörün çalıştığı cihaz/istasyonun kurum kimliği |
| `minimumRevision` | Kabul edilen en düşük pozitif tam sayı sürüm |
| `publishers` | Yetkili yayınlayan açık anahtarlarının dizisi |
| `reviewers` | Yetkili inceleyen açık anahtarlarının dizisi |
| `approvers` | Yetkili serbest bırakan açık anahtarlarının dizisi |

Kontrol yalnız açık anahtar ve dosya okur; özel anahtar istemez, kimlik oluşturmaz.
Çıkış kodları: 0 kabul, 1 doğrulama reddi, 2 kullanım/dosya/biçim hatası.

## Denetlenenler

- İçeriğin tam SHA-256 özeti ve bayt sayısı.
- İmzalı hedef, metot kimliği, sürüm, başlangıç ve bitiş zamanı.
- Yayınlayan imzası; önce inceleyen, sonra serbest bırakan onayı.
- Her rolün yerel politikada yetkili olması ve üç farklı imza anahtarı.
- Onayların belirli sevk imzasına bağlanması; başka pakete taşınamaması.
- Son onayın veya tüm onayların silinmesinin kabulü engellemesi.

## Güvencenin sınırı ve üretimde kalanlar

Üç farklı anahtar üç farklı insanı ispatlamaz. İnsan/kurum kimliği eşleme,
rol atama ve ayrılan çalışanların iptali kurumun sorumluluğundadır. CLI anahtarları
şifrelenmemiş JWK dosyalarıdır. Windows'ta `mode: 0600` tek başına NTFS erişim
kontrolü sağlamaz; üretimde donanım anahtarı ve kurum erişim yönetimi gerekir.

Süre kontrolü alıcının saatine dayanır. Güvenilir saat ve taze iptal verisi yoksa
kesin zaman/iptal güvencesi yoktur. `minimumRevision` yerel politikayla kontrol
edilir; otomatik, geri alınamaz sürüm sayacı veya tek kullanım garantisi yoktur.
Politika dosyasını değiştirebilen saldırgan yetkileri değiştirebilir.

Kabul edilen dosya sonradan değiştirilirse veya operatör başka dosyayı cihaza
yüklüyorsa bu CLI bunu engellemez. Üretim entegrasyonu doğrulanan baytları kontrollü
yükleyiciye vermeli, yükleme anında özeti tekrar kontrol etmeli ve cihazın fiilen
uyguladığı sürümü kaydetmelidir. Anlamsal metot doğruluğu, cihaz uyumluluğu, zararlı
içerik taraması ve laboratuvar validasyonu bu kontrolün dışında kalır.

Bu sürüm mevcut v1 Ed25519 kanıt çekirdeğini kullanır. TUF/in-toto uyumluluğu,
v2 donanım kimliği, kurumca imzalı politika dağıtımı ve geri alma korumalı durum
deposu henüz bu CLI'a bağlanmadı. Üretim tasarımı için bu hazır standartlarla
entegrasyon, yeni bir özel güven protokolü geliştirmekten önce değerlendirilmelidir.

Kod: `packages/crypto/src/method.ts`; CLI: `apps/attest/method.ts`.
