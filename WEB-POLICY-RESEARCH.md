# Kionel web politikası araştırma kaydı

Tarih: 12 Ağustos 2026. Bu kayıt hukuk görüşü veya uyum sertifikası değildir. Amacı,
`/policies.html` taslağındaki ürün kararlarını resmî kaynaklara ve gerçek kod veri
akışına bağlamak; üretim öncesi hukuk incelemesinde iz bırakmaktır.

## İncelenen gerçek veri akışı

- Referans web uygulamasında `fetch`, XHR, WebSocket, `sendBeacon`, HTTP çerezi,
  üçüncü taraf analitik veya reklam etiketi yoktur.
- Dosya, kamera karesi ve oturum anahtarı yerel aktarım veri düzlemindedir.
- IndexedDB `kionel-secure-identity`, dışa aktarılamayan Ed25519 `CryptoKey` ve yerel
  hash-zincirli audit kaydını tutar.
- `localStorage` yalnız açık `?qualification=1` laboratuvar modunda cihaz etiketi,
  deneme sırası ve matris sonucu için kullanılır. `kionel.identity.v1` eski kimlik
  geçişinden sonra kaldırılır.
- Pilot kapsamlandırıcı iletişim veya içerik verisi istemez; çıktıyı geçici Blob URL
  ile kullanıcıya indirir.
- Hosting erişim günlükleri istemci kodunun dışında kalır. Sağlayıcı, bölge ve saklama
  süresi seçilmediğinden üretim yayını için açık kapıdır.

## Kaynaklardan türetilen kararlar

1. KVKK Aydınlatma Yükümlülüğü Tebliği; veri sorumlusu kimliği, işleme amacı,
   alıcılar, toplama yöntemi/hukuki sebep ve ilgili kişi haklarının açıklanmasını
   gerektirir. Bu bilgiler gerçek işletmeci olmadan uydurulamayacağı için politika
   sayfası `noindex` yayın öncesi taslaktır.
2. KVKK çerez rehberi ve Kurul kararları, zorunlu olmayan depolama için aktif tercihi
   ve kabul/ret seçeneklerinde gerçek seçim özgürlüğünü esas alır. Kionel mevcut
   sürümde izleme eklemez; ileride analitik eklenirse yükleme öncesi opt-in gerekir.
3. GDPR Madde 13, veri sorumlusu/temsilci iletişimi, amaç ve hukuki sebep, meşru
   menfaat, alıcılar, aktarım, saklama ve haklar hakkında katmanlı açıklamayı
   gerektirir. Global yayında ülke/rol ve transfer mekanizması ayrıca belirlenmelidir.
4. WCAG 2.2 ve W3C C39 tekniği nedeniyle hareket sistemi klavye/odak düzenini
   bozmadan progressive enhancement olarak kurulmuş; `prefers-reduced-motion`
   tercihinde animasyonlar kapatılmıştır. Hedef AA'dır, henüz uygunluk beyanı yoktur.
5. CISA'nın VDP yaklaşımı, izlenen iletişim kanalı ve yetkili test kapsamı yayımlamayı
   gerektirir. Kionel'ta gerçek kanal ve güvenli liman yetkisi olmadığı için sahte
   `security.txt` üretilmemiş, eksik açıkça yayın kapısına alınmıştır.

## Birincil kaynaklar

- KVKK Aydınlatma Tebliği: https://www.kvkk.gov.tr/Icerik/4132/aydinlatma-yukumlulugunun-yerine-getirilmesinde-uyulacak-usul-ve-esaslar-hakkinda-teblig
- KVKK Çerez Rehberi: https://www.kvkk.gov.tr/Icerik/7353/Cerez-Uygulamalari-Hakkinda-Rehber
- KVKK 2023/1645: https://www.kvkk.gov.tr/Icerik/7765/2023-1645
- KVKK 2022/229: https://www.kvkk.gov.tr/Icerik/7275/2022-229
- GDPR tam metni: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- W3C reduced motion C39: https://www.w3.org/WAI/WCAG22/Techniques/css/C39
- CISA VDP: https://www.cisa.gov/news-events/news/cisa-issues-final-vulnerability-disclosure-policy-directive-federal-agencies

## Üretim yayını kabulü

Veri sorumlusu/işletmeci kimliği, privacy ve security kanalları, hosting/alt işleyen
envanteri, saklama süreleri, uygulanacak hukuk ve yetkili hukuk onayı olmadan taslak
bağlayıcı metne çevrilmez. Bu bilgiler değiştiğinde kod veri akışı tekrar taranır,
politika sürümü artırılır ve önceki metin arşivlenir.
