// SPDX-License-Identifier: Apache-2.0
// Bu dosya kalıcı olarak Apache-2.0'dır: kanıtı doğrulama yeteneği
// Kionel'in var olmaya devam etmesine bağlı olamaz. Bkz. LICENSING-MAP.md
/**
 * Bağımsız makbuz doğrulayıcı.
 * Kullanım: pnpm verify makbuz.json [içerik-dosyası] [--tsa-anchor=<kök.pem>]
 *
 * Ağa çıkmaz, Kionel'a ait hiçbir servise sormaz. Makbuzun tek başına
 * doğrulanabilir olması ürünün iddiasının kanıtıdır. Zaman damgası doğrulaması
 * da çevrimdışıdır: jeton makbuzun içinde taşınır, TSA'ya sorulmaz.
 */
import { readFileSync } from "node:fs";
import { isReceiptV2, receiptHash, verifyReceipt, verifyReceiptV2, type Receipt } from "@kionel/crypto";
import {
  DIGICERT_TRUSTED_ROOT_G4, anchorBytes, verifyReceiptTimestamp, verifyTimestamp, type TimestampedReceiptV2,
} from "@kionel/timestamp";

const args = process.argv.slice(2);
const anchorFlags = args.filter((value) => value.startsWith("--tsa-anchor="));
const [file, contentFile] = args.filter((value) => !value.startsWith("--"));
if (!file) {
  console.error("kullanım: pnpm verify <makbuz.json> [içerik-dosyası] [--tsa-anchor=<kök.pem>]");
  process.exit(2);
}
const tsaAnchors = anchorFlags.map((flag) => readFileSync(flag.slice("--tsa-anchor=".length), "utf8"));
// Uygulamanın kullandığı otoritenin kökü yerleşiktir (DigiCert Trusted Root G4,
// parmak izi packages/timestamp/src/anchors.ts'de); --tsa-anchor başka kök ekler.
const v1Anchors = [Buffer.from(anchorBytes(DIGICERT_TRUSTED_ROOT_G4)), ...tsaAnchors];

const receipt: unknown = JSON.parse(readFileSync(file, "utf8"));
const content = contentFile ? new Uint8Array(readFileSync(contentFile)) : undefined;
const v2 = isReceiptV2(receipt);
const { ok, reason } = v2
  ? await verifyReceiptV2(receipt, content)
  : await verifyReceipt(receipt as Receipt, content);

console.log(`${ok ? "GEÇERLİ" : "GEÇERSİZ"} — ${reason}`);
if (receipt && typeof receipt === "object") {
  const display = receipt as {
    v?: unknown; session?: unknown; at?: unknown; bytes?: unknown; hash?: unknown;
    sender?: unknown; receiver?: unknown;
  };
  console.log(`  protokol Kionel v${String(display.v ?? "?")}`);
  console.log(`  oturum   ${String(display.session ?? "?")}`);
  console.log(`  zaman    ${String(display.at ?? "?")}  (cihaz saati)`);
  console.log(`  boyut    ${String(display.bytes ?? "?")} bayt`);
  console.log(`  içerik   ${String(display.hash ?? "?")}`);
  console.log(`  gönderen ${displayKey(display.sender)}`);
  console.log(`  alıcı    ${displayKey(display.receiver)}`);
}
// Zaman damgası ayrı bir sonuçtur ve imza sonucunu ezmez: damgasız bir makbuz
// hâlâ geçerli bir makbuzdur, yalnızca saati kendi beyanıdır. Buna karşılık
// REDDEDİLEN bir damga çıkış kodunu düşürür — sahte bir damga, damgasızlıktan
// kötüdür, çünkü olduğundan güçlü görünür.
let timestampOk = true;
if (v2) {
  const stamp = await verifyReceiptTimestamp(receipt as TimestampedReceiptV2, { anchors: tsaAnchors });
  if (stamp.state === "verified") {
    console.log(`  damga    ${stamp.verdict.at.toISOString()}  ±${stamp.verdict.accuracyMs} ms`);
    console.log(`  otorite  ${stamp.verdict.authority}`);
  } else if (stamp.state === "rejected") {
    timestampOk = false;
    console.log(`  damga    REDDEDİLDİ — ${stamp.reason}`);
  } else {
    console.log("  damga    yok — makbuzdaki saat cihazın kendi saatidir ve geçmişe atılabilir");
  }
} else if (receipt && typeof receipt === "object" && "tst" in receipt) {
  // v1: damga makbuzun özetini (iki imzasıyla birlikte, receiptHash) damgalar.
  const tst = (receipt as { tst?: { token?: unknown; at?: unknown } }).tst;
  const token = typeof tst?.token === "string" ? new Uint8Array(Buffer.from(tst.token, "base64")) : undefined;
  const stamp = token
    ? verifyTimestamp(token, new Uint8Array(await receiptHash(receipt as unknown as Receipt)), { anchors: v1Anchors })
    : { ok: false as const, code: "malformed", reason: "zaman damgası biçimi bozuk" };
  if (stamp.ok && tst?.at === stamp.at.toISOString()) {
    console.log(`  damga    ${stamp.at.toISOString()}  (bağımsız otorite)`);
    console.log(`  otorite  ${stamp.authority}`);
  } else {
    timestampOk = false;
    console.log(`  damga    REDDEDİLDİ — ${stamp.ok ? "okunabilir zaman jetonla çelişiyor (elle düzenlenmiş)" : stamp.reason}`);
  }
}

if (!contentFile) console.log("\n  İçerik dosyası verilmedi: hash'in gerçekten o dosyaya ait olduğu kontrol EDİLMEDİ.");
if (v2 && !tsaAnchors.length) console.log("  --tsa-anchor verilmedi: v2 makbuzda zaman damgası varsa doğrulanamaz.");
process.exit(ok && timestampOk ? 0 : 1);

function displayKey(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "kid" in value && typeof value.kid === "string") return value.kid;
  return "?";
}
