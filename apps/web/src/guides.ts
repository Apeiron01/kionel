/**
 * Rehber sayfaları — arama yüzeyi ve aynı zamanda hipotez testi.
 *
 * Bu sayfaların işi ürün satmak değil, bir sorunun gerçekten var olup olmadığını
 * araştırmaya yardımcı olmak. Sorgular henüz hacim verisiyle doğrulanmış değil.
 * Arama ilgisi ödeme isteğini kanıtlamaz; trafik yokluğu da indekslenme ve
 * dağıtım kontrol edilmeden ihtiyaç yokluğu olarak yorumlanamaz.
 *
 * Bu yüzden içerik kuralı tek: **kendi ürünümüzü öne çıkarmadan, soruyu gerçekten
 * cevapla.** Alternatifler bizim olmadığımız yerde daha iyiyse bunu yazıyoruz.
 * Sebebi ahlaki olduğu kadar pratik: yalnız kendini öven bir sayfayı ne insan
 * paylaşır ne de bir dil modeli alıntılar. Alıntılanan şey, sınırlarını söyleyen
 * metindir.
 *
 * İkinci kural: her sayfa **ilk paragrafta** soruyu cevaplar. Hem okuyan insan
 * hem de sayfayı özetleyen bir asistan cevabı orada bulmalı; "devamı aşağıda"
 * diyen bir giriş ikisini de kaybeder.
 *
 * Türkçe ile başlıyoruz çünkü ilk görüşmeler Türkiye'de yapılacak. Aynı yapı
 * İngilizce için de kullanılabilir; `lang` alanı bunun için var.
 */

import { LAB_GUIDES } from "./guides-lab.ts";

