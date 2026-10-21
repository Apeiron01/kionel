/**
 * Kamera seçimi.
 *
 * Alıcı uç bugüne kadar `facingMode: "environment"` ile açılıyordu; bu bir
 * telefonda arka kamerayı seçer ama dizüstünde veya masaüstünde anlamı yoktur.
 * Sonuç: ürün sessizce "iki telefon" ürünü olmuştu.
 *
 * Oysa zorunlu olan iki *cihaz* değil, bir ekran ve bir sensör. Dizüstünün kendi
 * kamerası, ucuz bir USB kamera ya da bir doküman kamerası pekâlâ alıcı olabilir —
 * ve bu, "iki cihazımız yok" diyen kuruma verilecek en ucuz cevap. Eksik olan tek
 * şey, kullanıcının hangi kamerayı kullanacağını söyleyebilmesiydi.
 *
 * Tarayıcı kısıtı: `enumerateDevices` izin verilmeden cihaz ADLARINI vermez. Bu
 * yüzden akış zorunlu olarak iki adımlı — önce izin, sonra liste.
 */

const STORAGE_KEY = "kionel.camera.deviceId";

export interface CameraChoice {
  deviceId: string;
  label: string;
}

/** Kullanıcının son seçimi. Her aktarımda yeniden seçtirmek gereksiz sürtünmedir. */
export function rememberedCamera(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    // Gizli sekme veya site verisi kapalı: hatırlamamak akışı bozmaz.
    return undefined;
  }
}

export function rememberCamera(deviceId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, deviceId);
  } catch {
    // Sessizce geç: tercih saklamak ürünün çalışması için gerekli değil.
  }
}

/**
 * Kamera kısıtları.
 *
 * Açık bir cihaz seçildiyse `facingMode` GÖNDERİLMEZ. İkisini birlikte
 * göndermek, seçilen cihazın sessizce göz ardı edilmesine yol açar — kullanıcı
 * bir kamera seçer, başka bir kamera açılır ve nedenini kimse anlamaz.
 */
export function cameraConstraints(deviceId?: string): MediaTrackConstraints {
  const shared: MediaTrackConstraints = {
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 60 },
    advanced: [{ focusMode: "continuous" } as MediaTrackConstraintSet],
  };
  return deviceId
    ? { ...shared, deviceId: { exact: deviceId } }
    : { ...shared, facingMode: "environment" };
}

/**
 * Kullanılabilir kameralar.
 *
 * İzin verilmemişse adlar boş gelir; o durumda liste göstermek kullanıcıya
 * "Kamera 1 / Kamera 2" diye anlamsız bir seçim sunmak olur. Boş dönmek ve
 * seçiciyi hiç göstermemek daha dürüst.
 */
export async function availableCameras(): Promise<CameraChoice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((device) => device.kind === "videoinput" && device.deviceId && device.label)
      .map((device) => ({ deviceId: device.deviceId, label: device.label }));
  } catch {
    return [];
  }
}

/**
 * Seçiciyi doldurur. Tek kamera varsa gizler: seçenek sunmayan bir seçici,
 * kullanıcıya olmayan bir karar verdiriyormuş gibi görünür.
 */
export async function populateCameraPicker(select: HTMLSelectElement): Promise<void> {
  const cameras = await availableCameras();
  if (cameras.length < 2) {
    select.hidden = true;
    return;
  }
  const remembered = rememberedCamera();
  select.replaceChildren(...cameras.map((camera) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label;
    option.selected = camera.deviceId === remembered;
    return option;
  }));
  select.hidden = false;
}
