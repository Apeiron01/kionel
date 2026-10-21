# Kionel doğrulama komutları

## Import Check — 18 Ekim 2026

Yeni web aracını üretmek: `pnpm web:import-check`. Sayfalar `import-check.html`
(EN), `csv-aktarim-kontrolu.html` (TR) ve `excel-import-check.html` (Excel adayı).

İlgili anlamlı kontroller:

```powershell
pnpm exec vitest run packages/lab-workflows/src/import-check.test.ts apps/web/src/excel-import.test.ts packages/lab-workflows/src/handover-contract.test.ts packages/lab-workflows/src/sample-reconciliation.test.ts
pnpm typecheck
pnpm build
```

Bu koşuda dört dosyada 48 test geçti. Excel testleri sahte host sınırını sınar;
gerçek Excel veya Microsoft mağaza sertifikasyonu değildir. Normal/hatalı CSV,
indirilen çıktı/rapor hash'leri, profil yükleme, eski sonucun kapanması ve mobil
genişlik yerel gerçek tarayıcıda kontrol edildi. Rapor:
`artifacts/import-check-2026-10-18/browser-checks.json`.

Derlenmiş dosyaları üretimdeki `html_handling: none` ile yerelde sunmak için:

```powershell
pnpm exec wrangler dev --config artifacts/import-check-2026-10-18/wrangler.local.jsonc --local --ip 127.0.0.1 --port 8789 --inspector-port 9239 --show-interactive-dev-session=false
```

Bu yapı yalnız statik dosyaları sunar; üretim D1, ödeme veya e-posta bağlantısı
kullanmaz. Excel manifesti ve üretim URL'si 18 Ekim 2026'da yayımlandı. Gerçek Excel
host koşusu, mağaza ikon/görselleri, yayıncı hesabı ve inceleme ayrıca gerekir.

Canlı sürüm: `9b20f30`; Cloudflare sürüm kimliği:
`8b517153-1d9c-4437-950f-76edc2f6247b`.
Tam yayın koşusu: 63 test dosyası geçti, 1 dosya atlandı; 492 test geçti,
1 test atlandı. Typecheck, derleme, commerce dry-run ve bağımlılık denetimi geçti.
Canlı Türkçe araçta geçerli/hatalı örnekler ve gerçek dosya seçimi sınandı;
normal sayfa ve Excel adayı güvenlik başlıkları HTTP üzerinden doğrulandı.
Mevcut Polar teklif/fiyat yanıtı ve ödeme sayfası yüklendi. Gerçek ödeme,
üretim ödeme webhook'u veya banka hesabına çekim denemesi yapılmadı.
Kayıt: `artifacts/import-check-2026-10-18/deployment.json`.

## Önceki ürün doğrulama komutları

Proje kökünde:

```powershell
pnpm typecheck
pnpm test
pnpm build
pnpm audit
pnpm method:demo
pnpm bench:optical
```

7–8 Eylül 2026 incelemesinin son tam birim/entegrasyon koşusu: 33 dosya,
282 test. Typecheck ve web derlemesi başarılı; bağımlılık denetimi bilinen
güvenlik açığı bildirmedi. Bunlar bağımsız güvenlik incelemesi değildir.
Native Android/Windows derlemeleri ve milyonlarca fuzz çalıştırması bu oturumda
yeniden koşulmadı. Önceki sonuçlar bu oturumun doğrulaması gibi sunulmamalı.

TSA testleri gerçek OpenSSL kullanır. PATH'te bulunmalı; Windows'ta Git ile gelen
`C:/Program Files/Git/usr/bin/openssl.exe` da desteklenir. Başka kurulum için
`KIONEL_OPENSSL` ortam değişkenine yürütülebilir dosyanın yolunu ver.
TSA test sertifikalarının geçerliliği de test zamanı için uygun olmalıdır.

## Gerçek tarayıcı başlangıç kontrolü

`pnpm test:browser` çalışan geliştirme sunucusunu ve ayrı bir Chrome profilini
kontrol eder. Node'un yerleşik WebSocket API'si kullanılır; ek paket gerektirmez.
Varsayılan adresler yalnız loopback'tir: HTTPS 5173 ve Chrome debug 9223.

İlk terminalde `pnpm dev` çalıştır. Ayrı PowerShell terminalinde:

```powershell
New-Item -ItemType Directory -Path artifacts -Force | Out-Null
$kionelReviewProfile = Join-Path (Get-Location).Path 'artifacts\chrome-review'
Start-Process -FilePath 'C:\Program Files\Google\Chrome\Application\chrome.exe' -WindowStyle Hidden -ArgumentList @('--headless=new', '--disable-gpu', '--ignore-certificate-errors', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9223', ('--user-data-dir="' + $kionelReviewProfile + '"'), 'about:blank')
pnpm test:browser
```

Bu Chrome profili test içindir; sertifika istisnası geliştirme HTTPS sertifikası
içindir. Test profilinde kullanıcı oturumu veya gerçek dosya açma. Test, kurmaca
1 MB dosyayı arayüze seçer; dosyayı bir yere göndermez. Tarayıcının yerel anahtarını
oluşturur, yenilemeyle kalıcılığı ve özel anahtarın çıkarılamazlığını denetler.

Çıktılar `artifacts/browser-review.json` ve `artifacts/web-review-mobile.png`.
Çalışma zamanı hataları, kalıcı kimlik kaybı, mobil/masaüstü sayfa taşması, ürün
durumunun eski kalması veya yeni tahmin açıklamasının görünmemesi hata sayılır.
Bu test fiziksel kamera, eşleme veya tam optik dosya aktarımı yapmaz.

## Sentetik optik benchmark

`pnpm bench:optical --trials=8` aynı görüntü alanında 27 konfigürasyonu karşılaştırır.
JSON raporunda `physicalDeviceRun: false` bulunur. P95 süreler küçük örneklem ve
aynı bilgisayar için geçerlidir. Model hızı, gerçek kamera goodput'u değildir.
Aktarım hızı için [DEVICE-MATRIX.md](DEVICE-MATRIX.md) koşuları gerekir.
