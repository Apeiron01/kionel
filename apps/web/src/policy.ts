export const POLICY_VERSION = "1.0";
export const POLICY_UPDATED = "2026-09-05";

export const LOCAL_STORAGE_INVENTORY = [
  {
    technology: "IndexedDB",
    key: "kionel-secure-identity",
    purpose: "Çıkarılamayan Ed25519 özel anahtarı, açık anahtar kimliği ve yerel hash-zincirli denetim kaydı",
    lifetime: "Kullanıcı site verisini temizleyene kadar",
    required: true,
  },
  {
    technology: "localStorage",
    key: "qualification.*",
    purpose: "Yalnız ?qualification=1 modunda cihaz etiketleri, deneme sırası ve fiziksel matris sonucu",
    lifetime: "Kullanıcı site verisini temizleyene veya kayıtları sıfırlayana kadar",
    required: false,
  },
  {
    technology: "localStorage",
    key: "kionel.identity.v1",
    purpose: "Eski kimliği yalnız bir kez içe aktarmak ve ardından kaldırmak için geçici uyumluluk anahtarı",
    lifetime: "Başarılı geçişin hemen ardından kaldırılır",
    required: true,
  },
  {
    technology: "Bellek / Blob URL",
    key: "kionel-pilot-brief/v1",
    purpose: "Pilot kapsamı JSON dosyasını cihazda üretmek ve indirmek",
    lifetime: "Sayfa kapanana veya yeni kapsam üretilene kadar",
    required: true,
  },
] as const;