export interface GuideTable {
  caption?: string;
  head: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface GuideSection {
  heading: string;
  /** Paragraflar. Her biri tek başına anlaşılabilir olmalı — alıntılanan birim budur. */
  body?: readonly string[];
  list?: readonly string[];
  table?: GuideTable;
  /** Bölümün sonunda duran uyarı veya sınır cümlesi. */
  note?: string;
}

export interface GuideFaq {
  question: string;
  answer: string;
}

export interface Guide {
  slug: string;
  lang: "tr" | "en";
  title: string;
  /** Tarayıcı sekmesi ve arama sonucu başlığı. Sayfa H1'inden farklı olabilir. */
  metaTitle: string;
  metaDescription: string;
  /** Sınanacak arama niyeti varsayımları; ölçülmüş sorgu hacimleri değildir. */
  searchIntent: readonly string[];
  /** Sorunun doğrudan cevabı. Sayfanın ilk paragrafı ve öne çıkan cevap adayı. */
  answer: string;
  updated: string;
  sections: readonly GuideSection[];
  faq: readonly GuideFaq[];
  /** Bu sayfanın kaynakları. Kaynaksız bir uyum iddiası, iddia değildir. */
  sources: readonly { label: string; href: string }[];
  related: readonly string[];
}

const DISCLAIMER =
  "Bu sayfa bilgi amaçlıdır ve hukuki ya da mevzuat uyum danışmanlığı yerine geçmez. " +
  "Standart maddeleri yön göstermek için verilmiştir; bir denetimde neyin yeterli sayılacağına " +
  "kurumun kendi sistemi, prosedürleri ve denetçisi karar verir.";

export const GUIDES: readonly Guide[] = Object.freeze([
  ...LAB_GUIDES,
  // ---------------------------------------------------------------------------
  {
    slug: "air-gap-dosya-aktarimi",
    lang: "tr",
    title: "Air-gap bilgisayardan dosya nasıl çıkarılır?",
    metaTitle: "Air-gap bilgisayardan dosya çıkarma: 6 yöntem karşılaştırması",
    metaDescription:
      "Ağa bağlı olmayan bir bilgisayardan dosya almanın altı yolu: USB, tarama kiosku, veri diyodu, geçici bağlantı, optik aktarım ve baskı. Hangisi ne zaman işe yarar, ne kadar tutar, neyi kanıtlar.",
    searchIntent: [
      "air gap bilgisayardan veri aktarma",
      "ağa bağlı olmayan bilgisayardan dosya alma",
      "izole cihazdan veri çıkarma yöntemleri",
      "USB olmadan dosya transferi",
    ],
    answer:
      "Ağa bağlı olmayan bir bilgisayardan dosya çıkarmanın pratikte altı yolu var: USB bellek, " +
      "taramalı USB kiosku, tek yönlü ağ geçidi (veri diyodu), geçici ağ bağlantısı, ekran–kamera " +
      "(optik) aktarım ve baskı–tarama. Hiçbiri her durumda doğru değil. Seçim üç soruya bağlı: " +
      "dosya ne kadar büyük, taşınabilir ortam politikanız ne diyor ve aktarımın gerçekleştiğini " +
      "sonradan kanıtlamanız gerekiyor mu?",
    updated: "2026-09-09",
    sections: [
      {
        heading: "Önce doğru soruyu sorun: hız mı, kayıt mı?",
        body: [
          "Bu kararı zorlaştıran şey genelde teknik değil. Çoğu ekip “en hızlı yol hangisi” diye " +
            "sorarak başlar, oysa hızın önemli olduğu durum azdır: haftada birkaç kez taşınan birkaç " +
            "megabaytlık bir sonuç dosyası için 30 saniye ile 3 dakika arasındaki fark kimsenin " +
            "gününü değiştirmez.",
          "Asıl ayrım şudur: aktarımın **gerçekleştiğini sonradan göstermeniz** gerekiyor mu? " +
            "Gerekmiyorsa USB en ucuz ve en hızlı yoldur ve başka bir şey aramanıza gerek yok. " +
            "Gerekiyorsa, seçeneklerin çoğu bu ihtiyacı hiç karşılamaz ve fiyat farkı burada ortaya çıkar.",
        ],
      },
      {
        heading: "Altı yöntem, dürüst karşılaştırma",
        table: {
          caption: "Maliyetler yaklaşık ve 2026 itibarıyla kamuya açık fiyat aralıklarına dayanır; teklif değildir.",
          head: ["Yöntem", "Hız", "Yaklaşık maliyet", "Kanıt bırakır mı?", "En uygun olduğu durum"],
          rows: [
            ["USB bellek", "Çok yüksek", "Bellek bedeli", "Hayır", "Politika izin veriyorsa ve kayıt gerekmiyorsa"],
            ["Taramalı USB kiosku", "Çok yüksek", "Onbinlerce $ + yıllık", "Kısmen (tarama kaydı)", "Dışarıdan gelen ortamı temizlemek"],
            ["Veri diyodu", "Yüksek", "Onbinlerce $ / cihaz", "Hayır (tek yönlülük sağlar)", "Ağ segmentleri arası kalıcı akış"],
            ["Geçici ağ bağlantısı", "Çok yüksek", "Görünürde sıfır", "Ağ günlükleri kadar", "İstisna yönetebiliyorsanız"],
            ["Optik (ekran–kamera)", "Düşük", "Yazılım", "Evet, tasarıma bağlı", "Küçük dosya, ortam istemeyen akış"],
            ["Baskı + tarama", "Çok düşük", "Kâğıt", "Evet (fiziksel)", "Birkaç kilobayt metin"],
          ],
        },
      },
      {
        heading: "USB: yasak olduğu hâlde en yaygın yol",
        body: [
          "USB bellek hızlıdır, ucuzdur ve herkes bilir. Buna karşılık taşınabilir ortam, endüstriyel " +
            "kontrol sistemleri için yazılmış güvenlik standartlarının neredeyse tamamında kısıtlanır. " +
            "Stuxnet'in yayılma yolu olarak belgelenmesinden bu yana bu, teorik bir kaygı olmaktan çıktı.",
          "Sahadaki tablo çoğu kurumda şudur: taşınabilir ortam **politikada yasaktır ve uygulamada " +
            "kullanılır.** Alternatif olmadığı için görmezden gelinir. Bu, bir güvenlik açığı olduğu " +
            "kadar bir denetim riskidir: kurumun kendi yazılı kuralına uymadığı bir noktadır.",
          "USB'nin ikinci sınırı daha az konuşulur: bir bellek çubuğu imza atamaz. Dosyanın kimden " +
            "kime, ne zaman geçtiğine dair hiçbir kayıt bırakmaz. İmza formu tutuyorsanız bile o form " +
            "dosyanın kendisine bağlı değildir.",
        ],
        note: "Taramalı kiosk bu resmin yalnız bir yarısını düzeltir: zararlı yazılımı arar, teslimi kanıtlamaz.",
      },
      {
        heading: "Veri diyodu: doğru kontrol, yanlış yere konursa pahalı",
        body: [
          "Tek yönlü ağ geçidi (data diode), verinin yalnız tek yönde akmasını donanımla garanti eder. " +
            "Kritik altyapıda yerleşik ve doğru bir kontroldür. Sınırı ekonomiktir: cihaz başına " +
            "onbinlerce dolar seviyesindedir, kurulum ve bakım ayrıdır.",
          "Bu yüzden diyot genelde **ağ sınırına** konur, her cihaz iş istasyonuna değil. Laboratuvarda " +
            "diyodun arkasında kalan tek tek cihazlardan veri çıkarma sorunu çözülmemiş olarak durur ve " +
            "orada yine USB'ye dönülür.",
          "Diyot ayrıca teslimin gerçekleştiğini kanıtlamaz; işi verinin yönünü kısıtlamaktır. Kanıt " +
            "ihtiyacınız varsa bu ayrı bir katmandır ve diyotla rekabet etmez, onunla birlikte çalışır.",
        ],
      },
      {
        heading: "Geçici ağ bağlantısı: en pahalı “bedava” seçenek",
        body: [
          "Bir güncelleme için açılan geçici kural, değişiklik kaydında kapanmış görünse de sahada " +
            "çoğu zaman yerinde kalır. Ağ tarafındaki her istisna, sonradan denetlenmesi gereken bir " +
            "borçtur ve bu borcun faizi denetimde ödenir.",
          "Görünür maliyeti sıfır olduğu için en sık seçilen yol budur. Gerçek maliyeti, izolasyon " +
            "iddianızın artık doğru olmamasıdır.",
        ],
      },
      {
        heading: "Optik aktarım: ortam yok, ama yavaş",
        body: [
          "Ekranda değişen kodların karşı cihazın kamerasıyla okunması, aradan taşınabilir ortamı " +
            "tamamen kaldırır: takılıp çıkarılan, sonradan yazılabilen bir cihaz yoktur. Radyo da " +
            "kullanılmaz, bu yüzden emisyon kısıtı olan alanlarda ek bir sorun çıkarmaz.",
          "Bedeli açıktır ve gizlemiyoruz: yavaştır. Bant genişliği ekranın kare hızı ve kod başına " +
            "taşınan bayt ile sınırlıdır. Birkaç megabaytın üstündeki dosyalar için pratik değildir ve " +
            "bunu ürünün tanımı olarak yazıyoruz, eksikliği olarak değil.",
          "İkinci sınırı: alıcı tarafta bir kamera gerekir. Kameralı cihazın hiç sokulmadığı tesislerde " +
            "bu yöntem uygulanamaz. Böyle bir yerde kanıt ihtiyacınız varsa, dosyayı mevcut yolla " +
            "taşıyıp yalnız kanıt katmanını eklemek daha gerçekçidir.",
        ],
      },
      {
        heading: "Baskı ve tarama: küçümsemeyin",
        body: [
          "Birkaç kilobaytlık metin için basılı bir kare kod, tarayıcıyla okunduğunda tamamen " +
            "denetlenebilir ve hiçbir yazılım gerektirmeyen bir aktarımdır. Kâğıt fiziksel olarak " +
            "arşivlenir ve zaten var olan bir kayıt sistemine girer.",
          "Sınırı serttir: tek bir kare kod en fazla 2953 bayt taşır. Bir sonuç satırı için yeterlidir, " +
            "bir veri dosyası için değildir. Ama ihtiyacınız gerçekten o kadarsa, daha karmaşık hiçbir " +
            "çözüme ihtiyacınız yok.",
        ],
      },
      {
        heading: "Karar için üç soru",
        list: [
          "**Dosya ne kadar büyük?** Birkaç kilobayt ise baskı; birkaç megabayt ise optik; yüzlerce megabayt ise ortam ya da diyot.",
          "**Taşınabilir ortam politikanız ne diyor?** Yazılı olarak yasaksa ve uygulamada kullanılıyorsa, çözmeniz gereken sorun teknik değil, o boşluk.",
          "**Aktarımı sonradan kanıtlamanız gerekiyor mu?** Gerekmiyorsa USB yeterlidir. Gerekiyorsa yöntem seçiminden bağımsız olarak bir kanıt katmanına ihtiyacınız var.",
        ],
        note: "Üçüncü soruya “evet” diyorsanız devamı için: laboratuvar veri bütünlüğü rehberi.",
      },
    ],
    faq: [
      {
        question: "Air-gap bir bilgisayara internet olmadan yazılım nasıl kurulur?",
        answer:
          "Aynı altı yöntemin tersi yönü geçerlidir, ancak içeri doğru aktarım daha risklidir: dışarı " +
          "çıkan yanlış dosya sonradan fark edilir, içeri giren yanlış ya da zararlı dosya sessizce " +
          "çalışır. Bu yön için taramalı kiosk veya imzalı paket doğrulaması, dışarı yönden daha " +
          "önemlidir.",
      },
      {
        question: "USB kullanmak gerçekten bu kadar riskli mi?",
        answer:
          "Risk, belleğin kendisinden çok kontrolsüz kullanımından gelir. Taranmış, kuruma ait, " +
          "kayıt altında kullanılan bir bellek ile ceketten çıkan bir bellek aynı şey değildir. " +
          "Sorun genelde politikanın var olması ama uygulanmamasıdır.",
      },
      {
        question: "En hızlı yöntem hangisi?",
        answer:
          "USB, açık farkla. Optik aktarım onunla hızda yarışamaz ve yarışmaya çalışmamalıdır. " +
          "Optik yöntemin sunduğu şey hız değil, aradan taşınabilir ortamın kalkması ve isteğe bağlı " +
          "olarak aktarımın kanıtlanabilmesidir.",
      },
      {
        question: "Bu yöntemler birlikte kullanılabilir mi?",
        answer:
          "Evet ve çoğu kurumda doğru cevap budur. Örneğin dosya diyot veya taranmış ortamla taşınır, " +
          "üstüne ayrı bir kanıt katmanı eklenir. Kanıt katmanı taşıma yönteminden bağımsız olabilir; " +
          "bu, mevcut akışı hiç değiştirmeden kayıt elde etmenin yoludur.",
      },
    ],
    sources: [
      { label: "NIST SP 800-82 Rev. 3 — Operasyonel Teknoloji Güvenliği Rehberi", href: "https://csrc.nist.gov/pubs/sp/800/82/r3/final" },
      { label: "IEC 62443 — Endüstriyel otomasyon ve kontrol sistemleri güvenliği", href: "https://www.iec.ch/blog/understanding-iec-62443" },
      { label: "CISA — Çıkarılabilir medya ve taşınabilir cihaz riskleri", href: "https://www.cisa.gov/resources-tools/resources/cybersecurity-best-practices-industrial-control-systems" },
    ],
    related: ["laboratuvar-veri-butunlugu", "usb-yasak-alternatifler"],
  },

  // ---------------------------------------------------------------------------
  {
    slug: "laboratuvar-veri-butunlugu",
    lang: "tr",
    title: "Laboratuvar veri aktarımında izlenebilirlik: denetim ne ister?",
    metaTitle: "Laboratuvar veri bütünlüğü: ISO 17025 ve Part 11 aktarımda ne ister?",
    metaDescription:
      "ALCOA+, ISO/IEC 17025 madde 7.11 ve 21 CFR Part 11 verinin aktarımı sırasında ne bekliyor? Denetçinin sorduğu sorular, sık görülen bulgular ve izole cihazlarda oluşan boşluk.",
    searchIntent: [
      "ISO 17025 veri bütünlüğü bulgusu",
      "laboratuvar veri aktarımı izlenebilirlik",
      "ALCOA+ nedir laboratuvar",
      "21 CFR Part 11 denetim izi gereksinimi",
    ],
    answer:
      "Veri bütünlüğü çerçeveleri veriyi yalnız üretildiği ve saklandığı anda değil, **taşındığı anda " +
      "da** korunmuş saymanızı bekler. ALCOA+ ilkeleri verinin atfedilebilir, okunabilir, eş zamanlı, " +
      "özgün ve doğru olmasını ister; ISO/IEC 17025:2017 madde 7.11 veri ve bilgi yönetiminin kontrol " +
      "altında olmasını, 21 CFR Part 11.10(e) ise güvenli ve bilgisayar tarafından üretilen bir denetim " +
      "izi tutulmasını arar. Uygulamada en sık boşluk, verinin izole bir cihazdan çıkıp kayıt sistemine " +
      "girene kadar geçen adımda oluşur: bu adım çoğu zaman hiçbir sistemde kayıtlı değildir.",
    updated: "2026-09-09",
    sections: [
      {
        heading: "ALCOA+ aktarım için ne söyler?",
        body: [
          "ALCOA+ ilkeleri ilaç ve laboratuvar denetimlerinde veri bütünlüğünün ortak dili hâline geldi. " +
            "Aktarım açısından bakıldığında üç tanesi doğrudan devreye girer.",
        ],
        table: {
          head: ["İlke", "Aktarım sırasında anlamı", "İzole cihazda tipik boşluk"],
          rows: [
            ["Atfedilebilir", "Veriyi kimin taşıdığı belli olmalı", "Elden USB ile taşınır, kayıt yoktur"],
            ["Eş zamanlı", "Kayıt işle aynı anda oluşmalı", "Form sonradan doldurulur"],
            ["Özgün", "Aktarılan, üretilen veriyle aynı olmalı", "Kopyanın bozulmadığı kontrol edilmez"],
            ["Tam", "Aradaki adımlar da kayıtta olmalı", "Cihaz ile LIMS arasındaki adım hiç görünmez"],
          ],
        },
        note: "ALCOA+ bir standart maddesi değil, denetimlerde yaygın kullanılan bir ilkeler bütünüdür.",
      },
      {
        heading: "ISO/IEC 17025:2017 madde 7.11",
        body: [
          "Bu madde, laboratuvarın veri ve bilgi yönetimini kontrol altında tutmasını ister. Kapsamına " +
            "verinin toplanması, işlenmesi, kaydedilmesi, raporlanması, saklanması ve **geri alınması** " +
            "girer; yetkisiz erişime ve değişikliğe karşı korunması beklenir.",
          "Akreditasyon denetiminde bu madde genelde şu soruyla açılır: “Bu sonuç cihazdan rapora kadar " +
            "hangi adımlardan geçti?” Cevabın bir adımı elle yapılan ve kayıt bırakmayan bir kopyalama " +
            "ise, konuşma orada derinleşir.",
        ],
      },
      {
        heading: "21 CFR Part 11.10(e) ve denetim izi",
        body: [
          "Part 11 kapsamındaki elektronik kayıtlar için, kayıtları oluşturan/değiştiren işlemleri " +
            "bağımsız olarak izleyen, güvenli ve bilgisayar tarafından üretilen, zaman damgalı bir " +
            "denetim izi beklenir. Bu iz, kaydın kendisi kadar saklanmalıdır.",
          "Buradaki kritik nokta “bilgisayar tarafından üretilen” ifadesidir. Operatörün sonradan " +
            "doldurduğu bir tablo bu tanımı karşılamaz. İzole bir cihazda veriyi çıkaran adım için " +
            "böyle bir iz üreten bir sistem çoğu zaman yoktur.",
        ],
        note: "Part 11 yalnız kapsamdaki kayıtlar için geçerlidir; her laboratuvar bu kapsamda değildir.",
      },
      {
        heading: "Denetçinin gerçekten sorduğu sorular",
        list: [
          "Bu sonuç dosyası cihazdan nasıl çıktı ve bunu gösteren kayıt hangisi?",
          "Aktaran kişi kim ve bunu kayıttan nasıl doğruluyorsunuz?",
          "Aktarılan dosyanın cihazdaki dosyayla aynı olduğunu nasıl biliyorsunuz?",
          "Bu adımın ikinci bir kişi tarafından incelendiğine dair kanıt nerede?",
          "Aynı aktarım altı ay sonra tekrar doğrulanabilir mi?",
        ],
        note: "Bu sorulara kâğıt formla cevap verilebilir. Zorluk, formun dosyaya bağlı olmamasıdır.",
      },
      {
        heading: "Boşluk tam olarak nerede?",
        body: [
          "LIMS veya ELN kullanan bir laboratuvarda, sistem **içindeki** veri için denetim izi genelde " +
            "vardır ve iyi çalışır. Cihaz doğrudan LIMS'e bağlıysa arada bir boşluk da yoktur.",
          "Boşluk, cihazın bağlı olmadığı yerde açılır: ağa alınamayan eski bir cihaz, entegrasyonu " +
            "yapılmamış bir model, ya da bilinçli olarak izole tutulan bir iş istasyonu. Burada veri " +
            "cihazdan çıkar, bir yerlerden geçer ve LIMS'e girer; **aradaki yol hiçbir sistemde " +
            "kayıtlı değildir.**",
          "Bu boşluk her laboratuvarda yoktur ve olduğu yerde de mutlaka bulgu üretmez. Ama denetimde " +
            "sorulduğunda cevabı “elden taşıyoruz ve bir form dolduruyoruz” olan tek adım genellikle " +
            "budur.",
        ],
      },
      {
        heading: "Kapatmanın yolları",
        table: {
          head: ["Yaklaşım", "Ne çözer", "Maliyeti"],
          rows: [
            ["Cihazı LIMS'e entegre etmek", "Boşluğu tamamen kapatır", "Yüksek; eski cihazlarda çoğu zaman mümkün değil"],
            ["Prosedür ve kâğıt form", "Denetime bir cevap verir", "Düşük; kayıt dosyaya bağlı değil"],
            ["Cihaz yazılımının kendi kaydı", "Cihaz içi işlemleri kapsar", "Cihaza bağlı; aktarımı kapsamaz"],
            ["Dosyaya bağlı imzalı aktarım kaydı", "Aktarım adımını kayda alır", "Anahtar yönetimi ve eğitim gerektirir"],
          ],
        },
        note: "Doğru cevap kurumun mevcut sistemine bağlıdır. Entegrasyon mümkünse genelde en iyi seçenektir.",
      },
    ],
    faq: [
      {
        question: "ISO 17025 dosya aktarımı için belirli bir yöntem zorunlu tutuyor mu?",
        answer:
          "Hayır. Standart sonucu tarif eder, aracı değil: verinin kontrol altında olmasını ve yetkisiz " +
          "değişikliğe karşı korunmasını ister. Hangi yöntemle sağladığınız laboratuvarın kendi " +
          "kararıdır ve denetimde savunulabilir olması yeterlidir.",
      },
      {
        question: "Kâğıt form denetim için yeterli mi?",
        answer:
          "Çoğu durumda kabul edilir ve yaygın olarak kullanılır. Zayıf yanı, formun taşınan dosyaya " +
          "bağlı olmamasıdır: form doğru doldurulmuş olsa bile dosyanın değişmediğini göstermez. " +
          "Bir bulgu geldiğinde tartışma genelde tam bu noktada açılır.",
      },
      {
        question: "Elektronik imza ile aktarım kaydı aynı şey mi?",
        answer:
          "Hayır. Elektronik imza bir kişinin bir kayda onayını ifade eder ve Part 11 kapsamında ayrı " +
          "gereklilikleri vardır. Aktarım kaydı ise dosyanın bir noktadan diğerine geçtiğini gösterir. " +
          "İkisi birbirinin yerine geçmez; birlikte kullanılabilir.",
      },
      {
        question: "Bu boşluk her laboratuvarda var mı?",
        answer:
          "Hayır. Cihazları LIMS'e bağlı, entegrasyonu tamamlanmış bir laboratuvarda bu adım zaten " +
          "kayıtlıdır. Boşluk, entegrasyonun yapılamadığı veya bilinçli olarak izole tutulan cihazlarda " +
          "görülür. Kendi laboratuvarınızda var mı, en hızlı testi yukarıdaki beş soruyu sormaktır.",
      },
    ],
    sources: [
      { label: "MHRA — GxP Veri Bütünlüğü Rehberi", href: "https://www.gov.uk/government/publications/guidance-on-gxp-data-integrity" },
      { label: "PIC/S PI 041 — Düzenlenen ortamlarda veri yönetimi ve bütünlüğü", href: "https://picscheme.org/en/publications" },
      { label: "FDA — 21 CFR Part 11 elektronik kayıtlar ve imzalar", href: "https://www.ecfr.gov/current/title-21/chapter-I/subchapter-A/part-11" },
      { label: "ISO/IEC 17025:2017 — Deney ve kalibrasyon laboratuvarları", href: "https://www.iso.org/standard/66912.html" },
    ],
    related: ["ikinci-goz-incelemesi", "air-gap-dosya-aktarimi"],
  },

  // ---------------------------------------------------------------------------
  {
    slug: "ikinci-goz-incelemesi",
    lang: "tr",
    title: "İzole cihazda ikinci göz incelemesi nasıl kayda geçer?",
    metaTitle: "İkinci göz incelemesi: izole cihazda kayıt nasıl tutulur?",
    metaDescription:
      "GxP kritik veride ikinci kişi incelemesi bekler. LIMS'e bağlı olmayan bir cihazda bu inceleme çoğu zaman omuz üstünden yapılır ve hiçbir yere yazılmaz. Kayda geçirmenin dört yolu.",
    searchIntent: [
      "ikinci göz incelemesi laboratuvar",
      "second person review nedir",
      "dört göz prensibi veri incelemesi",
      "izole cihazda inceleme kaydı",
    ],
    answer:
      "İkinci göz incelemesi, kritik bir veriyi üretenden başka birinin kontrol etmesidir ve düzenlenen " +
      "laboratuvar ortamlarında yaygın olarak beklenir. LIMS'e bağlı bir cihazda bu inceleme sistemde " +
      "kayda geçer. İzole bir cihazda ise kaydı tutacak sistem yoktur: inceleme pratikte ekran başında " +
      "yapılır ve ya hiç yazılmaz ya da sonradan bir forma işlenir. Kayda geçirmenin dört yolu var; " +
      "hangisinin uygun olduğu incelemenin nerede yapıldığına bağlı.",
    updated: "2026-09-09",
    sections: [
      {
        heading: "İnceleme neden ayrı bir sorun?",
        body: [
          "Bir sonucun doğru olduğunu göstermek ile o sonucun **incelendiğini** göstermek farklı " +
            "şeylerdir. Birincisi verinin kendisiyle ilgilidir; ikincisi bir insan davranışının kaydıdır " +
            "ve o kayıt tutulmazsa geriye dönük olarak üretilemez.",
          "Denetimde sorulan soru genelde “inceleme yapıldı mı?” değil, “**yapıldığını nereden " +
            "biliyoruz?**” olur. Aradaki fark, sistemin ne kadar hazırlıklı olduğunu belirler.",
        ],
      },
      {
        heading: "Sıra da önemlidir",
        body: [
          "İncelemenin yapılmış olması tek başına yetmez: incelemenin **serbest bırakmadan önce** " +
            "yapıldığını göstermek gerekir. Sonradan atılan bir inceleme imzası, kaydı tamamlar ama " +
            "kontrolü sağlamaz.",
          "Kâğıt formların en zayıf yanı budur. Form üzerinde iki imza yan yana durur; hangisinin " +
            "önce atıldığını yalnız tarihler söyler ve tarihler elle yazılır.",
        ],
      },
      {
        heading: "Kayda geçirmenin dört yolu",
        table: {
          head: ["Yöntem", "Sırayı kanıtlar mı?", "Dosyaya bağlı mı?", "Ne zaman uygun"],
          rows: [
            ["Kâğıt form", "Hayır (elle yazılan tarih)", "Hayır", "Düşük riskli iş, yerleşik prosedür"],
            ["LIMS/ELN içinde inceleme", "Evet", "Evet", "Cihaz sisteme bağlıysa — en iyi seçenek"],
            ["Cihaz yazılımının kendi onayı", "Cihaza bağlı", "Evet", "Cihaz bu özelliği sunuyorsa"],
            ["Dosyayla giden imzalı onay zinciri", "Evet", "Evet", "Cihaz izole ve sisteme bağlanamıyorsa"],
          ],
        },
        note: "Cihazınız LIMS'e bağlanabiliyorsa ikinci satır neredeyse her zaman doğru cevaptır.",
      },
      {
        heading: "Dosyayla giden onay zinciri nasıl çalışır?",
        body: [
          "Fikir basittir: onay, dosya **hakkında** tutulan ayrı bir kayıt olmak yerine dosyanın " +
            "**yanında taşınan** imzalı bir zincir olur. Üreten imzalar, inceleyen imzalar, serbest " +
            "bırakan imzalar; her imza bir öncekine bağlanır.",
          "Bağlı olması sıranın kanıtını verir: bir halkayı çıkarmak ya da yer değiştirmek, kalan " +
            "imzalar tek tek geçerli olsa bile zinciri düşürür. Böylece “inceleme serbest bırakmadan " +
            "önceydi” cümlesi bir iddia olmaktan çıkıp kontrol edilebilir hâle gelir.",
          "Sınırı da açıkça söylemek gerekir: bir imza, imzalayanın o role **yetkili olduğunu** " +
            "kanıtlamaz. Herhangi bir anahtar kendi kaydına “inceleyen” yazabilir. Yetki, kurumun " +
            "önceden belirlediği anahtar listesiyle ayrıca doğrulanmalıdır.",
        ],
      },
      {
        heading: "Kendi durumunuzu test etmek için üç soru",
        list: [
          "İzole bir cihazdaki kritik bir sonucun incelendiğini bugün hangi kayıttan gösteriyorsunuz?",
          "O kayıt, incelenen dosyanın ta kendisine bağlı mı, yoksa ayrı bir formda mı duruyor?",
          "İncelemenin serbest bırakmadan önce yapıldığını nasıl gösteriyorsunuz?",
        ],
      },
    ],
    faq: [
      {
        question: "İkinci göz incelemesi her veri için zorunlu mu?",
        answer:
          "Hayır. Beklenti genelde kritik veri ve kritik adımlar için geçerlidir; neyin kritik olduğunu " +
          "kurumun kendi risk değerlendirmesi belirler. Her sonucu iki kişiye inceletmek çoğu " +
          "laboratuvarda ne beklenir ne de uygulanabilir.",
      },
      {
        question: "Elektronik imza ile bu onay zinciri aynı şey mi?",
        answer:
          "Aynı değildir. Part 11 kapsamındaki elektronik imzanın kimlik doğrulama, anlam beyanı ve " +
          "kayda bağlanma gibi ayrı gereklilikleri vardır. Onay zinciri teknik bir kayıttır; kurumun " +
          "elektronik imza gereksinimini tek başına karşıladığı varsayılmamalıdır.",
      },
      {
        question: "Cihazımız LIMS'e bağlı. Buna ihtiyacım var mı?",
        answer:
          "Büyük olasılıkla hayır. LIMS içinde inceleme kaydı tutuluyorsa boşluk zaten kapalıdır. " +
          "Bu sayfa, cihazın sisteme bağlanamadığı veya entegrasyonun yapılmadığı durumlar içindir.",
      },
    ],
    sources: [
      { label: "MHRA — GxP Veri Bütünlüğü Rehberi", href: "https://www.gov.uk/government/publications/guidance-on-gxp-data-integrity" },
      { label: "WHO — Veri ve kayıt yönetimi uygulamaları rehberi", href: "https://www.who.int/publications/m/item/trs996-annex5" },
    ],
    related: ["laboratuvar-veri-butunlugu", "air-gap-dosya-aktarimi"],
  },

  // ---------------------------------------------------------------------------
  {
    slug: "usb-yasak-alternatifler",
    lang: "tr",
    title: "USB yasak ama dosya taşımak gerekiyor: ne yapmalı?",
    metaTitle: "USB yasak, dosya taşımak gerekiyor: uygulanabilir alternatifler",
    metaDescription:
      "Taşınabilir ortam politikada yasak ama sahada kullanılıyorsa çözülmesi gereken sorun teknik değil. Yasağı uygulanabilir kılan beş yol ve her birinin gerçek maliyeti.",
    searchIntent: [
      "USB yasak dosya nasıl taşınır",
      "taşınabilir ortam politikası alternatif",
      "flash bellek yasağı veri aktarımı",
      "kurumsal USB yasağı çözüm",
    ],
    answer:
      "Taşınabilir ortam yasağının sahada delinmesinin sebebi genelde disiplinsizlik değil, uygulanabilir " +
      "bir alternatifin olmamasıdır. İşi yapılmak zorunda olan bir adımı yasaklarsanız yasak değil, " +
      "kayıt kaybolur. Uygulanabilir kılmanın beş yolu var: yönetilen ve taranan ortam, tek yönlü ağ " +
      "geçidi, kontrollü ağ segmenti, ortam gerektirmeyen aktarım ve istisnanın kayıtlı hâle getirilmesi. " +
      "Hangisinin doğru olduğu dosya boyutuna, sıklığa ve denetim beklentinize bağlı.",
    updated: "2026-09-09",
    sections: [
      {
        heading: "Önce kabul edilmesi gereken şey",
        body: [
          "Bir politika yazılıp uygulanmıyorsa, kurumun elinde iki sorun vardır: ilk baştaki güvenlik " +
            "riski ve artık ona eklenen uyumsuzluk. İkincisi denetimde daha pahalıya gelir, çünkü " +
            "kurumun kendi kuralına uymadığını gösterir.",
          "Bu yüzden ilk adım teknik değil: yasağın hangi işlerde delindiğini ve o işin neden yapılmak " +
            "zorunda olduğunu yazmak. Alternatif seçimi ancak bundan sonra anlamlı olur.",
        ],
      },
      {
        heading: "Beş yol ve gerçek maliyetleri",
        table: {
          head: ["Yol", "Ne çözer", "Ne çözmez", "Gerçek maliyet"],
          rows: [
            ["Yönetilen + taranan ortam", "Zararlı yazılım riski, kayıt", "Ortam hâlâ yazılabilir", "Kiosk ve süreç yatırımı"],
            ["Tek yönlü ağ geçidi", "Yön kontrolü, ortamı kaldırır", "Cihaz başına ekonomik değil", "Cihaz başına yüksek"],
            ["Kontrollü ağ segmenti", "Akışı sürekli kılar", "İzolasyon iddiasını zayıflatır", "Ağ tasarımı ve sürekli denetim"],
            ["Ortam gerektirmeyen aktarım", "Taşınabilir ortamı kaldırır", "Yavaştır, kamera gerektirir", "Yazılım ve eğitim"],
            ["İstisnayı kayda almak", "Uyumsuzluğu görünür kılar", "Riski azaltmaz", "Prosedür ve disiplin"],
          ],
        },
        note: "Son satır çözüm gibi görünmese de en sık atlanan adımdır: yönetilen bir istisna, gizli bir ihlalden iyidir.",
      },
      {
        heading: "Standartlar ne diyor?",
        body: [
          "Endüstriyel kontrol sistemleri için IEC 62443 ailesi taşınabilir ortam kullanımını ayrı bir " +
            "kontrol olarak ele alır ve kısıtlanmasını bekler. NIST SP 800-82, operasyonel teknoloji " +
            "ortamlarında çıkarılabilir medyayı bilinen bir bulaşma yolu olarak tarif eder.",
          "Bilgi güvenliği tarafında ISO/IEC 27001:2022 Ek A'daki bilgi aktarımı kontrolü, aktarımın " +
            "kurallara bağlanmasını ister. Hiçbiri belirli bir ürünü zorunlu tutmaz; istenen şey " +
            "kontrolün var olması ve uygulanabilir olmasıdır.",
        ],
        note: "Standart maddeleri yön göstermek içindir; kapsam ve yeterlilik kararı denetçinize aittir.",
      },
      {
        heading: "Karar ağacı",
        list: [
          "**Dosya birkaç kilobayt mı?** Baskı ve tarama çoğu zaman en basit ve en denetlenebilir yoldur.",
          "**Sürekli ve yüksek hacimli akış mı?** Tek yönlü ağ geçidi doğru kontroldür; maliyeti buna göre planlayın.",
          "**Ara sıra, küçük ve hassas dosya mı?** Ortam gerektirmeyen aktarım burada anlamlı olur.",
          "**Dışarıdan gelen ortamı almak zorunda mısınız?** Tarama kiosku bu yön için yerini tutan bir alternatif yok.",
          "**Hiçbiri bugün mümkün değil mi?** O hâlde istisnayı kayda alın; en azından bildiğiniz bir risk olur.",
        ],
      },
    ],
    faq: [
      {
        question: "Şifreli USB bellek yasağı çözer mi?",
        answer:
          "Kısmen. Şifreleme belleğin kaybolması durumunda içeriği korur ama zararlı yazılım taşınmasını " +
          "engellemez ve teslimin gerçekleştiğini kanıtlamaz. Ortam hâlâ yazılabilir bir yüzeydir.",
      },
      {
        question: "Bulut üzerinden paylaşım daha mı iyi?",
        answer:
          "İzolasyonun amacı ağ bağlantısını kaldırmaksa bulut bu amacı doğrudan ortadan kaldırır. " +
          "Ayrıca içeriğin üçüncü bir sisteme uğraması, veri sorumlusu açısından yeni bir alt işleyen " +
          "ve yeni bir aktarım hukuku doğurur.",
      },
      {
        question: "Yasağı kaldırıp kontrollü kullanmak mantıklı mı?",
        answer:
          "Bazı kurumlarda evet ve dürüst bir seçimdir: yönetilen, taranan, kayıt altında bir ortam, " +
          "yönetilmeyen bir yasaktan güvenlidir. Önemli olan kararın yazılı ve gerekçeli olmasıdır.",
      },
    ],
    sources: [
      { label: "IEC 62443 — Endüstriyel otomasyon ve kontrol sistemleri güvenliği", href: "https://www.iec.ch/blog/understanding-iec-62443" },
      { label: "NIST SP 800-82 Rev. 3 — Operasyonel Teknoloji Güvenliği Rehberi", href: "https://csrc.nist.gov/pubs/sp/800/82/r3/final" },
      { label: "ISO/IEC 27001:2022 — Bilgi güvenliği yönetim sistemleri", href: "https://www.iso.org/standard/27001" },
    ],
    related: ["air-gap-dosya-aktarimi", "laboratuvar-veri-butunlugu"],
  },
]);

export const GUIDE_DISCLAIMER = DISCLAIMER;
