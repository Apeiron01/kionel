import { initializeSiteShell } from "./site-shell.ts";
import { LOCAL_STORAGE_INVENTORY, POLICY_UPDATED, POLICY_VERSION } from "./policy.ts";

initializeSiteShell();

const version = document.querySelector<HTMLElement>("[data-policy-version]");
const updated = document.querySelector<HTMLTimeElement>("[data-policy-updated]");
if (version) version.textContent = POLICY_VERSION;
if (updated) {
  updated.dateTime = POLICY_UPDATED;
  updated.textContent = new Intl.DateTimeFormat("tr-TR", { dateStyle: "long", timeZone: "UTC" })
    .format(new Date(`${POLICY_UPDATED}T12:00:00Z`));
}


const inventory = document.querySelector<HTMLTableSectionElement>("[data-storage-inventory]");
for (const record of LOCAL_STORAGE_INVENTORY) {
  const row = document.createElement("tr");
  for (const value of [record.technology, record.key, record.purpose, record.lifetime, record.required ? "Zorunlu" : "İsteğe bağlı mod"]) {
    const cell = document.createElement("td");
    cell.textContent = value;
    row.append(cell);
  }
  inventory?.append(row);
}

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-copy-section]"))) {
  button.addEventListener("click", async () => {
    const section = button.closest("section[id]") as HTMLElement | null;
    if (!section) return;
    const url = new URL(location.href);
    url.hash = section.id;
    try {
      await navigator.clipboard.writeText(url.href);
      button.textContent = "Bağlantı kopyalandı";
      setTimeout(() => { button.textContent = "Bölüm bağlantısını kopyala" }, 1800);
    } catch {
      location.hash = section.id;
      button.textContent = "Adres çubuğundan kopyalayın";
    }
  });
}
