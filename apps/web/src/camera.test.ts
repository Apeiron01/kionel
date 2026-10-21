import { describe, expect, it } from "vitest";
import { cameraConstraints } from "./camera.ts";

describe("kamera kısıtları", () => {
  it("cihaz seçilmemişse arka kamerayı tercih eder", () => {
    const constraints = cameraConstraints();
    expect(constraints.facingMode).toBe("environment");
    expect(constraints.deviceId).toBeUndefined();
  });

  it("cihaz seçildiyse facingMode GÖNDERMEZ", () => {
    // İkisini birlikte göndermek seçilen kameranın sessizce yok sayılmasına yol
    // açar: kullanıcı bir kamera seçer, başka bir kamera açılır, kimse anlamaz.
    const constraints = cameraConstraints("usb-cam-1");
    expect(constraints.deviceId).toEqual({ exact: "usb-cam-1" });
    expect(constraints.facingMode).toBeUndefined();
  });

  it("her iki durumda da çözünürlük ve odak isteği korunur", () => {
    for (const constraints of [cameraConstraints(), cameraConstraints("x")]) {
      expect(constraints.width).toEqual({ ideal: 1920 });
      expect(constraints.frameRate).toEqual({ ideal: 60 });
      expect(constraints.advanced?.[0]).toMatchObject({ focusMode: "continuous" });
    }
  });
});
