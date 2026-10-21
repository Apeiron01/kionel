import { compareSamples } from "@kionel/lab-workflows";
const en = document.documentElement.lang === "en";
const text = (tr: string, english: string) => en ? english : tr;
const expected = document.querySelector<HTMLTextAreaElement>("#expected");
const received = document.querySelector<HTMLTextAreaElement>("#received");
let report: string | undefined;
const download = document.querySelector<HTMLButtonElement>("#download");
const sha = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), b => b.toString(16).padStart(2, "0")).join("");
let revision = 0;
function invalidate() { revision++; report = undefined; if (download) download.disabled = true; }
expected?.addEventListener("input", invalidate); received?.addEventListener("input", invalidate);
document.querySelector("#compare")?.addEventListener("click", async () => {
  const result = document.querySelector<HTMLDivElement>("#comparison-result")!;
  invalidate();
  const current = revision;
  try {
    const a = expected!.value, b = received!.value;
    const comparison = compareSamples(a, b);
    const [expectedHash, receivedHash] = await Promise.all([sha(a), sha(b)]);
    if (revision !== current) return;
    report = JSON.stringify({ ...comparison, generatedAt: new Date().toISOString(),
      expectedTextSha256: expectedHash, receivedTextSha256: receivedHash, signed: false }, null, 2);
    result.replaceChildren();
    const heading = document.createElement("h2");
    heading.textContent = comparison.matches ? text("Listeler eşleşiyor.", "Lists match.") : text("İncelenecek farklar var.", "Differences need review.");
    result.append(heading);
    for (const [label, ids] of [[text("Eksik", "Missing"), comparison.missing], [text("Fazla", "Unexpected"), comparison.unexpected],
      [text("Beklenende tekrar", "Duplicate expected"), comparison.duplicateExpected], [text("Teslimde tekrar", "Duplicate received"), comparison.duplicateReceived]] as const) {
      const p = document.createElement("p"); p.className = "result-block";
      p.textContent = `${label} (${ids.length}): ${ids.slice(0, 100).join(", ") || "—"}${ids.length > 100 ? " …" : ""}`; result.append(p);
    }
    download!.disabled = false;
  } catch (error) { result.textContent = en ? "Check both lists: one ID per line, no surrounding spaces, maximum 10,000 IDs and 128 characters per ID." : error instanceof Error ? error.message : "Karşılaştırma tamamlanamadı."; }
});
document.querySelector("#example")?.addEventListener("click", () => { expected!.value = "LAB-001\nLAB-002\nLAB-003"; received!.value = "LAB-001\nLAB-003\nLAB-003\nLAB-004"; invalidate(); });
document.querySelector("#clear")?.addEventListener("click", () => { expected!.value = ""; received!.value = ""; invalidate(); document.querySelector("#comparison-result")!.replaceChildren(); });
download?.addEventListener("click", () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([report], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "kionel-sample-comparison.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

// ---- iletişim formu --------------------------------------------------------
// Adres sitede yazmıyor; mesaj sunucuya gidiyor ve işletmeci kendi kutusundan
// cevap veriyor. Gönderim sırasında düğme kilitleniyor: iki kez tıklamak iki
// mesaj demek olurdu ve hız sınırını kullanıcının kendi aleyhine harcardı.
const contactForm = document.querySelector<HTMLFormElement>("#contact-form");
contactForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector<HTMLParagraphElement>("#contact-status")!;
  const submit = document.querySelector<HTMLButtonElement>("#contact-submit")!;
  // tsconfig lib'inde dom.iterable yok; FormData.entries() tip olarak görünmüyor.
  const data = new FormData(contactForm);
  const fields = { name: "", email: "", organisation: "", message: "", website: "" };
  // İki nitelik sorusu mesajın başına yazılır: ayrı sütun açmak yerine gelen
  // e-postada okunur durur ve veritabanı şeması değişmez.
  const context = ["workflow", "current"]
    .map((key) => [key === "workflow" ? "Moving" : "Today", String(data.get(key) ?? "").trim()])
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
    fields[key] = String(data.get(key) ?? "");
  }
  if (context.length) fields.message = `${context.join("\n")}\n\n${fields.message}`;

  submit.disabled = true;
  status.textContent = text("Gönderiliyor…", "Sending…");
  try {
    const response = await fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error ?? text("Mesaj gönderilemedi.", "The message could not be sent."));
    contactForm.reset();
    status.textContent = text("Mesajınız alındı. E-posta ile dönüş yapılacak.", "Message received. We will reply by email.");
  } catch (error) {
    // Başarısızlıkta düğme geri açılır: kullanıcı yazdığını kaybetmemeli.
    status.textContent = error instanceof Error ? error.message : text("Mesaj gönderilemedi.", "The message could not be sent.");
    submit.disabled = false;
  }
});
