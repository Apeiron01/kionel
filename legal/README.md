# Hukuki metinler

| Belge | Kapsam |
|---|---|
| [GIZLILIK.md](GIZLILIK.md) | KVKK aydınlatma + GDPR bilgilendirme, yerel depolama envanteri, ePrivacy m.5(3) analizi, ilgili kişi hakları |
| [KULLANIM-SARTLARI.md](KULLANIM-SARTLARI.md) | Lisans, garanti reddi, sorumluluk sınırı, kritik kullanım yasağı, uygulanacak hukuk |
| [KABUL-EDILEBILIR-KULLANIM.md](KABUL-EDILEBILIR-KULLANIM.md) | Yasak kullanımlar ve uygulama araçlarının gerçek sınırı |
| [GUVENLIK-BILDIRIMI.md](GUVENLIK-BILDIRIMI.md) | Açık bildirimi, güvenli liman, yanıt süreleri |
| `apps/web/public/.well-known/security.txt` | RFC 9116 makine tarafından okunabilir bildirim kanalı |

## `apps/web/policies.html` ile ilişki

Bu klasör **kanonik kaynaktır.** Sitedeki `policies.html` sayfası bu metinlerden
üretilmelidir.

Şu an ikisi ayrışmış durumda: `policies.html` aynı başlıkları taşıyor ama
barındırma erişim kayıtlarını, EDPB 2/2023 kapsamındaki yerel depolama
gerekçelendirmesini, hukuki dayanakları, TBK m.115 sınırını ve VERBİS durumunu
içermiyor. Aynı anda ikisi birden yayında olmamalıdır; yayına çıkmadan önce
`policies.html` bu metinlerden yeniden üretilecek.

## Yayına almadan önce doldurulacaklar

Bu metinler içerik olarak tamamlanmıştır. Tek eksik, uydurulması hâlinde belgeyi
geçersiz kılacak olan gerçek kimlik ve altyapı bilgileridir.

- [ ] Ticari unvan, MERSİS/vergi no, açık adres
- [ ] `privacy@`, `security@`, `abuse@` adreslerinin kurulması
- [ ] KEP adresi
- [ ] Barındırma sağlayıcısı, işlenen bölge, erişim kaydı saklama süresi
- [ ] E-posta sağlayıcısı ve yazışma saklama süresi
- [ ] Yurt dışı aktarım mekanizması (KVKK m.9 dayanağı + GDPR SCC)
- [ ] Yetkili mahkeme ve icra dairesi
- [ ] PGP anahtarı ve parmak izi, `pgp.txt`
- [ ] `security.txt` içindeki `Expires` alanı (bir yıldan kısa olmalı, süresi
      dolmuş bir security.txt yoksundan kötüdür)
- [ ] Yürürlük tarihleri

## Neden bunlar uydurulmadı

Sahte bir tüzel unvan veya çalışmayan bir başvuru adresi taşıyan gizlilik
politikası, olmayan politikadan daha kötüdür: aydınlatma yükümlülüğünü
karşılamaz, ilgili kişinin başvuru hakkını fiilen engeller ve ilk kurumsal
incelemede fark edilir.

## Bu metinler neden şablon değil

Şablon politikaların çoğu bu ürün için yanlış olurdu, çünkü ürünün yapısı
alışılmadık. Metinlerdeki farklar bilinçlidir:

- **"Veri toplamıyoruz" ile yetinilmedi.** Barındırma sağlayıcısının erişim
  kayıtları gerçek bir işleme faaliyetidir ve ayrı bir bölümde, hukuki dayanağı
  ve saklama süresiyle açıklanmıştır. Şablonlar bunu atlar.
- **Yerel depolama, çerez olmadığı için görmezden gelinmedi.** EDPB'nin 2/2023
  sayılı kılavuzu m.5(3)'ü teknolojiden bağımsız yorumlar: IndexedDB ve
  localStorage kapsamdadır. Her kalem için "kesinlikle gerekli" istisnasına
  girip girmediği tek tek gerekçelendirilmiştir.
- **Çerez onay bandı yok, çünkü onaylanacak bir şey yok.** Gerekmeyen bir onay
  bandı göstermek, gerekli olanı göstermemek kadar hatalıdır.
- **Sorumluluk sınırı, sınırının farkında.** TBK m.115 uyarınca ağır kusur ve
  kasttan doğan sorumluluk önceden kaldırılamaz. Bunu yazmayan bir madde,
  tamamının geçersiz sayılması riskini taşır.
- **Kabul edilebilir kullanımda denetleyemediğimiz açıkça yazıldı.** İçeriği
  göremeyen bir hizmetin "izliyoruz" demesi hem yanlış hem de savunulamaz olurdu.

## Sınır

Bu metinler mevzuata ve resmî kılavuzlara dayanılarak, ürünün gerçek davranışına
birebir uyacak şekilde hazırlanmıştır. Yerini alamayacakları tek şey, sizin
somut ticari yapınıza (şirket türü, hedef pazarlar, sözleşme modeli) bakan bir
avukatın gözden geçirmesidir. Ücretli kurumsal satışa geçmeden önce bir kez
inceletilmesi önerilir; o aşamada zaten sözleşme metinleri de gerekecektir.
