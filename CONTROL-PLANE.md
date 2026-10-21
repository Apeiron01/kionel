# Kionel Enterprise Control Plane

Kionel control plane yalnız güven ve işletim metadatasını yönetir. Hassas dosya, kamera
karesi, plaintext/ciphertext aktarım yükü, oturum anahtarı veya özel anahtar için endpoint
sunmaz. Bu sınır hem ortak payload doğrulayıcısında hem de sürümlü API sözleşmesinde
korunur.

## Uygulanan sözleşme dilimi

- Tüm kaynak yolları `/v1/tenants/{tenantId}/...` altında tenant'a bağlıdır.
- Bilinmeyen operasyon ve rol varsayılan olarak reddedilir.
- Her mutasyon doğrulanmış MFA iddiası gerektirir.
- Her mutasyon tenant/aktör/operasyon kapsamında bir `Idempotency-Key` gerektirir.
- Enrollment, iptal ve politika yayınında isteyen kişi kendi talebini onaylayamaz.
- İptal ve politika onayı yalnız `security-admin` rolündedir.
- Mutasyon gövdeleri OpenAPI 3.1.1 içinde kapalı şemadır; bilinmeyen alan kabul edilmez.
- Transfer içeriği çağrışımlı alanlar, iç içe nesnelerde ve ad varyasyonlarında reddedilir.

Makinece okunabilir sözleşme:

```powershell
pnpm api:spec > kionel-control-plane-openapi.json
```

Web ürünündeki `/phases.html` ekranı aynı endpoint ve faz kayıtlarını doğrudan
`@kionel/control-plane` paketinden okur. Arayüz ile sözleşme ayrı elle tutulan listeler
değildir.

## Roller

| Rol | Ana yetki |
| --- | --- |
| `security-admin` | İptal/politika onayı, trust bundle, güvenlik yönetimi |
| `device-admin` | Site ve cihaz enrollment işlemleri |
| `auditor` | Yönetim audit olayları ve mühürlü dışa aktarım |
| `operator` | Operasyonel cihaz/politika görünümü |
| `read-only` | Sınırlı salt-okunur metadata |

Her handler, rol kontrolünden ayrı olarak nesnenin tenant sahipliğini doğrulamalıdır.
Bir tenant kimliğini yalnız URL'den veya istemci gövdesinden almak yetki kanıtı değildir.

## İki kişilik onay

`approveRequest` saf durum geçişi kuralları uygular. Üretim adaptörü talep durumunu
veritabanında atomik compare-and-set ile değiştirmeli; aynı talebin iki kez
onaylanmasını ve yarış koşullarını engellemelidir. Onaylanan iptal/politika daha sonra
HSM otoritesiyle yeni, monoton sıra numaralı trust bundle üretimine bağlanacaktır.

## Henüz üretim servisi olmayan parçalar

Bu faz çalışan ürün sözleşmesi ve arayüzüdür; internete açılabilir control plane değildir.
Aşağıdakiler tamamlanmadan gerçek müşteri yönetim verisi işlenmez:

- Bölgesel, tenant izolasyon testli kalıcı veritabanı ve migration'lar.
- OIDC/SAML doğrulaması, SCIM lifecycle ve sunucu tarafında güncel MFA denetimi.
- HSM/KMS-backed authority signer ve iki kişilik onayın atomik işlem kuyruğu.
- Idempotency kayıt deposu/replay penceresi, rate limit, güvenli audit, WORM ihracı ve gözlemlenebilirlik.
- API gateway/WAF, secret yönetimi, yedekleme, felaket kurtarma ve dış pentest.
- Gerçek müşteri alan adı ve IdP bilgileriyle üretilmiş dağıtım OpenAPI belgesi.

Örnek OpenAPI sunucusu ve OIDC adresleri bilinçli olarak `example` alan adıdır; bir
üretim deployment iddiası değildir.
