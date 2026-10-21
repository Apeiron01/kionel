# Kionel Enterprise enrollment ve çevrimdışı trust bundle

`@kionel/enterprise`, kurum kök anahtarıyla imzalanmış tenant/site cihaz envanteri,
transfer politikası ve iptal listesini tek doğrulanabilir snapshot'ta taşır. Snapshot
hassas dosya, dosya özeti, kamera karesi veya oturum anahtarı içermez.

## Güven zinciri

1. Kurumun P-256 trust anchor açık anahtarı istemciye imzalı kurulum paketiyle,
   yönetici kontrollü ayrı bir kanaldan sabitlenir.
2. Attestation verifier, cihazın platform anahtarını doğrular. Kanıt en fazla 24 saat
   içinde enrollment kaydına dönüştürülür.
3. Kurum otoritesi; tenant, artan sequence, geçerlilik, cihazlar, site/roller,
   transfer politikası ve zaman-etkili iptalleri kapsayan snapshot'ı imzalar.
4. İstemci imza, sabit root, tenant, süre ve yerel `minimumSequence` değerini
   doğrular. Başarılı nesne dondurulur ve doğrulanmış runtime markası alır.
5. SDK, hem yerel hem karşı P-256 URN'ini snapshot'ta arar. Kayıp, süresi dolmuş,
   iptal edilmiş, yanlış site veya yanlış role sahip cihazla oturum açılmaz.

## Rollback koruması

Her tenant/site istemcisi kabul ettiği en yüksek `sequence` değerini korumalı depoda
saklar. Yeni snapshot doğrulanırken bu değer `minimumSequence` olarak verilmelidir.
Daha eski fakat imzası geçerli snapshot reddedilir. Snapshot kabulü atomik olmalıdır:
dosya ve sequence birlikte güncellenir; güç kesintisinde eski ikiliden biri seçilir,
karışık durum kullanılmaz.

Bundle ömrü en fazla 90 gün, cihaz enrollment cryptoperiod'u en fazla 400 gündür.
Kurum daha kısa süre belirleyebilir. Air-gap kurulumda güncel iptal listesinin taşınma
sıklığı risk analizinde açıkça belirlenmelidir; süresi dolmuş snapshot ile çalışma
seçeneği yoktur.

## İptal davranışı

İptal nedenleri `key-compromise`, `device-lost`, `retired`, `role-ended` ve
`policy-violation` ile sınırlıdır. `effectiveAt` öncesi yeni oturum açılabilir,
o anda ve sonrasında reddedilir. İptal geçmiş makbuzun kriptografik imzasını silmez;
inceleme aracı makbuz zamanı ile iptal zamanını birlikte raporlamalıdır.

Anahtar kompromisinde:

1. cihaz derhal iptal edilir ve daha yüksek sequence snapshot yayımlanır;
2. yeni anahtar yeni attestation ve enrollment ile oluşturulur;
3. eski açık anahtar geçmiş kanıtların doğrulanması için salt okunur tutulur;
4. olay zamanı öncesi/sonrası makbuzlar ayrı risk sınıfında incelenir.

## Çevrimdışı doğrulama

```bash
pnpm trust:verify kionel-trust.json \
  --anchor=tenant-root-key.json \
  --tenant=tenant-global-1 \
  --min-sequence=42
```

Komut hiçbir ağa çıkmaz. `--min-sequence` değerini operatörün elle tahmin etmesi
üretim modeli değildir; signed native istemci bunu korumalı yerel state'ten almalıdır.

## Açık üretim işleri

- Yönetim servisinde iki kişilik onayla enrollment, iptal ve snapshot yayımlama.
- Kurum otorite anahtarının HSM/KMS içinde tutulması, rotasyonu ve felaket kurtarması.
- Signed native istemcide atomik snapshot/state depolama ve managed-clock politikası.
- Android, Windows ve Apple attestation verifier uygulamaları ve root/revocation güncellemesi.
- Snapshot dağıtımının online, MDM ve fiziksel offline paket yollarında imza doğrulaması.

