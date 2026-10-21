# Kionel SDK ürün sözleşmesi

`@kionel/sdk`, protokol ayrıntılarını kurum uygulamalarından ayıran desteklenen entegrasyon yüzeyidir. İlk ürün profili çevrimdışı ve kurum içinde çalışır; Kionel sunucusuna, telemetriye veya bulut hesabına ihtiyaç duymaz.

## İlk entegrasyon

```ts
import { answerReceiverOffer, createReceiverOffer, finishReceiverOffer } from "@kionel/sdk";
import { createProtectedIdentity } from "@kionel/crypto";

const receiverIdentity = await createProtectedIdentity();
const senderIdentity = await createProtectedIdentity();
const offer = await createReceiverOffer(receiverIdentity);
const sender = await answerReceiverOffer(senderIdentity, offer.message);
const receiver = await finishReceiverOffer(offer.pending, sender.message);

// İki cihazdaki değerler kullanıcı tarafından karşılaştırıldıktan sonra:
sender.sender.confirmSas(receiver.verification);
receiver.receiver.confirmSas(sender.verification);

const transfer = await sender.sender.prepareTransfer({
  name: "result.csv",
  data,
  context: { profile: "lab", reference: "LIMS-2026-42", classification: "restricted" },
});
for (const frame of transfer.systematicFrames()) receiver.receiver.ingestFrame(frame);
const result = await receiver.receiver.finalize();
// result.receipt çevrimdışı doğrulanabilen çift imzalı teslim kanıtıdır.
```

Gerçek uygulama her `Uint8Array` karesini müzakere edilen `qr-v1` sürücüsüyle ekrana çizer ve kameradan tekrar bayta dönüştürür. SDK, SAS doğrulanmadan aktarımı; sevk imzası ve içerik özeti doğrulanmadan teslim makbuzunu engeller.

## Kionel v2 Enterprise entegrasyonu

v2 P-256 donanım kimliği kullanır. Enterprise yardımcı yapılandırması hem yerel
anahtar politikasını hem de karşı cihazın kurum enrollment kaydını zorunlu kılar:

```ts
import {
  answerReceiverOfferV2,
  createReceiverOfferV2,
  enterpriseSdkV2Options,
  finishReceiverOfferV2,
} from "@kionel/sdk";

const options = enterpriseSdkV2Options(async (peer) => {
  const enrollment = await localEnrollmentDirectory.find(peer.kid);
  return enrollment?.active
    ? { trusted: true, reason: "active enrollment" }
    : { trusted: false, reason: "unknown or revoked device" };
});

const offer = await createReceiverOfferV2(receiverHardwareIdentity, options);
const sender = await answerReceiverOfferV2(senderHardwareIdentity, offer.message, options);
const receiver = await finishReceiverOfferV2(offer.pending, sender.message);
```

`receiverHardwareIdentity` ve `senderHardwareIdentity`, `@kionel/platform-keys`
native bridge'inden gelen, doğrulanmış attestation sahibi kimliklerdir. Test amacıyla
yazılım P-256 anahtarı açık bir Personal politikasıyla kullanılabilir; Enterprise
yardımcısı bunu reddeder. Yönetim servisi erişilemez air-gap kurulumunda resolver,
kurumca imzalanmış yerel enrollment ve iptal listesini okur.

## Ticari paketleme

- **Kionel Core SDK:** kurum uygulamasına gömülen yıllık lisans, çevrimdışı çalışma ve sürüm güncellemeleri.
- **Kionel Lab Appliance:** yönetilen cihaz, donanım destekli anahtar, kurulum/kalifikasyon ve destek.
- **Kionel Enterprise:** cihaz kaydı/iptali, kurumsal kimlik bağlama, güvenilir zaman damgası ve WORM denetim dışa aktarımı.

Bulut REST API ana veri kanalına konulmaz; bu, air-gap değer önerisini bozar. İleride sunulabilecek yönetim API'si yalnızca lisans, cihaz envanteri, anahtar iptali ve denetim politikalarını yönetir. Hassas içerik yerel optik kanalda kalır.

## Uyumluluk ilkesi

- `0.x`: pilot API; küçük sürümlerde değişebilir.
- `1.x`: aynı ana sürüm içinde kaynak uyumluluğu korunur.
- Tel biçimi sürümü ile npm paket sürümü birbirinden bağımsızdır.
- `color-grid-v1` deneysel sürücüdür ve fiziksel cihaz matrisi geçmeden varsayılan olmaz.
