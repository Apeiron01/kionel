import type { Guide } from "./guides.ts";
export const LAB_GUIDES: readonly Guide[] = [
  {
    slug: "excel-numune-listesi-kontrolu", lang: "tr",
    title: "Excel numune listesinde eksik ve mükerrer kayıt nasıl bulunur?",
    metaTitle: "Excel numune listesi kontrolü: eksik ve mükerrer numune kimlikleri",
    metaDescription: "Beklenen ve gelen numune listesini karşılaştırırken baştaki sıfırları koruyun, tekrarları ayrı inceleyin ve liste farkını fiziksel teslimle karıştırmayın.",
    searchIntent: ["excel iki numune listesi karşılaştırma", "mükerrer numune numarası", "eksik numune teslim tutanağı"],
    answer: "İki numune listesini karşılaştırmadan önce kimlikleri metin olarak koruyun. Her iki listede tekrarları ayrı bulun; ardından beklenip gelmeyen ve beklenmeden gelen kimlikleri ayırın. Yalnız satır sayılarının eşit olması, numunelerin eşleştiğini göstermez.",
    updated: "2026-09-09",
    sections: [
      { heading: "Üç satır eşittir üç numune demek değildir", table: { head: ["Beklenen", "Teslim alınan"], rows: [["LAB-001", "LAB-001"], ["LAB-002", "LAB-003"], ["LAB-003", "LAB-003"]] }, body: ["Bu örnekte iki liste de üç satırdır. LAB-002 eksiktir, LAB-003 teslim listesinde yinelenmiştir. Basit bir adet kontrolü iki sorunu da kaçırır."] },
      { heading: "Kimlikleri düzeltmeden önce farkı görün", list: ["00123 ile 123 aynı kimlik kabul edilmemeli; Excel içe aktarımında sütunu metin olarak seçin.", "Büyük/küçük harf, baş/son boşluk ve benzer Unicode karakterlerini sessizce birleştirmeyin.", "Bir kimliğin tekrar etmesi bölünmüş numune veya alt numune anlamına gelebilir; kurumun adlandırma kuralını kontrol edin.", "Beklenen ve alınan listelerin sürümünü, kaynağını ve kontrol zamanını saklayın."], note: "Bir hata işareti otomatik ret kararı değildir. İşlem, laboratuvarın numune kabul prosedürüne göre sonuçlandırılır." },
      { heading: "Bu iş zaten LIMS'te çözülmüş olabilir", body: ["ALS'nin e-Submit hizmeti numune bildirimini doğrudan LIMS'e aktarır. Mevcut sisteminiz bu adımı yönetiyorsa bağımsız bir liste aracı eklemek gerekmeyebilir. Listeler farklı kurumlar veya çevrimdışı adımlar arasında kaldığında basit bir ön kontrol yararlı olabilir."] },
      { heading: "Listeden teslim kaydına", body: ["Kionel'in karşılaştırma aracı yalnız metin farkını bulur. Dosya özetini imzalamak farklı bir adımdır; imza fiziksel şişenin, poşetin veya numunenin içeriğini doğrulamaz. Teslim sürecinde kurum kimliği, rol, saklama ve istisna yönetimi ayrıca gerekir."] },
    ],
    faq: [{ question: "Bu işlem analiz sonucunu doğrular mı?", answer: "Hayır. Yalnız sağlanan numune kimliklerini karşılaştırır. Analitik doğruluk ve fiziksel numune bütünlüğü kapsam dışıdır." }, { question: "Dosyayı yüklemek gerekir mi?", answer: "Kionel karşılaştırma aracında iki kimlik sütununu tarayıcıya yapıştırabilirsiniz. Liste içeriği sunucuya gönderilmez." }],
    sources: [{ label: "ALS — e-Submit numune bildirimi", href: "https://www.alsglobal.com/-/media/ALSGlobal/Resources-Grid/eSubmission-tech-note.pdf" }],
    related: ["laboratuvar-veri-butunlugu", "ikinci-goz-incelemesi"],
  },
  {
    slug: "laboratuvar-cihazindan-excele-veri", lang: "tr",
    title: "Laboratuvar cihazından Excel veya LIMS'e veri nasıl aktarılır?",
    metaTitle: "Laboratuvar cihazından Excel ve LIMS'e veri aktarımı seçenekleri",
    metaDescription: "Manuel veri girişinden üretici entegrasyonuna ve çevrimdışı dosya teslimine: cihaz çıktısını taşırken hangi yöntemin uygun olduğunu değerlendirin.",
    searchIntent: ["laboratuvar cihazından excel veri aktarımı", "eski cihaz LIMS entegrasyonu", "terazi verisi elle giriş hatası"],
    answer: "Önce cihazın desteklediği dışa aktarım biçimini ve üreticinin entegrasyonunu kontrol edin. Desteklenen bir LIMS bağlantısı varsa doğrudan veri yakalama genellikle en az elle giriş gerektirir. Çıktı yalnız izole bir bilgisayarda dosya olarak bulunuyorsa izinli taşıma yöntemini ve teslim doğrulamasını ayrı değerlendirin.",
    updated: "2026-09-09",
    sections: [
      { heading: "Veri yakalama ile dosya taşıma farklı adımlardır", body: ["Cihazdan değeri okumak, birimi ve numune kimliğini doğru eşlemek veri yakalamadır. Hazır CSV veya PDF'yi başka bilgisayara götürmek dosya taşımadır. Bir aktarım protokolü hatalı veri girişini veya yanlış birimi kendiliğinden düzeltmez."] },
      { heading: "Seçenekleri mevcut cihazınıza göre daraltın", table: { head: ["Durum", "İlk incelenecek yol", "Kontrol"], rows: [["Desteklenen cihaz ve LIMS", "Üretici entegrasyonu", "Model, sürüm, alan/birim eşlemesi"], ["CSV dışa aktarımı var", "Doğrulanan içe aktarım şablonu", "Ayraç, ondalık işareti, kimlik ve tarih"], ["İzole bilgisayarda dosya", "Kurumun izin verdiği ortam veya optik aktarım", "Dosya boyutu, kamera izni, teslim kaydı"], ["Yalnız ekranda değer", "Üreticinin veri arayüzü", "Kionel ekrandaki sayıyı ölçüm sonucuna çevirmez"]] } },
      { heading: "Alternatifler ve Kionel'in sınırı", body: ["METTLER TOLEDO'nun veri yönetimi materyali manuel aktarım hatalarını ve doğrudan veri akışını ele alır. Kionel üretici sürücüsünün yerine geçmez. Aday kullanım, zaten oluşmuş küçük dosyanın çevrimdışı teslimi ve bu teslimin imzalı kaydıdır. Kamera yasaksa optik aktarım uygun değildir."] },
    ],
    faq: [{ question: "Kionel her laboratuvar cihazına bağlanır mı?", answer: "Hayır. Genel cihaz sürücüsü sunulmaz. Mevcut çıktı dosyasını taşıma ve onay adımları değerlendirilebilir." }, { question: "Excel'e aktarılan sayı neden değişir?", answer: "Metin/sayı dönüştürmesi, ondalık ayraç veya tarih yorumu gibi nedenler olabilir. Kaynak çıktıyı koruyup alanları açık bir şemayla doğrulamak gerekir." }],
    sources: [{ label: "METTLER TOLEDO — laboratuvarda veri yönetimi", href: "https://www.mt.com/no/no/home/library/on-demand-webinars/laboratory-weighing/weighing-data-management.html" }],
    related: ["air-gap-dosya-aktarimi", "excel-numune-listesi-kontrolu"],
  },
];
