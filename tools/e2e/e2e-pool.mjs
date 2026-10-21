// Canlı okumada çözme havuzu: işçilerle teslim, ve işçiler hiç cevap vermezse
// (betiği ağda takılan işçi) birkaç saniye sonra ana iş parçacığına dönüp yine teslim.
// Kullanım: node tools/e2e/e2e-pool.mjs <scratch> <site>
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [SP, BASE] = process.argv.slice(2);
const script = fileURLToPath(new URL("./e2e-livespeed.mjs", import.meta.url));
let pass = 0, fail = 0;
const check = (name, ok, d = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${d ? "  — " + d : ""}`); };
const run = (env) => spawnSync(process.execPath, [script, SP, BASE, "40", "4"], { encoding: "utf8", env: { ...process.env, ...env } }).stdout.trim();
const seconds = (out) => Number(/([\d.]+) s toplam/.exec(out)?.[1] ?? NaN);

const normal = run({ HANG_WORKERS: "" });
check("işçilerle: dosya teslim edildi ve aynı", /teslim: evet · dosya aynı: true · JS hataları: yok/.test(normal), normal.replace(/\n/g, " / "));
const hung = run({ HANG_WORKERS: "1" });
check("işçiler cevap vermiyor: alıcı kör kalmıyor, dosya yine teslim", /teslim: evet · dosya aynı: true · JS hataları: yok/.test(hung), hung.replace(/\n/g, " / "));
// İlk kare 8 saniye beklenir; teslim ondan sonra, eski tek iş parçacıklı yolla gelir.
check("işçiler cevap vermiyor: bekleme süresi dolduktan sonra teslim", seconds(hung) >= 8 && seconds(hung) < 60, `${seconds(hung)} s (işçilerle ${seconds(normal)} s)`);
console.log(`\n${pass} geçti, ${fail} kaldı`);
process.exit(fail ? 1 : 0);
