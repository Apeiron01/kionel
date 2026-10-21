# Genel kullanıma (GA) kadar fazlar

Hedef: pilot ve MVP seviyesinin üstünde, satılabilir bir ürün.

## Önce bir şeyi netleştirelim: pilot atlanamaz

"Pilotu atlayıp doğrudan son ürünü çıkaralım" isteği anlaşılır ama **fiziksel
olarak mümkün değil.** Sebebi sıralama tercihi değil, ürünün ne olduğu:

Son ürünün merkezî iddiaları **kanıt iddialarıdır**:

- "5 cihazda %99 başarı" — beş gerçek cihazda koşmadan üretilemez.
- "bağımsız incelendi" — bağımsız bir inceleyen olmadan üretilemez.
- "donanım destekli cihaz kimliği" — gerçek bir StrongBox cihazı olmadan üretilemez.

Bunların hiçbiri depoda yazılarak oluşturulamaz. **Pilot, ürünün küçük hâli
değildir; ürünün yapıldığı kanıtı üreten makinedir.** Bu yüzden yol pilottan
geçer ve pilot bittiğinde elde GA'nın malzemesi olur.

Aşağıdaki fazların her biri, bitip bitmediği tartışılamayacak bir çıktıya bağlıdır.

---

## Faz A — Kanıt üretimi

**Amaç:** ürünün gerçekten çalıştığını gösteren ilk somut kanıt.

- Cihaz matrisi ilk koşusu: 5 cihaz, 5 yönlü çift, çift başına 1.000 aktarım.
  Otomatik zincirleme modu hazır; önce tek çiftte 20–30 deneme ile akış doğrulanır,
  `MATRIX_GAP_MS` ve `MATRIX_FRAME_BUDGET` ölçüme göre ayarlanır.
- Alan adı alınır, statik site yayına çıkar, self-signed sertifika sorunu biter.
- `og:image` üretilir.
- Tüzel kimlik bilgileri doldurulur, `policies.html` `legal/` kaynağından üretilir,
  `noindex` kaldırılır.
- Bing Webmaster Tools ve Google Search Console kaydı.

**Bitti sayılma koşulu:** imzalı `kionel-device-matrix.json` dosyası `pnpm qualify`
kapısını geçiyor ve site gerçek alan adında sertifika uyarısı olmadan açılıyor.

---

## Faz B — Bağımsız doğrulama ve ilk gelir

**Amaç:** bize ait olmayan bir gözün onayı ve ilk fatura.

- Dış protokol/kriptografi kaynak incelemesi ve web sızma testi.
- Yüksek ve kritik bulguların kapatılması, bulgu özetinin yayımlanması.
- İlk ücretli pilot: sözleşme, kapsam, açık kapıların yazılı beyanı.
- Pilot çıktısı olarak müşteriye teslim edilen imzalı kanıt paketi.
- Segment sayfaları (aşağıda).

**Bitti sayılma koşulu:** bağımsız inceleme raporu var, kritik/yüksek bulgu
kalmadı, en az bir ödenmiş fatura var.

---

## Faz C — Üretim sertleştirmesi

**Amaç:** kurumsal alıcının teknik kabul listesini geçmek.

- Windows attestation **üreticisi**: AIK oluşturma, `NCryptCreateClaim`, EK
  sertifika zinciri. EK sertifikası taşıyan bir makinede yazılır.
- Android uygulamasının gerçek StrongBox cihazında ilk koşusu ve Google köklü
  kanıtın doğrulanması.
- Apple App Attest için iOS uygulaması.
- İmzalı native paketleme ve kod imza sertifikaları.
- Uzak depo, korumalı ana dal, imzalı commit ve etiket.
- Çevrimdışı kurulum paketi ve geri alma prosedürü.

**Bitti sayılma koşulu:** üç platformda da gerçek cihazdan `verified` attestation
alınıyor ve `ENTERPRISE_KEY_POLICY` geçiyor.

---

## Faz D — İşletilen hizmet ve ticari altyapı

**Amaç:** tekrar eden gelirin altyapısı.

- Enrollment/iptal servisi v1: kalıcı depo, atomik işlem, HSM veya KMS destekli
  kurum imza anahtarı.
- Güven beslemesi: kök ve iptal listesi tazeliğinin operasyonu, tazeleme takvimi.
- Güvenilir zaman damgası entegrasyonu (harici TSA).
- OEM lisans hattı: imzalı lisans dosyası üretimi, Polar üzerinden ödeme, KDV
  merchant of record.
- Denetim ihracı (WORM) ve müşteri işletim dokümanı.

**Bitti sayılma koşulu:** bir müşteri cihaz kaydedip iptal edebiliyor ve bunun
kanıtı çevrimdışı doğrulanabiliyor.

---

## Faz E — GA

**Amaç:** "hazır" demenin dürüst olduğu nokta.

- SLA, destek süreci, olay müdahale prosedürü ve güvenlik bildirim kanalı işler.
- İkinci bölge / felaket kurtarma tatbikatı.
- WCAG 2.2 AA erişilebilirlik testi ve düzeltmeleri.
- Türkçe/İngilizce tam yerelleştirme.
- Sektör kontrol eşlemeleri (ISO 17025, GLP/GMP, Part 11, KVKK/GDPR) — "otomatik
  uyum" iddiası olmadan, kontrol bazında eşleme tablosu olarak.
- En az iki tasarım ortağıyla tamamlanmış pilot ve referans.

**Bitti sayılma koşulu:** açık P0 kapısı kalmadı ve `/phases.html` üzerindeki
her satır kanıta bağlı.

---

## Segment sayfaları

Aramanın kendi kategorimizde değil **alıcının probleminde** yapıldığı tespitinin
sayfa karşılığı. Her biri ayrı URL, ayrı başlık, ayrı örnek; ortak çekirdek.

| Sayfa | Hedef okuyucu | Aradıkları |
|---|---|---|
| Air-gapped labs | Akredite/araştırma laboratuvarı | izole cihazdan sonuç çıkarma, USB yasağı |
| OT & manufacturing | Üretim hattı, SCADA sorumlusu | hat cihazına konfigürasyon aktarma, diode alternatifi |
| Defence supply chain | Savunma tedarikçisi | sınıflandırılmamış ama kontrollü veri devri |
| Healthcare & clinical | Klinik cihaz, hastane BT | cihaz çıktısını ağa bağlamadan taşıma |
| Field & custody | Denetçi, numune alan ekip | şebekesiz ortamda imzalı teslim |

Her sayfada aynı iskelet: TL;DR, o segmentin somut senaryosu, neyi değiştirdiği,
ölçülmüş sayılar, neyi **kanıtlamadığı**, ve tek bir eylem çağrısı.

---

## Sıralama gerekçesi

Fazlar bu sırada çünkü her biri bir sonrakinin girdisini üretir: kanıt olmadan
bağımsız inceleme anlamsız, inceleme olmadan kurumsal satış savunulamaz, satış
olmadan işletilen hizmete yatırım yapmak erken. Sıra bozulursa yapılan iş çöpe
gitmez ama beklemede kalır.
