# Bağımlılık Envanteri

3 Ağustos 2026 itibarıyla doğrudan bağımlılıklar:

| Bileşen | Sürüm | Kullanım | Lisans |
|---|---:|---|---|
| `qrcode` | 1.5.4 | QR byte-mode üretimi | MIT |
| `zxing-wasm` | 2.2.4 | Yerel WASM QR çözümü | MIT |
| Vite | 6.4.3 | Yalnız build/geliştirme | MIT |
| `@vitejs/plugin-basic-ssl` | 1.2.0 | Yalnız yerel geliştirme HTTPS | MIT |
| TypeScript | 5.9.3 | Yalnız build | Apache-2.0 |
| Vitest | 4.1.10 | Yalnız test | MIT |
| Jazzer.js | 4.0.0 | Coverage-guided güvenlik fuzzing | Apache-2.0 |

`@kionel/core` ve `@kionel/crypto` çalışma zamanında üçüncü taraf bağımlılık içermez.
QR WASM dosyası uygulama paketinden yüklenir; CDN veya runtime indirmesi yoktur.

Kontrol komutu:

```bash
pnpm audit --prod
```

Makinece okunabilir transitif CycloneDX 1.6 SBOM şu komutla üretilir:

```bash
pnpm sbom -- --out=artifacts/kionel.cdx.json
```

CI; web derlemesi, SBOM ve kalifikasyon raporunu `kionel-release/v1` SHA-256
manifestine bağlar. Bu belge insan tarafından okunabilir doğrudan bağımlılık özetidir;
dağıtım kanıtı olarak üretilen CycloneDX dosyası kullanılmalıdır.
