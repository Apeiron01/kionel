# Kionel Doğrulanabilir Kartvizit (tasarım notu — henüz yapılmadı)

Basılı bir QR'ın içine **imzalı** kişi/kurum bilgisi koymak. Sunucu yok, hesap yok,
yüklenen dosya yok. Kartın üstündeki kare veriyi *işaret etmez*, veriyi *taşır*.

Durum: **fikir aşaması.** Kod yazılmadı. Bu belge kapsamı ve açık soruları sabitler.

## Neden Kionel'a uygun

"Dosyanı bize yükle, sana QR verelim" fikri Kionel'un üç sütununu da kırıyordu:
veri sunucumuza uğruyordu, basılı QR'da fiziksel hedefleme yoktu ve yer sağlayıcı
sorumluluğu doğuyordu. Bu tasarımda üçü de yerinde kalıyor:

- Veri karttadır, bizde değildir. Barındırma yok, KVKK/GDPR veri sorumlusu değiliz.
- Doğrulama çevrimdışıdır; ağ yoktur.
- Mevcut `@kionel/crypto` imza katmanı ve `@kionel/enterprise` güven snapshot'ı aynen kullanılır.

## Tasarım kararı: düz vCard + `X-` imza alanı

Yük **standart metin vCard** olmalı, özel bir ikili biçim değil:

```
BEGIN:VCARD
VERSION:4.0
FN:...
ORG:...
EMAIL:...
TEL:...
X-Kionel-KID:<kısa anahtar kimliği>
X-Kionel-EXP:<son geçerlilik>
X-Kionel-SIG:<imza>
END:VCARD
```

Böylece **sıradan QR okuyucular kartı normal kişi kaydı olarak içeri alır** —
herkes için çalışır. Kionel'u bilen doğrulayıcı ise ek olarak imzayı kontrol eder.
Zarif düşüş: özel uygulama gerekmez, imza yalnız bir bonus katmandır.

İmza, `X-Kionel-SIG` satırı çıkarılmış kanonik vCard metni üzerinden alınır.

## Boyut bütçesi — işin zor tarafı burası

| Parça | Yaklaşık |
|---|---|
| Temel vCard alanları (FN, ORG, EMAIL, TEL) | ~200–260 bayt |
| `X-Kionel-KID` (kısa anahtar kimliği) | ~15 bayt |
| `X-Kionel-EXP` | ~12 bayt |
| `X-Kionel-SIG` (64 bayt imza, base64url) | ~86 bayt |
| **Toplam** | **~330–380 bayt** |

Bu, ECC-L'de yaklaşık **QR v13–v15** demek: 69–77 modül. 30 mm genişliğinde bir
kartvizit alanına basıldığında modül başına ~0,4 mm düşer.

Bu sayı **teoriktir ve ölçülmemiştir.** Basılı QR, ekrandaki QR'dan farklı davranır:
mürekkep yayılması, kağıt parlaması, katlanma ve aşınma vardır. Cihaz matrisinde
olduğu gibi burada da gerçek kanıt fiziksel testtir — kaç dpi, hangi kart boyutu,
hangi mesafe, hangi ışıkta kaç denemede kaç başarı.

Bütçe taşarsa sırayla: alan azalt (URL/TITLE atılabilir), açık anahtarı karta koyma
(yalnız kısa `KID`, anahtar doğrulayıcının güven listesinden gelir), ECC seviyesini
düşür (basılı kart temizdir ama aşınır — dikkatli).

## Ne kanıtlar, ne KANITLAMAZ

**Kanıtlar:** karttaki bilginin, `KID`'in işaret ettiği anahtar tarafından imzalandığını
ve **hiç değiştirilmediğini**. Kurum imzalıyorsa: "bu bilgiyi bu kurum onayladı."

**Kanıtlamaz — ve bunu ön yüzde yazmak zorundayız:**

- **Kopyalanamazlık yok.** Kartı fotoğraflayan biri aynı kartı basabilir. İmza
  *içeriğin sahteciliğini* engeller, *taklit edilmeyi* engellemez.
- **Kartı gösteren kişinin o kişi olduğunu kanıtlamaz.** Bu bir kimlik kartı değildir.
- **Anında iptal yok.** Basılı kart geri alınamaz. `EXP` alanı süre sınırı koyar;
  erken iptal ancak doğrulayıcının güncel imzalı iptal snapshot'ına
  (`@kionel/enterprise`, `trust:verify`) sahip olmasıyla görülür. Hiç güncellenmeyen
  bir doğrulayıcı iptali göremez.

Yani ürün "erişim kontrolü" değil, **"bu belgedeki bilgi kurumca onaylıdır"**.
Değerli olduğu yer: diploma/lisans/yetki belgeleri, saha denetçisi kimliği,
kurumsal kartvizit — kısaca *içeriğin doğruluğunun* önemli olduğu yerler.

## Eksikler

1. `@kionel/vcard`: kanonik vCard serileştirme + imzalama + doğrulama. Mevcut kripto
   katmanını kullanır, yeni primitif yok.
2. Baskı çıktısı: SVG/PDF, doğru modül boyutu, sessiz alan, kesim payı. Ekran QR'ı
   üreticisi baskı için doğrudan uygun değil.
3. Üretici arayüzü: tarayıcıda, yükleme yok, veri cihazdan çıkmaz.
4. Doğrulayıcı: kamera → "imzalı / imzasız / süresi dolmuş / iptal edilmiş".
5. **Yayıncı anahtarı dağıtımı.** Asıl ürün problemi bu: doğrulayıcı kurumun açık
   anahtarını nereden bilecek? Sabitlenmiş liste mi, ilk-karşılaşmada-güven mi,
   yoksa mevcut kurumsal güven snapshot'ı mı? Karar verilmeden ürün olmaz.
6. **Baskı/tarama kalifikasyonu:** gerçek yazıcı, gerçek kart, gerçek telefon.
   Cihaz matrisiyle aynı disiplin: ölçülmeden iddia edilmez.
7. Konumlandırma metni: yukarıdaki "kanıtlamaz" listesi ürünün ön yüzünde olmalı.

## Sıra

Lab pilotundan **sonra**. Bu iş küçük ve temiz ama gelir getiren alıcı orada değil;
odak dağıtırsa maliyeti kendi değerinden büyük olur.
