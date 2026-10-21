# GitHub depo güvenlik politikası

Uzak depo oluşturulduktan ve ilk CI koşuları göründükten sonra `main` için aktif ruleset uygulanır.

## Zorunlu main kuralları

- Doğrudan push ve force-push kapalı; silme ve branch yeniden adlandırma kapalı.
- Pull request zorunlu; en az 1 bağımsız onay ve eski onayları yeni commit'te düşürme.
- Konuşmalar çözülmeden merge yok; lineer geçmiş zorunlu.
- İmzalı commit zorunlu. Bot/Dependabot imzalarının GitHub tarafından `Verified` görülmesi gerekir.
- Zorunlu kontroller: `verify`, `codeql`, `fuzz-smoke`.
- Branch güncel olmadan merge yok; yönetici bypass yalnız belgelenmiş acil durum prosedürüyle.
- `v*` tag'leri silinemez/değiştirilemez ve yalnız release sorumlusu oluşturabilir.

GitHub, bir kontrolün zorunlu seçilebilmesi için o kontrolün depoda yakın zamanda en az bir kez
çalışmış olmasını ister. Bu nedenle ruleset ilk CI koşusundan sonra etkinleştirilir.

## Sürüm prosedürü

1. `package.json` sürümünü ve `CHANGELOG.md` dosyasını güncelleyin.
2. `pnpm release:check` ve en az bir saatlik fuzz koşusu temiz olmalı.
3. Release commit'i doğrulanmış imzayla merge edin.
4. Aynı sürüm için imzalı annotated tag oluşturun: `git tag -s vX.Y.Z -m "Kionel vX.Y.Z"`.
5. Tag push edildiğinde `Kionel signed release` iş akışı deterministik arşiv, SBOM, qualification,
   checksum ve GitHub OIDC provenance üretir.
6. Yayın indiren müşteri `gh attestation verify <dosya> --repo <sahip/depo>` ve
   `sha256sum -c SHA256SUMS` ile kaynağı doğrular.

İmza anahtarı kaybolursa eski tag'ler yeniden yazılmaz. Yeni anahtar ayrı bir güvenlik duyurusuyla
tanıtılır; etkilenmiş anahtar GitHub hesabından ve kurum envanterinden iptal edilir.
