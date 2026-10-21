# Üçüncü taraf bildirimleri

Bu dosya, Kionel arayüzünde uyarlanan üçüncü taraf çalışmaların telif ve lisans
bildirimlerini taşır. MIT lisansı, izin bildiriminin **yazılımın tüm kopyalarında
veya önemli parçalarında** yer almasını şart koşar; bu dosya o şartı karşılar.

Uyarlanan şey **etkileşim deseni**dir: sert kenar, ofset gölge, basıldığında
çöken kontrol ve hover'da geçen tek ışık süpürmesi. Geometri, palet, tipografi
ve içerik Kionel'e özgündür.

---

## Uiverse.io — brutalist card (0xnihilism / 0xNihilist)

Uyarlandığı yer: aksiyon butonlarının hover/press davranışı ve güvenlik durdurma
panelinin kalın çerçeve + ofset gölge yapısı.

```
Copyright - 2026 0xnihilism (0xNihilist)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Uiverse.io — 3D spinner (Nawsome)

İncelendi ve yerine ürünün kendi diline uygun bir yükleniyor durumu yazıldı
(blok birleştirme ızgarası). Orijinal kod veya gömülü SVG verisi kullanılmadı;
bildirim yine de kaynak gösterme amacıyla korunur.

```
Copyright - 2026 Nawsome

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Uiverse.io — wheel selector (byllzz / Bilal Malik)

İncelendi, **kullanılmadı**. Koyu zemin ve neon vurgu dili kurumsal yönle
çeliştiği için paket seçici bu desenle yapılmayacak. Bildirim, incelenen
kaynağın kaydı olarak burada tutulur.

```
Copyright - 2026 byllzz (Bilal Malik)

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

---

## Yazı tipleri

- **Source Serif 4** — SIL Open Font License 1.1
- **IBM Plex Sans / IBM Plex Mono** — SIL Open Font License 1.1

OFL, gömme ve ticari kullanıma izin verir; yazı tiplerinin tek başına satılmasını
yasaklar. Kionel yazı tipi satmaz.

## Uiverse.io — loader (JkHuger)

Satış yüzeyindeki yükleme göstergesi (`.loader`, `apps/web/src/funnel.css`)
Uiverse.io üzerinde JkHuger tarafından yayımlanan çizime dayanır; renkler,
boyutlar ve işaretleme Kionel paletine uyarlanmıştır.

Copyright (c) 2026 JkHuger — MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

---

## libcimbar v0.6.8 — renkli kod (Stephen Zimmerman ve katkıda bulunanlar)

Kullanıldığı yer: gönderici ve alıcının "renkli kod" taşıması
(`apps/web/public/cimbar/`). Dosyalar kaynağındaki gibi, **değiştirilmeden**
dağıtılır; Kionel'in yazdığı `kionel-sink.js` ve `apps/web/src/colour.ts` bu
dosyaları yalnız çağırır.

- Lisans: **Mozilla Public License 2.0** — tam metin `apps/web/public/cimbar/LICENSE-libcimbar.txt`.
- Kaynak kod: https://github.com/sz3/libcimbar (etiket `v0.6.8`, paket `cimbar.wasm.tar.gz`,
  SHA-256 `0a14b63decd9404e7a319b4b0f5cd873eb6aa325f90df4e965305f523567c4a5`).
- MPL-2.0 dosya düzeyinde bir lisanstır: bu dosyalarda değişiklik yapılırsa değişiklik
  aynı lisansla yayımlanmalıdır. Kionel'in kendi kodu bu koşuldan etkilenmez.

WASM paketi derleme sırasında şu bileşenleri içerir; her biri kendi lisansıyla:
OpenCV (Apache License 2.0), wirehair (BSD-3-Clause), Zstandard (BSD-3-Clause),
GLFW (zlib/libpng). Kaynakları libcimbar deposunda listelenmiştir.
