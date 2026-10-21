/**
 * Segment pages. One page per buyer whose problem is genuinely different — not
 * five rewordings of the same pitch.
 *
 * Every segment carries a `proven` and an `open` list, and the generator refuses
 * a segment that leaves `open` empty. A page that only lists strengths reads as
 * marketing; a page that names its own gaps is the reason a regulated buyer
 * takes the next call. See GO-TO-MARKET.md §3.
 */

export interface SegmentFaq {
  question: string;
  answer: string;
}

export interface Segment {
  /** URL slug — also the generated file name. */
  slug: string;
  /** Browser title and the H1 the page is found by. */
  title: string;
  metaDescription: string;
  eyebrow: string;
  headline: string;
  headlineAccent: string;
  lede: string;
  /** What is actually painful today, in this buyer's own vocabulary. */
  pains: readonly { title: string; body: string }[];
  /** Why the obvious alternative does not close the gap. */
  alternative: { title: string; body: string };
  /** What Kionel puts in their hands. */
  delivers: readonly { title: string; body: string }[];
  /** Control frameworks this buyer answers to. Mapping, never a compliance claim. */
  controls: readonly { framework: string; control: string; contribution: string }[];
  /** Verified in the repository today. */
  proven: readonly string[];
  /** Still open. Required — a segment page without this is not publishable. */
  open: readonly string[];
  product: { name: string; href: string };
  faq: readonly SegmentFaq[];
}

