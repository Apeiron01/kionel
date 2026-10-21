/**
 * Lisans aracı.
 *
 * İki tarafı var ve ikisi de bilinçli olarak ayrı:
 *
 *  - `authority` ve `issue` BİZİM tarafımız. Ödeme tamamlandığında lisans dosyası
 *    burada imzalanır. Polar kasa, lisans otoritesi biz — Polar'ın kendi anahtar
 *    özelliği kullanılmaz çünkü doğrulaması onların API'sine bağlıdır ve müşteriyi
 *    iki ayrı şirketin ayakta kalmasına bağımlı kılardı.
 *
 *  - `verify` MÜŞTERİNİN tarafı ve ağa çıkmaz. Bize sorulmaz, Polar'a sorulmaz.
 *
 * Lisansın yazılımı kilitlemediğini burada da tekrar ediyoruz: süresi dolmuş bir
 * lisans uyarı gösterir, çıkış kodunu düşürmez. Zorlama işlettiğimiz hizmettedir.
 *
 *   pnpm license authority                        # otorite anahtarını üret/göster
 *   pnpm license issue --licensee="..." --tier=enterprise --months=12 \
 *                      --sites=3 --devices=40 --lines=lab-bridge,proof
 *   pnpm license verify <lisans.json> --authority=<açık-anahtar.json>
 *
 * Dördüncü komut `countersign` ve satılan şey aslında odur. Bir laboratuvar
 * ölçümü kendi anahtarıyla imzalar; bu bizden bağımsızdır ve öyle kalmalıdır.
 * Karşı imza bunun ÜSTÜNE gelir: "bu belgeyi tedarikçi de bağımsız olarak
 * imzaladı". Yamalanarak elde edilemez, çünkü otorite özel anahtarı hiçbir zaman
 * istemciye gitmez — ürünün tek gerçek zorlama noktası budur ve yazılımı
 * kilitlemek yerine bir belgeyi zenginleştirerek çalışır.
 *
 *   pnpm license countersign <belge.json> --license=<lisans.json> --kind=qualification
 *   pnpm license check <belge.json> --countersignature=<imza.json> --authority=<açık-anahtar.json>
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { PlatformSigningIdentity } from "@kionel/platform-keys";
import {
  COUNTERSIGN_KINDS, LICENSE_TIERS, countersignEvidence, countersignNotice, issueLicense,
  licenseExpiry, licenseNotice, verifyCountersignature, verifyLicense,
  type CountersignKind, type LicenseTier,
} from "@kionel/licensing";

const AUTHORITY_PATH = join(homedir(), ".kionel", "license-authority.json");

const flag = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "base64url"));

/**
 * Otorite anahtarı. Bu dosya özel anahtar taşır; şifreli çevrimdışı yedek gerekir:
 * kaybedilirse yeni lisans imzalanamaz, sızarsa herkes bizim adımıza lisans
 * üretir. Üretimde bunun bir HSM'e taşınması gerekir; bugünkü hâli operasyonel
 * bir araçtır ve bunu gizlemek yerine yazıyoruz.
 */
async function loadAuthority(path: string, create = false): Promise<PlatformSigningIdentity> {
  if (!existsSync(path) && !create) throw new Error("Otorite bulunamadı; önce authority komutuyla açıkça oluşturun.");
  const usable = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as { privateKey: JsonWebKey; publicKey: string })
    : undefined;

  const pair = usable
    ? {
        privateKey: await crypto.subtle.importKey("jwk", usable.privateKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]),
        publicKey: unb64(usable.publicKey),
      }
    : await (async () => {
        const generated = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
        const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", generated.publicKey));
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify({
          privateKey: await crypto.subtle.exportKey("jwk", generated.privateKey),
          publicKey: b64(publicKey),
        }, null, 2), { mode: 0o600, flag: "wx" });
        console.log(`Yeni lisans otoritesi oluşturuldu: ${path}`);
        console.log("  Özel anahtarı koruyun; şifreli yedeğini çevrimdışı tutun.");
        console.log("  sızarsa herkes sizin adınıza lisans üretebilir. Yedeğini çevrimdışı tutun.");
        return { privateKey: generated.privateKey, publicKey };
      })();

  return {
    providerId: "kionel-license-authority",
    keyId: "urn:kionel:license-authority",
    algorithm: "ecdsa-p256-sha256",
    publicKey: pair.publicKey,
    securityLevel: "software-protected",
    persistence: "persistent",
    attestation: { status: "not-available" },
    async sign(data) {
      return new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, pair.privateKey, data as BufferSource));
    },
  };
}

