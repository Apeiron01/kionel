export type BuyerSegment = "b2b" | "oem";
export type TransferProductProfile = "lab" | "custody";
export type OfferAvailability = "pilot" | "pilot-prep";

export interface ProductOffer {
  id: "lab-bridge" | "chain-proof" | "core-sdk" | "proof";
  profile?: TransferProductProfile;
  segment: BuyerSegment;
  name: string;
  eyebrow: string;
  promise: string;
  buyer: string;
  useCases: readonly string[];
  included: readonly string[];
  deployment: string;
  commercialModel: string;
  availability: OfferAvailability;
  availabilityLabel: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
}

export interface TransferProductUi {
  name: string;
  promise: string;
  contextTitle: string;
  referenceLabel: string;
  referencePlaceholder: string;
  noteLabel: string;
  notePlaceholder: string;
  trust: string;
  workflowHint: string;
  accent: string;
  referenceRequired: boolean;
  defaultClassification: "internal" | "confidential" | "restricted";
}

export const PRODUCT_OFFERS: readonly ProductOffer[] = Object.freeze([
  /**
   * Listenin başında duruyor çünkü giriş noktası bu.
   *
   * Diğer teklifler müşteriden iş akışını değiştirmesini ister; bu istemez.
   * Dosya bugün nasıl gidiyorsa öyle gitmeye devam eder — USB, diyot, kurye —
   * ve üstüne yalnızca kanıt eklenir. Çalışan bir sistemin yerini almaya
   * çalışmıyoruz; çoğu kurumda o "çalışan sistem" zaten kendi politikalarının
   * ihlali ve eksik olan şey taşıma değil, hesap verebilirlik.
   */
  offer({
    id: "proof", segment: "b2b", name: "Kionel Proof",
    eyebrow: "Mevcut aktarımınızın üstüne kanıt",
    promise: "Dosyanız bugün nasıl gidiyorsa öyle gitsin — USB, veri diyodu, kurye. Sevk ve teslim iki tarafça imzalansın, denetimde çevrimdışı doğrulansın.",
    buyer: "Taşınabilir ortam politikası yazılı ama sahada uygulanamayan kalite, güvenlik ve denetim ekipleri",
    useCases: ["USB ile giden dosyaya teslim kanıtı", "Veri diyodunun üstüne teslim kaydı", "Kurye/elden teslimin dijital karşılığı"],
    included: ["İki taraflı imzalı sevk/teslim", "Çevrimdışı doğrulayıcı", "Küçük sevk kaydını QR ile paylaşma", "Yetkili metot onayı için referans akış"],
    deployment: "Komut satırı aracı ve SDK; kamera ve ikinci cihaz gerekmez. Anahtar yönetimi ve kurum iş akışına entegrasyon gerekir",
    commercialModel: "Yıllık kurum lisansı; aktarım başına ücret yok",
    availability: "pilot-prep", availabilityLabel: "Doğrulama ve tasarım ortağı hazırlığında",
    primaryCta: { label: "Nasıl çalışır", href: "#technology" },
    secondaryCta: { label: "Pilotu kapsamlandır", href: "#pilot-scope" },
  }),
  offer({
    id: "lab-bridge", profile: "lab", segment: "b2b", name: "Kionel Lab Bridge",
    eyebrow: "İzole laboratuvar ve üretim",
    promise: "LIMS çıktısını, cihaz metodunu ve küçük operasyon dosyalarını ağ veya USB olmadan taşıyın.",
    buyer: "Laboratuvar, kalite, üretim hattı, enerji ve air-gap iş istasyonu ekipleri",
    useCases: ["LIMS → cihaz iş istasyonu", "Metot ve yapılandırma sevki", "Sonuç ve küçük log dönüşü"],
    included: ["İş emri bağlamı", "Çift imzalı makbuz", "Çevrimdışı doğrulayıcı", "Cihaz kalifikasyon paketi"],
    deployment: "Yönetilen web/native istemci veya Kionel Lab Appliance",
    commercialModel: "Yıllık kurum + kayıtlı cihaz; kurulum, kalifikasyon ve SLA ayrı kapsamlanır",
    availability: "pilot", availabilityLabel: "Ücretli pilot için kapsamlandırılıyor",
    primaryCta: { label: "Lab akışını aç", href: "/index.html?product=lab" },
    secondaryCta: { label: "Pilot kapsamını oluştur", href: "#pilot-scope" },
  }),
  offer({
    id: "chain-proof", profile: "custody", segment: "b2b", name: "Kionel Chain Proof",
    eyebrow: "Numune ve teslim zinciri",
    promise: "Dosyayı numune/vaka kimliği ve teslim noktasıyla birlikte iki taraflı imzalayın.",
    buyer: "Numune laboratuvarları, saha operasyonları, denetim ve kanıt teslim ekipleri",
    useCases: ["Numune teslimi", "Saha kanıtı aktarımı", "Vaka dosyası zinciri"],
    included: ["Numune/vaka bağlamı", "İmzalı sevk ve teslim", "Hash-zincirli audit", "Dışa aktarılabilir kanıt paketi"],
    deployment: "Yönetilen istemci; kurumsal kimlik ve WORM arşiv eklentisi planlı",
    commercialModel: "Yıllık kullanıcı/operasyon paketi; arşiv ve entegrasyon eklentileri",
    availability: "pilot-prep", availabilityLabel: "Tasarım ortağı pilotu hazırlanıyor",
    primaryCta: { label: "Teslim akışını aç", href: "/index.html?product=custody" },
    secondaryCta: { label: "Kanıt sınırlarını gör", href: "/phases.html" },
  }),
  offer({
    id: "core-sdk", segment: "oem", name: "Kionel Core SDK / OEM",
    eyebrow: "Ürüne gömülen optik kanal",
    promise: "Kionel aktarımını LIMS, MES, saha veya cihaz yazılımınızın kendi arayüzüne yerel API ile gömün.",
    buyer: "Yazılım üreticileri, cihaz OEM’leri ve kurumsal platform ekipleri",
    useCases: ["LIMS/MES entegrasyonu", "Cihaz üreticisi arayüzü", "White-label iş akışı"],
    included: ["TypeScript SDK", "Sürümlü tel protokolü", "Conformance testleri", "Enterprise cihaz politikası"],
    deployment: "Müşteri uygulamasında yerel SDK; hassas içerik Kionel bulutuna çıkmaz",
    commercialModel: "Yıllık SDK/OEM lisansı; desteklenen sürüm ve entegrasyon paketi",
    availability: "pilot", availabilityLabel: "SDK pilot entegrasyonuna açık",
    primaryCta: { label: "API yüzeyini incele", href: "/phases.html#api" },
    secondaryCta: { label: "Referans akışı aç", href: "/index.html?product=lab" },
  }),
]);

