/**
 * Kionel bench — sentetik kanal üzerinden ölçüm. Kamera gerekmez, CI'da koşar.
 * Kullanım: pnpm bench [--size=1048576] [--trials=25]
 */
import { PROFILES, simulate, simulateDuplex, type RunResult } from "@kionel/core";

const arg = (name: string, def: number) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split("=")[1]) : def;
};

const SIZE = arg("size", 1024 * 1024);
const TRIALS = arg("trials", 25);
const LOSS_RATES = [0, 0.1, 0.2, 0.3, 0.5];

const payload = new Uint8Array(SIZE);
for (let i = 0; i < SIZE; i++) payload[i] = (i * 2654435761) & 0xff;

const pct = (xs: number[], p: number) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];

console.log(`Kionel bench — ${(SIZE / 1024).toFixed(0)} KB, ${TRIALS} deneme/senaryo`);
console.log("fps ve frameBytes ÖLÇÜLMEMİŞ tahminlerdir (channel.ts PROFILES).\n");

const rows: Record<string, string | number>[] = [];
for (const profile of Object.values(PROFILES)) {
  for (const lossRate of LOSS_RATES) {
    const runs: RunResult[] = [];
    for (let t = 0; t < TRIALS; t++) {
      runs.push(simulate(payload, profile, { lossRate, corruptRate: 0.01, seed: t + 1 }));
    }
    const secs = runs.map((r) => r.seconds);
    rows.push({
      profil: profile.id,
      "kayıp": `${(lossRate * 100).toFixed(0)}%`,
      blok: runs[0].k,
      "başarı": `${((runs.filter((r) => r.ok).length / TRIALS) * 100).toFixed(0)}%`,
      "fazlalık": (runs.reduce((s, r) => s + r.overhead, 0) / TRIALS).toFixed(3),
      "goodput KB/s": (runs.reduce((s, r) => s + r.goodputKBs, 0) / TRIALS).toFixed(1),
      "süre p50 s": pct(secs, 0.5).toFixed(1),
      "süre p99 s": pct(secs, 0.99).toFixed(1),
    });
  }
}
console.table(rows);

const duplexProfile = PROFILES["qr-v27-L-30"];
const duplexRows: Record<string, string>[] = [];
for (const lossRate of LOSS_RATES.slice(0, 4)) {
  const simplexSeconds: number[] = [];
  const duplexSeconds: number[] = [];
  const rounds: number[] = [];
  for (let t = 0; t < TRIALS; t++) {
    simplexSeconds.push(simulate(payload, duplexProfile, { lossRate, corruptRate: 0.01, seed: t + 1 }).seconds);
    const run = simulateDuplex(payload, duplexProfile, {
      lossRate, corruptRate: 0.01, ackLossRate: lossRate, seed: t + 1,
    });
    duplexSeconds.push(run.seconds);
    rounds.push(run.rounds);
  }
  const simplex = simplexSeconds.reduce((a, b) => a + b, 0) / TRIALS;
  const duplex = duplexSeconds.reduce((a, b) => a + b, 0) / TRIALS;
  duplexRows.push({
    kayıp: `${lossRate * 100}%`,
    "simplex s": simplex.toFixed(2),
    "duplex ARQ s": duplex.toFixed(2),
    kazanç: `${(((simplex - duplex) / simplex) * 100).toFixed(1)}%`,
    "tur p99": String(pct(rounds, 0.99)),
  });
}
console.log("\nDuplex ARQ karşılaştırması — qr-v27-L-30 (ACK kare süresi dahildir)");
console.table(duplexRows);

// İlk-bayta-kadar-süre: LT sistematik değil, hiçbir kaynak blok tamamlanma
// öncesinde garanti değil. TTFB == tamamlanma süresi. Faz 1'de sistematik
// önek (ilk k çerçeve = ham blok) denenirse burası ayrışır.
const best = rows.reduce((a, b) => (Number(a["goodput KB/s"]) > Number(b["goodput KB/s"]) ? a : b));
console.log(`\nEn iyi goodput: ${best["goodput KB/s"]} KB/s (${best.profil}, kayıp ${best["kayıp"]})`);
console.log(`Faz 1 hedefi 100 KB/s — QR taşımasının teorik tavanı = frameBytes × fps.`);