export const SEGMENTS: readonly Segment[] = Object.freeze([
  {
    slug: "air-gap-laboratuvar",
    title: "Air-gap laboratuvar ve kalite",
    metaDescription:
      "İzole LIMS ve cihaz iş istasyonlarından USB kullanmadan veri çıkarın. Sevk ve teslim iki uçta imzalanır, denetime çevrimdışı doğrulanabilir kayıt bırakır.",
    eyebrow: "SEGMENT / LABORATUVAR",
    headline: "Air-gap'i açmadan",
    headlineAccent: "sonucu dışarı alın.",
    lede:
      "İzole bir LIMS'ten çıkan tek bir sonuç dosyası, bugün çoğu laboratuvarda elden ele dolaşan bir USB belleğe biniyor. O bellek ağın kendisi kadar risklidir, üstelik kimin ne zaman ne taşıdığını da göstermez.",
    pains: [
      {
        title: "USB, air-gap'in resmî kapısı hâline geldi",
        body: "Politika ağı kesiyor ama veriyi taşımak yine gerekiyor. Sonuçta yasaklanan bağlantı, denetlenmeyen bir fiziksel ortamla değiştirilmiş oluyor. Kontrol kaybı ağda değil, tam da bu boşlukta.",
      },
      {
        title: "Kim, ne zaman, hangi dosyayı taşıdı?",
        body: "Bir bulguya itiraz geldiğinde laboratuvarın elinde genelde bir imza formu ve bir tarih vardır. Dosyanın o gün gerçekten o cihazdan çıktığını gösteren bir kayıt yoktur.",
      },
      {
        title: "Kalifikasyon yükü her cihazda tekrarlanır",
        body: "Yeni bir iş istasyonu devreye alındığında aktarım yolunun yeniden doğrulanması gerekir. Elle yapılan bir doğrulamanın çıktısı, bir sonraki denetimde tekrar üretilebilir değildir.",
      },
    ],
    alternative: {
      title: "Neden veri diyodu her yere konmuyor",
      body: "Tek yönlü ağ geçidi (data diode) doğru bir kontroldür ve pahalıdır: donanım başına on binlerce dolar, kurulum ve bakım ayrı. Bir laboratuvarın her cihaz iş istasyonuna bunu koyması ekonomik değildir. Kionel diyodun yerine geçmez; diyodun konmadığı yerdeki USB'nin yerine geçer.",
    },
    delivers: [
      {
        title: "İş emri bağlamı imzanın içinde",
        body: "LIMS iş emri, sınıflandırma ve hedef sistem, dosya özetiyle birlikte tek bir kanonik yapıda imzalanır. Tek bir alanı değişse imza düşer.",
      },
      {
        title: "Çift imzalı sevk ve teslim",
        body: "Gönderen sevk kaydını, alıcı teslim kaydını imzalar. İki kayıt birbirine bağlıdır; sonradan tek taraflı üretilemez.",
      },
      {
        title: "Çevrimdışı doğrulayıcı",
        body: "Denetçi makbuzu bize hiç bağlanmadan doğrular. Doğrulama bir hizmet değil, bir komut satırı aracıdır — biz kapansak da çalışır.",
      },
      {
        title: "Tekrarlanabilir cihaz kalifikasyonu",
        body: "Aktarım yolu ölçülür ve imzalı bir qualification raporu üretir. Aynı koşu, aynı çıktıyı verir; denetimde tekrar üretilebilir.",
      },
    ],
    controls: [
      {
        framework: "ISO/IEC 17025",
        control: "7.11 — Verinin kontrolü ve bilgi yönetimi",
        contribution: "Aktarım bütünlüğü, yetkisiz değişikliğin tespiti ve aktarım kaydı için kanıt üretir.",
      },
      {
        framework: "21 CFR Part 11",
        control: "11.10(e) — Denetim izi",
        contribution: "Hash-zincirli, iki taraflı imzalı ve çevrimdışı doğrulanabilir aktarım kaydı sağlar. Elektronik imza gereklerinin tamamını tek başına karşılamaz.",
      },
      {
        framework: "GLP / GMP",
        control: "Veri bütünlüğü (ALCOA+)",
        contribution: "Atfedilebilir ve özgün aktarım kanıtı üretir; eş zamanlılık cihaz saatine bağlıdır ve güvenilir zaman damgası ayrıca gerekir.",
      },
    ],
    proven: [
      "Optik kanal, şifreleme ve çift imzalı makbuz depoda çalışıyor ve test ediliyor",
      "Çevrimdışı doğrulayıcı CLI kullanılabilir durumda",
      "Cihaz kalifikasyon toplayıcısı ve sessiz bozulma tespiti hazır",
    ],
    open: [
      "Fiziksel cihaz matrisi henüz koşulmadı — beş cihaz, çift başına 1.000 aktarım hedefi duruyor",
      "Bağımsız güvenlik incelemesi yapılmadı",
      "RFC 3161 zaman damgası eklenebiliyor ve çevrimdışı doğrulanıyor; hangi TSA ile çalışılacağı ve kök sabitleme politikası henüz kararlaştırılmadı. Damgasız makbuzda saat cihazın kendi saatidir",
      "WORM arşiv ihracı ve LIMS adaptörleri henüz yazılmadı",
    ],
    product: { name: "Kionel Lab Bridge", href: "/products.html#lab-bridge" },
    faq: [
      {
        question: "Ne kadar büyük dosya taşınabilir?",
        answer:
          "Optik kanalın bant genişliği düşüktür. Hedef, sonuç dosyaları, metotlar ve küçük operasyon çıktılarıdır — görüntü arşivi veya ham enstrüman verisi değil. Web referans uygulamasında sınır 64 MiB'dir ve bu sınır ürünün tanımının parçasıdır, bir eksiklik değil.",
      },
      {
        question: "Cihazın kamerası yoksa ne olur?",
        answer:
          "Alıcı tarafta bir sensör zorunludur ama telefon zorunlu değildir: dizüstünün kendi kamerası, ucuz bir USB kamera ya da doküman kamerası da olur. Uygulama kullanılabilir kameraları listeler ve seçiminizi hatırlar. Hiçbir kameranın olamayacağı ortamlarda ise Kionel Proof kullanılır — dosya USB ile gider, kanıt yine üretilir.",
      },
      {
        question: "Bu ISO 17025 uyumu sağlar mı?",
        answer:
          "Hayır. Kontrol eşlemesi sunarız, uyum sağlamayız. Uyum laboratuvarın kendi sisteminin, prosedürlerinin ve akreditasyon denetiminin sonucudur. Kionel o denetimde gösterilebilecek bir kanıt üretir, sertifika üretmez.",
      },
    ],
  },
  {
    slug: "ot-uretim",
    title: "OT ve üretim hattı",
    metaDescription:
      "PLC, HMI ve hat cihazlarına reçete, metot ve yapılandırma dosyasını OT ağını açmadan ve USB kullanmadan taşıyın. Her aktarım iki uçta imzalanır.",
    eyebrow: "SEGMENT / OT VE ÜRETİM",
    headline: "Hattı durdurmadan,",
    headlineAccent: "ağı açmadan.",
    lede:
      "Bir reçete güncellemesi için OT ağına geçici bir delik açmak, o deliğin kapandığını kimsenin doğrulayamadığı bir işlemdir. USB ise Stuxnet'ten bu yana OT'nin en iyi belgelenmiş giriş yoludur.",
    pains: [
      {
        title: "Geçici bağlantı kalıcı olur",
        body: "Bakım için açılan kural, değişiklik kaydında kapanmış görünse de çoğu zaman yerinde kalır. Ağ tarafındaki her istisna, sonradan denetlenmesi gereken bir borçtur.",
      },
      {
        title: "USB, OT'nin bilinen saldırı yüzeyi",
        body: "Taşınabilir ortam yasağı çoğu OT politikasında yazılıdır; buna rağmen dosya bir şekilde taşınır. Yazılı yasak ile sahadaki uygulama arasındaki fark, gerçek risk yüzeyidir.",
      },
      {
        title: "Değişikliği kimin yaptığı kanıtlanamıyor",
        body: "Hat durduğunda ilk soru hangi yapılandırmanın ne zaman yüklendiğidir. Cevap genelde operatörün hatırasına dayanır.",
      },
    ],
    alternative: {
      title: "Yönetilen USB ile optik aktarımın farkı",
      body: "Yönetilen kiosk çözümleri zararlı içerik taraması, politika ve audit özellikleri sunabilir. Kionel optik aktarımda taşınabilir ortam kullanımını kaldırır ve imzalı sevk/teslim kaydı üretir. İçeriği zararlı yazılımdan temizlemez; bir dosyanın yalnızca bir kez uygulanmasını da tek başına garanti etmez. Seçim kurumun iş akışına ve güvenlik politikasına bağlıdır.",
    },
    delivers: [
      {
        title: "Yazılabilir ortam hiç oluşmaz",
        body: "Aktarım ekran ile kamera arasında geçer. Ortada takılıp çıkarılabilen, sonradan yazılabilen bir cihaz yoktur.",
      },
      {
        title: "Radyo yok, düşüş yok",
        body: "Bluetooth, Wi-Fi veya NFC'ye geri düşüş bulunmaz. Optik kanal kurulamazsa aktarım başarısız olur; sessizce başka bir yola sapmaz.",
      },
      {
        title: "Yapılandırma sevki kayıt bırakır",
        body: "Hangi dosyanın, hangi iş emriyle, hangi hedef sisteme gittiği imzanın içindedir. Vardiya değişse de kayıt kalır.",
      },
      {
        title: "Cihaz kimliği donanıma bağlanabilir",
        body: "Kurumsal dağıtımda anahtar TPM, StrongBox veya Secure Enclave içinde üretilir ve oradan çıkamaz. Doğrulayıcı tarafı hazırdır.",
      },
    ],
    controls: [
      {
        framework: "IEC 62443-3-3",
        control: "SR 1.1 / SR 3.1 — Kimlik doğrulama ve iletişim bütünlüğü",
        contribution: "Aktarım uçlarını kriptografik olarak kimliklendirir ve içerik bütünlüğünü doğrular.",
      },
      {
        framework: "IEC 62443-4-2",
        control: "CR 2.3 — Taşınabilir ortam kullanımı",
        contribution: "Taşınabilir ortam ihtiyacını ortadan kaldırarak kontrolün konusunu ortadan kaldırır.",
      },
      {
        framework: "NIST SP 800-82r3",
        control: "OT sistemlerinde çıkarılabilir medya",
        contribution: "Medyasız bir aktarım yolu ve aktarım başına denetlenebilir kayıt sağlar.",
      },
    ],
    proven: [
      "Radyo/ağ düşüşü yok — bu bir yapılandırma değil, mimarinin sonucu",
      "Windows TPM, Android StrongBox ve Apple App Attest doğrulayıcıları yazıldı ve test edildi",
      "Kurumsal enrollment ve iptal snapshot'ı çevrimdışı doğrulanıyor",
    ],
    open: [
      "Donanım kimliğinin **üretici** tarafı açık: Windows AIK/EK zinciri, gerçek StrongBox koşusu ve Apple cihaz uygulaması",
      "Fiziksel cihaz matrisi koşulmadı",
      "IEC 62443 kontrol eşlemesi bağımsız olarak incelenmedi",
      "İmzalı, çevrimdışı kurulum paketi hazır değil",
    ],
    product: { name: "Kionel Lab Bridge", href: "/products.html#lab-bridge" },
    faq: [
      {
        question: "Hattaki HMI'nın kamerası yok, nasıl çalışır?",
        answer:
          "Alıcı uç kamera ister. Pratikte kurumsal bir tablet veya dizüstü alıcı olur ve dosya oradan hedef cihaza yerel olarak aktarılır. Bu, USB'yi tamamen ortadan kaldırmaz ama denetlenmeyen ortamı denetlenen bir cihazla değiştirir.",
      },
      {
        question: "Aktarım ne kadar sürer?",
        answer:
          "Kare hızı ve QR sürümüne bağlıdır. Gerçek rakamları cihaz matrisi koşusu belirleyecek; o koşu yapılmadan bir hız taahhüdü vermiyoruz. Tahmin yayımlamak yerine ölçümü bekliyoruz.",
      },
      {
        question: "Hattı durdurmak gerekir mi?",
        answer:
          "Hayır. Aktarım iki ekran arasında geçer ve hedef cihazın çalışmasını kesmez. Yüklenen yapılandırmanın devreye alınması kurumun kendi değişiklik prosedürüne tabidir.",
      },
    ],
  },
  {
    slug: "savunma-tedarik",
    title: "Savunma tedarik zinciri",
    metaDescription:
      "RF yayınının yasak olduğu alanlarda küçük ve sınıflandırılmış dosyaları taşıyın. Sıfır radyo, sıfır sunucu, iki uçta imzalı teslim kanıtı.",
    eyebrow: "SEGMENT / SAVUNMA TEDARİK",
    headline: "Sıfır radyo,",
    headlineAccent: "kanıtlı teslim.",
    lede:
      "TEMPEST veya emisyon kontrolü uygulanan bir alanda telefonun radyosunu kapatmak yetmez; kapalı olduğunu kanıtlamak gerekir. Kionel radyo üretmez, çünkü üretecek bir katmanı yoktur.",
    pains: [
      {
        title: "Emisyon kontrolü ile pratiklik çatışıyor",
        body: "Alana giren cihazların radyoları kapatılır, sonra dosya taşımak için ya alan terk edilir ya da bir istisna yazılır. İstisnalar birikir.",
      },
      {
        title: "Tedarikçi ile ana yüklenici arasındaki teslim belirsiz",
        body: "Bir teknik veri paketinin kime, ne zaman ulaştığı genelde e-posta yazışmasıyla kanıtlanır. Yazışma teslimi değil, gönderimi gösterir.",
      },
      {
        title: "Bulut, çoğu kapsamda seçenek değil",
        body: "Sınıflandırma veya sözleşme koşulu içeriğin üçüncü bir sistemde bulunmasını yasaklıyorsa, çözümün mimarisinde sunucu olmamalıdır — sunucunun 'kullanılmıyor' olması yetmez.",
      },
    ],
    alternative: {
      title: "Neden şifreli USB tek başına yetmiyor",
      body: "Donanım şifreli bir bellek içeriği korur ama teslimin gerçekleştiğini kanıtlamaz ve ortam hâlâ yazılabilir bir yüzeydir. Kionel'de üretilen şey bir ortam değil, iki tarafın da imzaladığı bir kayıttır; kayıt bize hiç bağlanmadan doğrulanır.",
    },
    delivers: [
      {
        title: "Mimaride radyo katmanı yok",
        body: "Bluetooth, Wi-Fi ve NFC hiçbir koşulda kullanılmaz. 'Sıfır radyo' iddiası ancak istisnasızsa anlamlıdır.",
      },
      {
        title: "İçerik sunucusu yok",
        body: "İçeriği bize taşıyan bir API yoktur ve bu kaynak üzerinden doğrulanabilir. Yıldızını da biz koyalım: kurumsal dağıtımda cihaz kaydı ve iptal için bir servis gerekir. Sunucusuz olan içeriktir, kimlik yönetimi değil.",
      },
      {
        title: "Karşılıklı imzalı teslim kanıtı",
        body: "Sevk ve teslim ayrı ayrı imzalanır. Kayıt iki anahtar arasındaki aktarımı kanıtlar; tarafların hukuki kimliğini değil.",
      },
      {
        title: "Ortadaki adama karşı iki gösterimli SAS",
        body: "Altı hane ve beş çizilmiş sembol, ayrı HKDF etiketleriyle türetilir. Semboller çizimdir; emoji değildir, çünkü emoji iki cihazda farklı görünür.",
      },
    ],
    controls: [
      {
        framework: "NIST SP 800-171",
        control: "3.1.20 — Harici sistem bağlantılarının kontrolü",
        contribution: "Harici bağlantı gerektirmeyen bir aktarım yolu sunar.",
      },
      {
        framework: "NIST SP 800-171",
        control: "3.8.7 — Çıkarılabilir medya kontrolü",
        contribution: "Çıkarılabilir medya ihtiyacını ortadan kaldırır.",
      },
      {
        framework: "ISO/IEC 27001:2022",
        control: "A.5.14 — Bilgi aktarımı",
        contribution: "Aktarım kuralları için teknik zorlama ve aktarım başına kanıt sağlar.",
      },
    ],
    proven: [
      "Sıfır radyo, sıfır sunucu — mimari kısıt, yapılandırma değil",
      "X25519 + AES-256-GCM oturumu, iki gösterimli SAS, ileri gizlilik",
      "Kurumca imzalı, rollback korumalı, zaman-etkili iptal taşıyan çevrimdışı güven snapshot'ı",
    ],
    open: [
      "Kamera kısıtı — birçok yüksek güvenlikli tesis kameralı cihazı içeri almaz. " +
        "Kionel alıcı uçta kamera ister; bu senaryo yalnız kurumca zimmetli ve kamerası " +
        "politika ile yönetilen sabit terminallerde ayakta kalır. Kişisel telefonla çalışmaz.",
      "Ekran emanasyonu (TEMPEST) konusunda hiçbir iddiamız ve ölçümümüz yok",
      "Bağımsız güvenlik incelemesi ve kriptografi kaynak denetimi yapılmadı",
      "Zaman damgası doğrulayıcısı hazır; işletilen bir TSA ve kök politikası olmadan makbuz saati hâlâ cihaz saatidir ve anlaşan iki taraf geçmişe tarih atabilir",
      "Makbuz kimliği değil anahtarı bağlar; anahtarı kişiye bağlamak kurumun kendi PKI'sının işidir",
      "Kod imza sertifikaları ve imzalı dağıtım paketi hazır değil",
    ],
    product: { name: "Kionel Chain Proof", href: "/products.html#chain-proof" },
    faq: [
      {
        question: "Aktarımı üçüncü bir kamera filme alırsa ne olur?",
        answer:
          "Yakaladığı şey şifreli metindir. Oturum anahtarları geçicidir ve açık anahtarları görmek işe yaramaz. Buna karşılık aktarımın gerçekleştiğini, ne kadar sürdüğünü ve kabaca boyutunu görür — gizlediğimiz şey içeriktir, aktarımın varlığı değil.",
      },
      {
        question: "Ekran görüntüsü alan bir kötücül yazılım varsa?",
        answer:
          "O durumda veri zaten düz metin olarak o cihazdadır ve hiçbir şifreleme işe yaramaz. Ele geçirilmiş uç nokta kapsam dışıdır ve bunu gizlemiyoruz; tam liste tehdit modelindedir.",
      },
      {
        question: "Sınıflandırılmış ortamda kullanım için onaylı mı?",
        answer:
          "Hayır. Hiçbir akreditasyon veya onay iddiamız yok. Bağımsız güvenlik incelemesi de henüz yapılmadı. Bir kapsamda kullanılabilirliği, o kapsamın kendi onay makamı belirler.",
      },
    ],
  },
  {
    slug: "saglik-ve-klinik",
    title: "Sağlık ve klinik cihazlar",
    metaDescription:
      "Klinik cihaz çıktısını ve küçük hasta dosyalarını hastane ağına açmadan taşıyın. İçerik buluta gitmez; teslim iki uçta imzalanır.",
    eyebrow: "SEGMENT / SAĞLIK",
    headline: "Hasta verisi",
    headlineAccent: "cihazdan çıkmasın.",
    lede:
      "Bir klinik cihazın çıktısını almanın yolu çoğu zaman ya hastane ağına bağlamak ya da USB kullanmaktır. Birincisi cihazın saldırı yüzeyini büyütür, ikincisi kişisel veriyi denetlenmeyen bir ortama koyar.",
    pains: [
      {
        title: "Eski cihazlar ağa bağlanamaz",
        body: "Desteği bitmiş bir işletim sistemiyle çalışan cihazı ağa almak, kurumun tüm ağını o cihazın güvenlik seviyesine indirir. Ağa almamak ise veriyi hapseder.",
      },
      {
        title: "Kişisel veri bir üçüncü sisteme uğruyor",
        body: "Bulut tabanlı aktarım araçları, veri sorumlusu için yeni bir alt işleyen ve yeni bir aktarım hukuku doğurur. Çoğu klinik senaryoda bu yük çözdüğü sorundan büyüktür.",
      },
      {
        title: "Erişim kaydı dosya düzeyinde yok",
        body: "Sistem günlükleri kimin oturum açtığını gösterir; hangi dosyanın hangi cihazdan hangi cihaza gittiğini göstermez.",
      },
    ],
    alternative: {
      title: "Neden güvenli dosya paylaşımı çözmüyor",
      body: "Şifreli paylaşım servisleri içeriği kendi sistemlerine alır. Şifreleme güçlü olsa da veri sorumlusu artık bir alt işleyen, bir saklama süresi ve gerekirse bir sınır ötesi aktarım mekanizması yönetmek zorundadır. Kionel'de içerik hiçbir sisteme uğramadığı için bu yükün konusu oluşmaz.",
    },
    delivers: [
      {
        title: "İçerik cihazlarda kalır",
        body: "Kodda içeriği bize yükleyen bir API yoktur. Veri sorumlusu açısından bu, aktarım için ek bir alt işleyen doğmaması demektir.",
      },
      {
        title: "Cihazı ağa bağlamadan çıktı",
        body: "Eski veya yalıtılmış cihazın ağ yüzeyi büyümez. Optik kanal cihazın kendi ekranını kullanır.",
      },
      {
        title: "Dosya düzeyinde teslim kaydı",
        body: "Hangi dosyanın hangi bağlamla taşındığı imzalıdır ve çevrimdışı doğrulanır.",
      },
      {
        title: "Yerel denetim defteri",
        body: "Kayıtlar hash-zinciriyle bağlanır; araya kayıt eklenemez, çıkarılamaz.",
      },
    ],
    controls: [
      {
        framework: "KVKK",
        control: "m.12 — Veri güvenliğine ilişkin yükümlülükler",
        contribution: "Aktarım sırasında şifreleme ve bütünlük doğrulaması sağlar; aktarımın kendisi için ek bir alt işleyen doğurmaz.",
      },
      {
        framework: "GDPR",
        control: "Md. 32 — İşlemenin güvenliği",
        contribution: "Uçtan uca şifreleme ve aktarım bütünlüğü için teknik tedbir sunar.",
      },
      {
        framework: "IEC 81001-5-1",
        control: "Sağlık yazılımında güvenlik yaşam döngüsü",
        contribution: "Tehdit modeli, bağımlılık envanteri (SBOM) ve sürüm kanıtı üretir; yaşam döngüsünün tamamını karşılamaz.",
      },
    ],
    proven: [
      "İçerik API'si yok — kaynak üzerinden doğrulanabilir bir mimari kısıt",
      "Yerel depolama envanteri ve ePrivacy 5(3) gerekçelendirmesi yayımlandı",
      "Hash-zincirli yerel denetim defteri çalışıyor",
    ],
    open: [
      "Tıbbi cihaz sınıflandırması ve klinik değerlendirme kapsam dışıdır; Kionel bir tıbbi cihaz değildir",
      "Fiziksel cihaz matrisi koşulmadı",
      "Bağımsız güvenlik incelemesi yapılmadı",
      "Kurumsal saklama, RBAC ve WORM arşiv özellikleri henüz yok",
    ],
    product: { name: "Kionel Lab Bridge", href: "/products.html#lab-bridge" },
    faq: [
      {
        question: "Bu bir tıbbi cihaz mı?",
        answer:
          "Hayır. Kionel tanı, tedavi veya klinik karar için kullanılmaz ve tıbbi cihaz olarak değerlendirilmemiştir. Acil durum, yaşam destek veya tek güvenlik kanalı olarak kullanılmamalıdır.",
      },
      {
        question: "Veri sorumlusu kim olur?",
        answer:
          "Kurum. İçerik bize hiç ulaşmadığı için aktarım bakımından bizi veri işleyen yapan bir akış yoktur. Kurumsal dağıtımlarda destek veya barındırma hizmeti alınırsa, o hizmetler için ayrı bir sözleşme ve rol tanımı gerekir.",
      },
      {
        question: "Hasta verisi ekranda görünmüyor mu?",
        answer:
          "Ekranda görünen şey şifreli karelerdir, dosyanın içeriği değil. Buna karşılık cihazın başındaki kişi dosyaya zaten erişebilir; omuz üstünden bakan biri kapsam dışıdır.",
      },
    ],
  },
  {
    slug: "saha-ve-kanit-zinciri",
    title: "Saha operasyonu ve kanıt zinciri",
    metaDescription:
      "Sahada toplanan kanıtı ve numune dosyasını şebeke olmadan teslim edin. Teslim iki uçta imzalanır, kayıt çevrimdışı doğrulanır.",
    eyebrow: "SEGMENT / SAHA VE KANIT",
    headline: "Şebeke yokken de",
    headlineAccent: "zincir kopmasın.",
    lede:
      "Kanıt zincirinin en kırılgan halkası, sahadan laboratuvara giden yoldur. Şebekenin olmadığı bir noktada teslim, çoğu zaman bir imza formuna ve iki kişinin hafızasına indirgenir.",
    pains: [
      {
        title: "Şebeke yokken senkronizasyon bekler",
        body: "Bulut tabanlı bir araç sahada çevrimdışı kaldığında teslim kaydı gecikir. Gecikmiş kayıt, olayla aynı anda üretilmiş sayılmaz.",
      },
      {
        title: "Teslim formu tek taraflıdır",
        body: "Kâğıt form, teslim edenin beyanıdır. Alıcının o dosyayı gerçekten aldığını bağımsız olarak göstermez.",
      },
      {
        title: "Zincirin bütünlüğü sonradan tartışılır",
        body: "Bir kaydın araya sonradan eklenmediğini göstermek, kayıtların birbirine bağlı olmasını gerektirir. Ayrı ayrı tutulan kayıtlar bunu sağlamaz.",
      },
    ],
    alternative: {
      title: "Neden çevrimdışı mobil uygulama yetmiyor",
      body: "Çevrimdışı bir uygulama kaydı cihazda tutar ve bağlantı gelince yükler. Bu, teslim anında iki tarafın da onayladığı bir kanıt üretmez; üretilen şey tek bir cihazın sonradan anlattığı hikâyedir. Kionel'de kanıt teslim anında, iki cihazda birden doğar.",
    },
    delivers: [
      {
        title: "Teslim anında iki taraflı imza",
        body: "Kanıt sonradan senkronize edilmez; aktarımın kendisi sırasında iki uçta üretilir.",
      },
      {
        title: "Numune ve vaka bağlamı imzanın içinde",
        body: "Numune kimliği, vaka referansı ve teslim noktası dosya özetiyle birlikte imzalanır.",
      },
      {
        title: "Hash-zincirli defter",
        body: "Her kayıt bir öncekine bağlanır. Araya kayıt eklemek zinciri kırar ve bu görünür olur.",
      },
      {
        title: "Şebekeye hiç ihtiyaç yok",
        body: "Aktarım da doğrulama da çevrimdışıdır. Sahada kapsama alanı aramak gerekmez.",
      },
    ],
    controls: [
      {
        framework: "ISO/IEC 27037",
        control: "Dijital kanıtın tanımlanması, toplanması ve korunması",
        contribution: "Aktarım aşaması için iki taraflı, doğrulanabilir bir teslim kaydı üretir.",
      },
      {
        framework: "ISO/IEC 17025",
        control: "7.4 — Deney öğelerinin taşınması",
        contribution: "Numuneye eşlik eden dijital dosyanın taşınmasında bütünlük kanıtı sağlar.",
      },
      {
        framework: "ISO/IEC 27001:2022",
        control: "A.5.28 — Kanıtın toplanması",
        contribution: "Sonradan üretilemeyen, çevrimdışı doğrulanabilir aktarım kanıtı sunar.",
      },
    ],
    proven: [
      "Çift imzalı sevk/teslim ve hash-zincirli defter çalışıyor",
      "Doğrulama tamamen çevrimdışı ve bize bağımlı değil",
      "Uzun aktarımda ara verilip kaldığı yerden devam edilebiliyor (oturum içinde)",
    ],
    open: [
      "Güvenilir zaman damgası işletme sürümünde var (DigiCert, RFC 3161, web sürümü); DigiCert'in herkese açık hizmeti erişilebilirlik taahhüdü vermez ve çevrimdışı pakette zaman damgası yoktur",
      "Makbuz iki *anahtar* arasındaki aktarımı kanıtlar, iki *kişi* arasındaki teslimi değil",
      "WORM/değiştirilemez arşiv ihracı yazılmadı",
      "Fiziksel cihaz matrisi ve bağımsız inceleme bekliyor",
    ],
    product: { name: "Kionel Chain Proof", href: "/products.html#chain-proof" },
    faq: [
      {
        question: "Makbuzdaki saat mahkemede kullanılabilir mi?",
        answer:
          "Cihaz saati tek başına kullanılmamalıdır: saat cihazın kendi saatidir ve anlaşan iki taraf geçmişe tarih atabilir. İşletme sürümünde makbuza DigiCert'ten RFC 3161 zaman damgası eklenebilir; o zaman makbuzun o andan önce var olduğu bağımsız olarak doğrulanır. Mahkemede nasıl değerlendirileceği hukuki bir sorudur.",
      },
      {
        question: "Makbuz kişiyi bağlar mı?",
        answer:
          "Hayır. Makbuz 'bu iki anahtar arasında' der. Anahtarı bir kişiye bağlamak kurumun kendi kimlik altyapısının işidir. Yüz yüze teslimde bunu göz teması sağlar; uzaktan bir senaryoda sağlamaz.",
      },
      {
        question: "İnternet olmadan doğrulama nasıl yapılır?",
        answer:
          "Doğrulayıcı bir komut satırı aracıdır ve yalnızca makbuz dosyasına ihtiyaç duyar. Bizim sunucumuza, hesabımıza veya varlığımıza bağlı değildir.",
      },
    ],
  },
]);