export const TRANSFER_PRODUCT_UI: Readonly<Record<TransferProductProfile, TransferProductUi>> = Object.freeze({
  lab: Object.freeze({
    name: "Lab Bridge", promise: "Verifiable data transfer for isolated laboratory systems.",
    contextTitle: "Laboratory transaction", referenceLabel: "Work order / instrument reference",
    referencePlaceholder: "e.g. LIMS-2026-0042", noteLabel: "Target system", notePlaceholder: "e.g. LC-MS workstation",
    trust: "Offline · Two signatures · Audit record · 64 MiB",
    workflowHint: "The dispatch record is signed together with the work order, classification and target system.",
    accent: "#ffd54a", referenceRequired: true, defaultClassification: "restricted",
  }),
  custody: Object.freeze({
    name: "Chain Proof", promise: "Sign sample and field handovers together with their content.",
    contextTitle: "Chain of custody", referenceLabel: "Sample / case ID",
    referencePlaceholder: "e.g. SAMPLE-2026-118", noteLabel: "Handover point", notePlaceholder: "e.g. Central laboratory",
    trust: "Signed dispatch · Signed delivery · Content hash · Audit chain",
    workflowHint: "The sample/case ID and handover point are bound to the receipt and cannot be changed silently later.",
    accent: "#6ee7a8", referenceRequired: true, defaultClassification: "confidential",
  }),
});