async function main(): Promise<void> {
  const [command, target] = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  const authorityPath = resolve(flag("authority-key") ?? AUTHORITY_PATH);

  if (command === "authority") {
    const out = flag("out");
    if (out && existsSync(out)) die("Çıktı dosyası zaten var; üzerine yazılmadı.");
    if (out && resolve(out).toLowerCase() === authorityPath.toLowerCase()) die("Açık ve özel anahtar yolları aynı olamaz.");
    const authority = await loadAuthority(authorityPath, true);
    if (out) {
      // Açık anahtar müşteriye ve uygulamaya gömülür; özel anahtar asla çıkmaz.
      writeFileSync(out, JSON.stringify({ publicKey: b64(authority.publicKey) }, null, 2), { flag: "wx" });
      console.log(`Açık anahtar yazıldı: ${out}`);
    }
    console.log(`otorite  ${authorityPath}`);
    console.log(`anahtar  ${b64(authority.publicKey)}`);
    return;
  }

  if (command === "issue") {
    const licensee = flag("licensee") ?? die('--licensee="Ticari Unvan" gerekli');
    const tier = (flag("tier") ?? "pilot") as LicenseTier;
    if (!(LICENSE_TIERS as readonly string[]).includes(tier)) {
      die(`--tier=<${LICENSE_TIERS.join("|")}> gerekli`);
    }
    const months = Number(flag("months") ?? 12);
    const sites = Number(flag("sites") ?? 1);
    const devices = Number(flag("devices") ?? 10);
    const lines = (flag("lines") ?? "proof").split(",").map((line) => line.trim()).filter(Boolean);
    if (!Number.isInteger(months) || months < 1 || months > 120) die("--months 1..120 arasında tam sayı olmalı");

    const issuedAt = new Date();
    const validUntil = licenseExpiry(issuedAt, months);

    const authority = await loadAuthority(authorityPath);
    const license = await issueLicense(authority, {
      licensee: licensee!, tier, scope: { sites, devices, productLines: lines }, issuedAt, validUntil,
    });

    const out = flag("out") ?? `kionel-license-${tier}.json`;
    writeFileSync(out, JSON.stringify(license, null, 2), { flag: "wx" });
    console.log(`Lisans imzalandı: ${out}`);
    console.log(`  sahip    ${license.licensee}`);
    console.log(`  katman   ${license.tier}`);
    console.log(`  kapsam   ${sites} saha · ${devices} cihaz · ${lines.join(", ")}`);
    console.log(`  geçerlik ${license.validUntil.slice(0, 10)}`);
    console.log("\n  Müşteri doğrulaması (ağa çıkmaz):");
    console.log(`  pnpm license verify ${out} --authority=<açık-anahtar.json>`);
    return;
  }

  if (command === "verify") {
    if (!target) die("kullanım: pnpm license verify <lisans.json> --authority=<açık-anahtar.json>");
    const authorityFile = flag("authority") ?? die("--authority=<güvenilen-açık-anahtar.json> gerekli; özel anahtar kullanılmaz.");
    const publicKey = unb64((JSON.parse(readFileSync(authorityFile, "utf8")) as { publicKey: string }).publicKey);

    const state = await verifyLicense(JSON.parse(readFileSync(target, "utf8")), publicKey);
    console.log(licenseNotice(state));

    // Süresi dolmuş lisans BAŞARISIZLIK DEĞİLDİR: yazılım çalışmaya devam eder ve
    // çıkış kodu bunu yansıtmalı. Yalnız sahte/bozuk belge hata sayılır.
    if (state.state === "invalid") process.exit(1);
    return;
  }

  if (command === "countersign") {
    if (!target) die("kullanım: pnpm license countersign <belge.json> --license=<lisans.json> --kind=...");
    const kind = (flag("kind") ?? "qualification") as CountersignKind;
    if (!(COUNTERSIGN_KINDS as readonly string[]).includes(kind)) {
      die(`--kind=<${COUNTERSIGN_KINDS.join("|")}> gerekli`);
    }
    const licenseFile = flag("license") ?? die("--license=<lisans.json> gerekli; karşı imza lisanstan bağımsız üretilmez.");
    const document: unknown = JSON.parse(readFileSync(target, "utf8"));

    const authority = await loadAuthority(authorityPath);
    // Süresi dolmuş lisans burada — ve YALNIZ burada — reddedilir. Müşterinin
    // eldeki belgeleri geçerliliğini korur; yenilemeyen yalnız yenisini alamaz.
    const countersignature = await countersignEvidence(authority, {
      kind, document, license: JSON.parse(readFileSync(licenseFile, "utf8")),
    });

    const out = flag("out") ?? `${target.replace(/\.json$/, "")}.countersignature.json`;
    writeFileSync(out, JSON.stringify(countersignature, null, 2), { flag: "wx" });
    console.log(`Karşı imza atıldı: ${out}`);
    console.log(`  belge    ${target} (${kind})`);
    console.log(`  sahip    ${countersignature.licensee} · ${countersignature.tier}`);
    console.log("\n  Denetçi doğrulaması (ağa çıkmaz):");
    console.log(`  pnpm license check ${target} --countersignature=${out} --authority=<açık-anahtar.json>`);
    return;
  }

  if (command === "check") {
    if (!target) die("kullanım: pnpm license check <belge.json> --countersignature=<imza.json> --authority=<açık-anahtar.json>");
    const authorityFile = flag("authority") ?? die("--authority=<güvenilen-açık-anahtar.json> gerekli; özel anahtar kullanılmaz.");
    const publicKey = unb64((JSON.parse(readFileSync(authorityFile, "utf8")) as { publicKey: string }).publicKey);
    const signatureFile = flag("countersignature");

    const state = await verifyCountersignature(
      signatureFile ? JSON.parse(readFileSync(signatureFile, "utf8")) : undefined,
      JSON.parse(readFileSync(target, "utf8")),
      publicKey,
    );
    console.log(countersignNotice(state));

    // "Karşı imza yok" bir hata DEĞİLDİR: karşı imzasız bir rapor hâlâ geçerli
    // bir rapordur. İkisini karıştırmak dürüst müşterinin belgesini sahte gösterirdi.
    if (state.state === "rejected") process.exit(1);
    return;
  }

  die([
    "kullanım:",
    "  pnpm license authority [--out=<açık-anahtar.json>]",
    '  pnpm license issue --licensee="..." [--tier=pilot|oem|enterprise] [--months=12]',
    "                     [--sites=1] [--devices=10] [--lines=proof,lab-bridge] [--out=...]",
    "  pnpm license verify <lisans.json> --authority=<açık-anahtar.json>",
  ].join("\n"));
}

await main().catch((error: unknown) => die(error instanceof Error ? error.message : "Lisans işlemi başarısız"));
