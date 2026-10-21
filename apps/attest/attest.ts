/**
 * Kionel Proof — taşıyıcıdan bağımsız teslim kanıtı.
 *
 * Kionel'in değeri optik kanal değil, kanıt. Optik kanal o kanıtı üreten
 * taşıyıcılardan yalnızca biri ve kanıt katmanı ondan tamamen bağımsız yazıldı.
 * Bu araç o bağımsızlığı gerçek kılar: dosya USB ile, veri diyodu ile, kurye ile
 * ya da elden gitsin — sevk ve teslim yine iki tarafça imzalanır ve yine
 * çevrimdışı doğrulanır.
 *
 * Bunun önemi şu: "kamera yasak" ya da "iki cihaz yok" diyen bir kuruma artık
 * "o zaman alamazsınız" demek zorunda değiliz.
 *
 * Sevk kaydı birkaç yüz bayttır — tek bir QR karesine sığar. Yani içerik USB ile
 * geçerken kanıt ekrandan geçebilir; taşınan hassas şey dosya değil, imzadır.
 *
 *   pnpm attest identity                          # yerel kimliği göster/oluştur
 *   pnpm attest dispatch <dosya> [--ref=...]      # gönderen: sevk kaydı imzala
 *   pnpm attest deliver <dosya> --dispatch=<f>    # alıcı: doğrula ve teslimi imzala
 *   pnpm verify receipt.json <dosya>              # herkes: çevrimdışı doğrula
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  ENDORSEMENT_ROLES,
  ROLE_LABELS,
  createIdentity,
  exportIdentity,
  importIdentity,
  verifyDispatch,
  verifyEndorsements,
  verifyReceipt,
  type Bytes,
  type Dispatch,
  type Endorsement,
  type EndorsementRole,
  type Identity,
} from "@kionel/crypto";
import { endorse, issueDispatch, issueReceipt } from "@kionel/issue";
import { drawFrameToPng } from "./qr-png.ts";
import { requireProductionLicense } from "./license-access.ts";

const DEFAULT_IDENTITY = join(homedir(), ".kionel", "identity.json");

const owned = (bytes: Uint8Array): Bytes => new Uint8Array(bytes);
const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

function flag(name: string): string | undefined {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  return match?.slice(name.length + 3);
}

function die(message: string): never {
  console.error(message);
  process.exit(2);
}

/**
 * Kalıcı imza kimliği.
 *
 * Optik akışta anahtar tarayıcının çıkarılamaz anahtar kasasında durur. Bir CLI'da
 * o kasa yok, dolayısıyla anahtar dosyadadır ve dosyayı okuyabilen onunla imza
 * atabilir. Bunu gizlemek yerine yazıyoruz: yüksek güvence isteyen dağıtım
 * donanım kasası kullanmalı, bu araç operasyonel kanıt içindir.
 */
async function loadIdentity(path: string): Promise<Identity> {
  if (existsSync(path)) return importIdentity(JSON.parse(readFileSync(path, "utf8")) as JsonWebKey);
  const identity = await createIdentity();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(await exportIdentity(identity), null, 2), { mode: 0o600 });
  console.log(`Yeni kimlik oluşturuldu: ${path}`);
  console.log("  Bu dosya özel anahtar taşır. Okuyabilen herkes sizin adınıza imza atabilir.");
  return identity;
}

/** Sevk ve teslim aynı oturum numarasında buluşmalı; içerikten türetiliyor. */
async function sessionOf(content: Uint8Array): Promise<number> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", content as BufferSource));
  return new DataView(digest.buffer).getUint32(0) >>> 0;
}

