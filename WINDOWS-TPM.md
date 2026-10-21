# Kionel Windows TPM native bridge

Windows referans hostu Kionel v2 cihaz kimliğini Microsoft Platform Crypto Provider
üzerinde üretir. Sağlayıcı açıkça seçilir; Microsoft Software Key Storage Provider'a
veya dosya tabanlı bir anahtara fallback yapılmaz.

## Uygulanan güvenlik sınırı

- Yalnız P-256 ECDSA ve SHA-256.
- Kalıcı, yalnız imza amaçlı ve `CngExportPolicies.None` anahtar.
- Açık anahtar 65 bayt sıkıştırılmamış SEC1 biçiminde döner.
- İmza 64 bayt IEEE P1363 `r || s` ve Kionel v2 için low-S normalize edilir.
- Özel anahtar, private blob veya export işlemi IPC protokolünde yoktur.
- Host isteği 2 MiB, imzalanan veri 1 MiB ve host çıktısı 4 MiB ile sınırlıdır.
- JSON bilinmeyen alanları reddeder; hata çıktıları stack trace veya anahtar bilgisi taşımaz.
- `remove`, aynı `keyId` ile ikinci doğrulama alanı ve yalnız `windows-tpm:Kionel.*.v2`
  namespace'i kabul eder.
- Provision sonrası doğrulama başarısız olursa yeni oluşturulan container silinir.
- Node adaptörü native EXE veya DLL + `.deps.json` + `.runtimeconfig.json` artifact
  setinin birleşik SHA-256 özetini her işlem öncesi release pinine karşı doğrular ve
  shell kullanmadan çalıştırır.

`requireUserPresence=true`, CNG `ForceHighProtection` politikasıyla her anahtar
erişiminde Windows kullanıcı etkileşimi ister. Kiosk/pilot politikası bunu açıkça
seçmelidir; host kendiliğinden daha zayıf moda düşmez.

## Derleme ve tanı

```powershell
pnpm native:windows:build
pnpm native:windows:test
pnpm native:windows:diagnose
```

`diagnose` yalnız sağlayıcıyı açar; anahtar oluşturmaz. Gerçek fakat geçici anahtar
üretip sign/verify/low-S kontrolü yapmak için:

```powershell
pnpm native:windows:qualify
pnpm native:windows:qualify -- --user-presence
```

Qualification rastgele `Kionel.qualification-*.v2` anahtarı oluşturur ve `finally`
içinde tam `keyId` ile siler. Çıktı attestation/verifier imzası taşımadığı için tek
başına kurumsal enrollment veya fiziksel cihaz matrisi kanıtı değildir.
Qualification aracının çalıştırırken hesapladığı artifact özeti tanı içindir; üretimde
beklenen özet signed release manifestinden gelmelidir, aynı yerel dosyadan öğrenilmez.

## Attestation durumu

Host şu anda doğru biçimde `supportsAttestation: false` ve `not-available` raporlar.
Microsoft Platform Crypto Provider seçilmiş olması uzaktaki enrollment servisine
kriptografik TPM kanıtı vermez.

Zincirin iki ucu var ve **yalnız biri tamamlandı**:

| Parça | Durum |
|---|---|
| Doğrulayıcı (`@kionel/attestation-windows`) | tamamlandı, 24 test |
| Üretici (native host `attest` işlemi) | **yok** |
| EK/AIK trust anchor kaynağı | **yok** |

### Doğrulayıcı — tamamlandı

`WindowsTpmAttestationVerifier` enrollment tarafında çalışır, istemcinin native
host'unda **değil**: attest edilen şey host'un kendisi olduğu için attestation'ın
geçtiğine karar veren taraf o olamaz. Doğrulayıcı her bağı kendisi yeniden türetir:

1. **TPMT_PUBLIC** ayrıştırılır; P-256/ECDSA-SHA256 dışındaki her nesne reddedilir.
2. **TPMA_OBJECT** bitleri zorunlu tutulur: `fixedTPM`, `fixedParent`,
   `sensitiveDataOrigin`, `sign` bulunmalı; `restricted`, `decrypt`,
   `encryptedDuplication`, `stClear` bulunmamalı. "Özel anahtar bu TPM'de doğdu ve
   dışarı çıkamaz" cümlesinin wire karşılığı budur.
3. Sertifikalanan açık anahtar, kaydın iddia ettiği SEC1 anahtarla **birebir** eşleşmeli.
4. **TPMS_ATTEST** `TPM_GENERATED_VALUE` ve `TPM_ST_ATTEST_CERTIFY` taşımalı;
   `extraData` bu enrollment'ın tek kullanımlık challenge'ı olmalı (replay kapısı).
5. `attested.name`, `nameAlg || SHA-256(pubArea)` ile yeniden hesaplanıp karşılaştırılır.
6. AIK sertifika zinciri **kurumun yapılandırdığı** trust anchor'a çıkmalı; istemcinin
   gönderdiği kök kendini doğrulayamaz. Anchor tanımlı değilse her attestation reddedilir.
7. Attestation imzası AIK açık anahtarıyla doğrulanır (ECDSA-P256 veya RSASSA).

Ayrıştırılamayan blob güvenilmeyen blobdur: her hata yolu `rejected` döner, hiçbir
kod yolu şüpheli veriyi "verified" saymaz. Karar `verifierId` ve ISO zaman damgasıyla
birlikte atomik trust store'a yazılır.

### Üretici — açık

Native host henüz `attest` işlemi sunmuyor; yani doğrulayıcının gerçek girdisi yok.
Bunun için gereken:

1. Platform Crypto Provider içinde AIK (`NCRYPT_PCP_IDENTITY_KEY`) üretimi.
2. `NCryptCreateClaim` ile cihaz anahtarının AIK tarafından sertifikalanması.
3. Microsoft claim blob'unun TCG `TPMS_ATTEST` + `TPMT_SIGNATURE` + `TPMT_PUBLIC`
   üçlüsüne ayrıştırılması (doğrulayıcı bu üçlüyü bekliyor).
4. EK sertifikasının okunması ve üretici kök listesine bağlanması.

### Bu makinede neden test edilemiyor

`Get-TpmEndorsementKeyInfo` üretici sertifikası döndürmüyor, `Cert:\LocalMachine\
EndorsementKey` deposu yok ve `Win32_Tpm` sorgusu yetki hatası veriyor. EK sertifikası
olmayan bir makinede uçtan uca gerçek attestation üretilemez ve doğrulanamaz. Üretici
kodu, EK sertifikası taşıyan ve yükseltilmiş yetkiyle çalışılabilen bir makinede
yazılıp doğrulanmalıdır — doğrulanamayan attestation kodu yazmak, bu belgenin
tamamının amacına aykırıdır.

Bu üretici, EK trust anchor'ları ve signed Windows paket/kod imzası tamamlanmadan
Windows native bridge Enterprise-ready **değildir**.
