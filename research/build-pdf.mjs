// preprint.md → preprint.html → preprint.pdf (başsız Chrome). Yalnız ön baskının kullandığı
// Markdown: başlıklar, paragraflar, listeler, tablolar, kalın, italik, satır içi kod, bağlantılar.
// Kullanım: node research/build-pdf.mjs
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(here, "preprint.md"), "utf8");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s)
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  .replace(/\*([^*]+)\*/g, "<em>$1</em>")
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');

const out = [];
const lines = md.split(/\r?\n/);
for (let i = 0; i < lines.length;) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  const h = /^(#{1,3}) (.*)$/.exec(line);
  if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
  if (line.startsWith("|")) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
    const cells = (r) => r.slice(1, -1).split("|").map((c) => c.trim());
    out.push("<table><thead><tr>" + cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
      rows.slice(2).map((r) => "<tr>" + cells(r).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
    continue;
  }
  const list = /^(\s*)(-|\d+\.) /.exec(line);
  if (list) {
    const ordered = /\d/.test(list[2]);
    const items = [];
    while (i < lines.length && /^(\s*)(-|\d+\.) /.test(lines[i])) {
      let item = lines[i++].replace(/^(\s*)(-|\d+\.) /, "");
      while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^(\s*)(-|\d+\.) /.test(lines[i])) item += " " + lines[i++].trim();
      items.push(`<li>${inline(item)}</li>`);
    }
    out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
    continue;
  }
  const para = [];
  while (i < lines.length && lines[i].trim() && !/^(#|\||\s*(-|\d+\.) )/.test(lines[i])) para.push(lines[i++].trim());
  out.push(`<p>${inline(para.join(" "))}</p>`);
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Verifiable one-way file transfer across air gaps</title>
<style>
@page { size: A4; margin: 20mm 18mm; }
body { font: 10.5pt/1.5 Georgia, "Times New Roman", serif; color: #111; max-width: 170mm; margin: 0 auto; }
h1 { font-size: 17pt; line-height: 1.25; margin: 0 0 6pt; }
h2 { font-size: 12.5pt; margin: 16pt 0 6pt; }
p, li { text-align: justify; hyphens: auto; }
table { border-collapse: collapse; margin: 8pt 0; font-size: 8.5pt; width: 100%; page-break-inside: avoid; }
th, td { border-bottom: 0.5pt solid #999; padding: 2pt 4pt; text-align: left; }
th { border-bottom: 1pt solid #111; }
code { font: 9pt Consolas, monospace; }
a { color: #111; }
</style></head><body>${out.join("\n")}</body></html>`;
writeFileSync(join(here, "preprint.html"), html);

// Chrome'la PDF
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe",
  ["--headless=new", "--no-first-run", `--user-data-dir=${join(here, ".chrome-pdf")}`, "--no-pdf-header-footer",
    `--print-to-pdf=${join(here, "preprint.pdf")}`, pathToFileURL(join(here, "preprint.html")).href], { stdio: "ignore" });
// Tarayıcı profili her çalıştırmada ~100 MB bırakıyordu; iş bitince silinir.
chrome.on("exit", () => { try { rmSync(join(here, ".chrome-pdf"), { recursive: true, force: true }); } catch { /* bir sonraki çalıştırma siler */ } });
chrome.on("exit", (code) => console.log(code === 0 ? "research/preprint.pdf yazıldı" : `Chrome çıkış kodu ${code}`));