async function main(): Promise<void> {
  const [command, target] = process.argv.slice(2).filter((value) => !value.startsWith("--"));
  const identityPath = resolve(flag("identity") ?? DEFAULT_IDENTITY);

  if (command === "identity") {
    const identity = await loadIdentity(identityPath);
    console.log(`kimlik   ${identityPath}`);
    console.log(`anahtar  ${b64url(identity.pub)}`);
    return;
  }

  if (!command || !target) {
    die([
      "kullanım:",
      "  pnpm attest identity",
      "  pnpm attest dispatch <dosya> [--ref=<referans>] [--qr=<çıktı.png>]",
      "  pnpm attest approve <dosya> --role=<rol> [--ref=...] [--note=...]",
      "  pnpm attest chain <dosya>",
      "  pnpm attest deliver <dosya> --dispatch=<sevk.json> [--out=<makbuz.json>]",
      "",
      `  roller: ${ENDORSEMENT_ROLES.join(", ")}`,
    ].join("\n"));
  }

  if (["dispatch", "deliver", "approve"].includes(command)) {
    // Açık anahtar komut satırından ALINMAZ: müşteri kendi anahtarını verip
    // kendine lisans imzalayabilirdi.
    await requireProductionLicense(flag("license"));
  }
  const content = owned(readFileSync(target));
  const session = await sessionOf(content);

  if (command === "dispatch") {
    const identity = await loadIdentity(identityPath);
    const reference = flag("ref");
    const dispatch = await issueDispatch(identity, {
      session,
      content,
      context: reference ? { profile: "custody", reference } : undefined,
    });
    const out = flag("out") ?? `${target}.dispatch.json`;
    writeFileSync(out, JSON.stringify(dispatch, null, 2));
    console.log(`Sevk kaydı imzalandı: ${out}`);
    console.log(`  içerik   ${dispatch.hash}`);
    console.log(`  boyut    ${dispatch.bytes} bayt`);
    console.log(`  gönderen ${dispatch.sender}`);

    // Kaydı QR olarak da verebiliyoruz: dosya USB ile geçerken kanıtın ekrandan
    // geçmesi, hassas olanın dosya değil imza olduğu senaryoyu mümkün kılıyor.
    const qr = flag("qr");
    if (qr) {
      const bytes = new TextEncoder().encode(JSON.stringify(dispatch));
      drawFrameToPng(bytes, qr);
      console.log(`  QR       ${qr} (${bytes.length} bayt)`);
    }
    console.log("\nDosyayı ve sevk kaydını alıcıya ulaştırın. Yol önemli değil.");
    return;
  }

  // ---- onay zinciri ------------------------------------------------------
  // Dosyanın kendi geçmişini taşıması: sonucu kim üretti, kim inceledi, kim
  // serbest bıraktı. Bugün bu üç bilgi üç ayrı yerde durur ve hiçbiri dosyayla
  // birlikte seyahat etmez; izole bir cihazda ise ikinci göz incelemesi omuz
  // üstünden yapılıp hiçbir yere yazılmaz.
  const chainPath = `${target}.endorsements.json`;
  const readChain = (): Endorsement[] =>
    existsSync(chainPath) ? (JSON.parse(readFileSync(chainPath, "utf8")) as Endorsement[]) : [];

  if (command === "approve") {
    const role = flag("role") as EndorsementRole | undefined;
    if (!role || !(ENDORSEMENT_ROLES as readonly string[]).includes(role)) {
      die(`--role=<${ENDORSEMENT_ROLES.join("|")}> gerekli`);
    }
    const chain = readChain();
    const existing = await verifyEndorsements(chain, content);
    if (!existing.ok) die(`Onay reddedildi: ${existing.reason}`);
    const identity = await loadIdentity(identityPath);
    const link = await endorse(identity, {
      content, role: role!, chain,
      reference: flag("ref"), note: flag("note"),
    });
    chain.push(link);
    writeFileSync(chainPath, JSON.stringify(chain, null, 2));

    const verdict = await verifyEndorsements(chain, content);
    console.log(`Onay eklendi: ${ROLE_LABELS[role!]}`);
    console.log(`  zincir   ${verdict.chain.join(" → ")}`);
    console.log(`  dosya    ${chainPath}`);
    if (!verdict.ok) die(`  ZİNCİR GEÇERSİZ — ${verdict.reason}`);
    return;
  }

  if (command === "chain") {
    const chain = readChain();
    if (!chain.length) {
      console.log("Bu dosyada onay zinciri yok.");
      return;
    }
    const verdict = await verifyEndorsements(chain, content);
    console.log(`Onay zinciri — ${verdict.ok ? "GEÇERLİ" : "GEÇERSİZ"}: ${verdict.reason}`);
    for (const [index, link] of chain.entries()) {
      const detail = [link.reference, link.note].filter(Boolean).join(" · ");
      console.log(`  ${index + 1}. ${ROLE_LABELS[link.role].padEnd(22)} ${link.at}${detail ? `  (${detail})` : ""}`);
      console.log(`     imzalayan ${link.signer}`);
    }
    if (!verdict.ok) process.exit(1);
    return;
  }

  if (command === "deliver") {
    const dispatchPath = flag("dispatch") ?? die("--dispatch=<sevk.json> gerekli");
    const dispatch = JSON.parse(readFileSync(dispatchPath!, "utf8")) as Dispatch;

    // Alıcı, elindeki dosyanın sevk kaydındaki dosya olduğunu ÖNCE doğrular.
    // Doğrulamadan imzalamak, kanıtı kanıt olmaktan çıkarır.
    const dispatchVerdict = await verifyDispatch(dispatch, content);
    if (!dispatchVerdict.ok) die(`Teslim reddedildi: ${dispatchVerdict.reason}`);
    const chainVerdict = await verifyEndorsements(readChain(), content);
    if (!chainVerdict.ok) die(`Teslim reddedildi: ${chainVerdict.reason}`);
    const identity = await loadIdentity(identityPath);

    const receipt = await issueReceipt(identity, {
      session: dispatch.session,
      content,
      sender: owned(Buffer.from(dispatch.sender, "base64url")),
      dispatch,
    });
    const out = flag("out") ?? `${target}.receipt.json`;
    const verdict = await verifyReceipt(receipt, content);
    if (!verdict.ok) die(`Teslim reddedildi: ${verdict.reason}`);
    writeFileSync(out, JSON.stringify(receipt, null, 2));
    console.log(`Teslim imzalandı: ${out}`);
    if (chainVerdict.chain.length) {
      console.log(`  onaylar   ${chainVerdict.chain.join(" → ")}`);
      if (!chainVerdict.ok) console.log(`  UYARI     onay zinciri geçersiz — ${chainVerdict.reason}`);
    }
    console.log(`  doğrulama ${verdict.ok ? "GEÇERLİ" : "GEÇERSİZ"} — ${verdict.reason}`);
    console.log(`  imzalayan ${verdict.signers.join(" + ")}`);
    console.log("\n  Bu makbuz bize hiç bağlanmadan doğrulanır:");
    console.log(`  pnpm verify ${out} ${target}`);
    console.log("\n  Saat cihazın kendi saatidir. Bağımsız zaman gerekiyorsa makbuz");
    console.log("  bir zaman damgası otoritesine mühürletilmelidir.");
    return;
  }

  die(`bilinmeyen komut: ${command}`);
}

// Yalnız mesaj: paketlenmiş sürümde yakalanmayan hata, küçültülmüş kodu ekrana döker.
try { await main(); } catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