export type SalesNeed = "existing-transport" | "isolated-systems" | "chain-of-custody" | "embed";
export type DeploymentBoundary = "air-gap" | "on-prem" | "regional-cloud";
export type IdentityTrust = "hardware-required" | "managed-software";
export type PilotIntegration = "standalone" | "file-drop" | "sdk" | "management-api";

export interface PilotBriefInput {
  need: SalesNeed;
  sites: number;
  devices: number;
  deploymentBoundary: DeploymentBoundary;
  identityTrust: IdentityTrust;
  integration: PilotIntegration;
}

export interface PilotBrief {
  schema: "kionel-pilot-brief/v1";
  generatedAt: string;
  product: ProductOffer["id"];
  productName: string;
  availability: OfferAvailability;
  scope: PilotBriefInput;
  dataBoundary: string;
  qualificationRequired: true;
  disclaimer: string;
}

export function recommendedOffer(need: SalesNeed): ProductOffer {
  const productsByNeed: Record<SalesNeed, ProductOffer["id"]> = {
    // İlk sırada duruyor çünkü çoğu kurumun gerçek durumu bu: dosya zaten
    // taşınıyor, eksik olan taşıma değil kanıt.
    "existing-transport": "proof",
    "isolated-systems": "lab-bridge",
    "chain-of-custody": "chain-proof",
    embed: "core-sdk",
  };
  const id = productsByNeed[need];
  return PRODUCT_OFFERS.find((product) => product.id === id)!;
}

export function createPilotBrief(input: PilotBriefInput, now = new Date()): PilotBrief {
  if (!Number.isFinite(now.getTime())) throw new Error("pilot kapsamı zamanı geçersiz");
  if (!input || typeof input !== "object" || !exactKeys(input as unknown as Record<string, unknown>, [
    "need", "sites", "devices", "deploymentBoundary", "identityTrust", "integration",
  ]) || !isSalesNeed(input.need) || !integerIn(input.sites, 1, 1_000) || !integerIn(input.devices, 2, 100_000) ||
      !["air-gap", "on-prem", "regional-cloud"].includes(input.deploymentBoundary) ||
      !["hardware-required", "managed-software"].includes(input.identityTrust) ||
      !["standalone", "file-drop", "sdk", "management-api"].includes(input.integration)) {
    throw new Error("pilot kapsamı alanları geçersiz");
  }
  const product = recommendedOffer(input.need);
  return Object.freeze({
    schema: "kionel-pilot-brief/v1",
    generatedAt: now.toISOString(),
    product: product.id,
    productName: product.name,
    availability: product.availability,
    scope: Object.freeze({
      need: input.need,
      sites: input.sites,
      devices: input.devices,
      deploymentBoundary: input.deploymentBoundary,
      identityTrust: input.identityTrust,
      integration: input.integration,
    }),
    dataBoundary: "Transfer content remains on the local optical data plane and is not uploaded to Kionel management APIs.",
    qualificationRequired: true,
    disclaimer: "This is a technical scoping artifact, not a commercial quote or compliance certification.",
  });
}

export function isTransferProductProfile(value: string | null): value is TransferProductProfile {
  return value === "lab" || value === "custody";
}

export function isSalesNeed(value: string | undefined): value is SalesNeed {
  return value === "isolated-systems" || value === "chain-of-custody" || value === "embed" || value === "existing-transport";
}

function offer<T extends ProductOffer>(value: T): Readonly<T> {
  return Object.freeze({
    ...value,
    useCases: Object.freeze([...value.useCases]),
    included: Object.freeze([...value.included]),
    primaryCta: Object.freeze({ ...value.primaryCta }),
    secondaryCta: Object.freeze({ ...value.secondaryCta }),
  });
}

function integerIn(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
