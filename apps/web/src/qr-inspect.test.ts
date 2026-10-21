import { describe, expect, it } from "vitest";
import { inspectQr } from "./qr-inspect.ts";

const of = (text: string) => inspectQr(new TextEncoder().encode(text));

describe("QR kodun içinde ne var", () => {
  it("Wi-Fi parolasını ve ağ adını görür; kaçırılmış ayırıcıyı çözer", () => {
    expect(of("WIFI:T:WPA;S:Lab\\;Guest;P:s3cr\\;et;;")).toMatchObject({ kind: "wifi", level: "secret", detail: "Lab;Guest" });
    expect(of("WIFI:S:Cafe;T:nopass;P:;;")).toMatchObject({ kind: "wifi-open", level: "plain", detail: "Cafe" });
  });

  it("tek kullanımlık kod sırrını ve doğrulayıcı dışa aktarımını sır sayar", () => {
    expect(of("otpauth://totp/ACME:ada?secret=JBSWY3DPEHPK3PXP&issuer=ACME")).toMatchObject({ kind: "otp", level: "secret" });
    expect(of("otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8")).toMatchObject({ kind: "otp-export", level: "secret" });
  });

  it("bağlantıdaki parolayı ve belirteci adıyla bildirir, sıradan bağlantıyı bildirmez", () => {
    expect(of("https://cam.example/live?id=42&token=9f8e7d6c5b4a3f2e")).toMatchObject({ kind: "link-secret", level: "secret", detail: "token" });
    expect(of("rtsp://admin:hunter22@192.168.1.10/stream")).toMatchObject({ kind: "link-secret", detail: "password" });
    expect(of("https://app.example/#access_token=abcdefgh12345678")).toMatchObject({ kind: "link-secret", detail: "access_token" });
    expect(of("https://kionel.com/transfer.html?key=1")).toMatchObject({ kind: "link", level: "plain" });
    expect(of("https://kionel.com/")).toMatchObject({ kind: "link", level: "plain" });
  });

  it("özel anahtarı ve kurtarma cümlesini sır sayar, sıradan cümleyi saymaz", () => {
    expect(of("5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ")).toMatchObject({ kind: "private-key", level: "secret" });
    expect(of("abandon ability able about above absent absorb abstract absurd abuse access accident")).toMatchObject({ kind: "private-key" });
    expect(of("Numune 12 yarın sabah teslim edilecek")).toMatchObject({ kind: "text", level: "plain" });
  });

  it("okunamayan yığını şifreli saymaz: bilinemez der", () => {
    expect(of("l1qhP2ciaiZk93mXw0Qa7LrT5uVbN8yE")).toMatchObject({ kind: "opaque", level: "opaque" });
    const binary = inspectQr(new Uint8Array([0xff, 0xfe, 0x00, 0x81, 0x90]));
    expect(binary).toMatchObject({ kind: "opaque", level: "opaque", text: "ff fe 00 81 90", bytes: 5 });
    expect(of("kısa")).toMatchObject({ kind: "text" });
  });

  it("kişi kartını düz metin olarak tanır", () => {
    expect(of("BEGIN:VCARD\nVERSION:3.0\nFN:Ada\nEND:VCARD")).toMatchObject({ kind: "contact", level: "plain" });
  });
});
