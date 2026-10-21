/**
 * Kionel aktarım uygulaması — çevrimdışı önbellek.
 *
 * Ürünün sözü "aktarım sırasında ağ yok" ama sayfa bir kez internetten geliyordu
 * ve bu, izole bir iş istasyonunda geçerli bir itirazdır. Bu servis çalışanı
 * uygulamayı ilk ziyaretten sonra cihazda tutar: sonraki açılışlarda ağ hiç
 * gerekmez.
 *
 * Kapsam dışı bıraktıklarımız bilinçli:
 *  - /api/* asla önbelleğe alınmaz. Sipariş, lisans ve iletişim uçları her zaman
 *    canlı sunucuya gider; eski bir cevabı saklamak yanlış lisans göstermek olur.
 *  - GET olmayan istekler ve başka kaynaklar dokunulmadan geçer.
 */
const CACHE = "kionel-app-v4";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

/*
 * Kural: önbellek YARDIMCIDIR, asla engel değildir. Önbellek açılamazsa,
 * okunamazsa ya da yazılamazsa istek olduğu gibi ağa gider. Önceki sürümde
 * `caches.open` bir kez hata verdiğinde her sayfa açılışı düşüyordu.
 */
const openCache = () => caches.open(CACHE).catch(() => undefined);
const lookup = (cache, request) => cache ? cache.match(request, { ignoreSearch: true }).catch(() => undefined) : undefined;
const store = (cache, request, response) => {
  if (cache && response.ok) return cache.put(request, response.clone()).catch(() => undefined);
};

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Sayfanın kendisi önce ağdan: çevrimiçiyken her zaman güncel sürüm açılır,
  // çevrimdışıyken önbellekteki.
  if (event.request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(event.request);
        event.waitUntil((async () => store(await openCache(), event.request, fresh))());
        return fresh.clone();
      } catch (error) {
        const cache = await openCache();
        const cached = (await lookup(cache, event.request)) ?? (await lookup(cache, "/transfer.html"));
        if (cached) return cached;
        throw error;
      }
    })());
    return;
  }

  // Varlıklar (hash'li adlar) önbellekten, arkada tazelenerek.
  event.respondWith((async () => {
    const cache = await openCache();
    const cached = await lookup(cache, event.request);
    if (cached) {
      event.waitUntil(fetch(event.request).then((fresh) => store(cache, event.request, fresh)).catch(() => undefined));
      return cached;
    }
    const fresh = await fetch(event.request);
    event.waitUntil(Promise.resolve(store(cache, event.request, fresh)));
    return fresh.clone();
  })());
});
