import {
  PRODUCT_OFFERS, createPilotBrief, isSalesNeed, recommendedOffer,
  type BuyerSegment, type DeploymentBoundary, type IdentityTrust, type PilotIntegration, type ProductOffer,
} from "./products.ts";
import { initializeSiteShell } from "./site-shell.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let activeSegment: BuyerSegment | "all" = "all";
let pilotDownloadUrl: string | undefined;

initializeSiteShell();
validateRenderedCatalog();

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-segment]"))) {
  button.addEventListener("click", () => {
    const segment = button.dataset.segment;
    if (segment !== "all" && segment !== "b2b" && segment !== "oem") return;
    activeSegment = segment;
    for (const candidate of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-segment]"))) {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }
    filterProducts();
  });
}

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-need]"))) {
  button.addEventListener("click", () => {
    const need = button.dataset.need;
    if (!isSalesNeed(need)) return;
    for (const candidate of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-need]"))) {
      const active = candidate === button;
      candidate.classList.toggle("active", active);
      candidate.setAttribute("aria-pressed", String(active));
    }
    renderRecommendation(recommendedOffer(need));
    $<HTMLSelectElement>("pilot-need").value = need;
  });
}

$("pilot-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  if (!form.reportValidity()) return;
  const need = $<HTMLSelectElement>("pilot-need").value;
  if (!isSalesNeed(need)) return renderPilotError("Birincil ihtiyaç geçersiz.");
  try {
    const brief = createPilotBrief({
      need,
      sites: boundedInteger($<HTMLInputElement>("pilot-sites"), 1, 1_000),
      devices: boundedInteger($<HTMLInputElement>("pilot-devices"), 2, 100_000),
      deploymentBoundary: $<HTMLSelectElement>("pilot-region").value as DeploymentBoundary,
      identityTrust: $<HTMLSelectElement>("pilot-identity").value as IdentityTrust,
      integration: $<HTMLSelectElement>("pilot-integration").value as PilotIntegration,
    });
    renderPilotResult(recommendedOffer(need), brief);
  } catch (error) {
    renderPilotError(error instanceof Error ? error.message : "Pilot kapsamı üretilemedi.");
  }
});

function validateRenderedCatalog(): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>("[data-product-card]"));
  const expected = new Map<string, BuyerSegment>(PRODUCT_OFFERS.map((product) => [product.id, product.segment]));
  if (cards.length !== expected.size || cards.some((card) => !card.id || card.dataset.segment !== expected.get(card.id))) {
    throw new Error("Kionel ürün kataloğu ile render edilen satış kartları uyuşmuyor");
  }
}

function filterProducts(): void {
  for (const card of Array.from(document.querySelectorAll<HTMLElement>("[data-product-card]"))) {
    card.hidden = activeSegment !== "all" && card.dataset.segment !== activeSegment;
  }
}

function renderRecommendation(product: ProductOffer): void {
  const target = $("recommendation");
  target.replaceChildren();
  const identity = element("span", "recommendation-id", `Kionel / ${product.id.toUpperCase()}`);
  const copy = document.createElement("div");
  const title = document.createElement("strong"); title.textContent = product.name;
  const paragraph = document.createElement("p"); paragraph.textContent = product.promise;
  copy.append(title, paragraph);
  target.append(identity, copy, link(product.primaryCta.label, product.primaryCta.href, "primary"));
}

function renderPilotResult(product: ProductOffer, brief: object): void {
  const target = $("pilot-result");
  target.hidden = false;
  target.replaceChildren();
  const copy = document.createElement("div");
  const kicker = element("span", "section-index", "KAPSAM HAZIR");
  const title = document.createElement("h3"); title.textContent = product.name;
  const detail = document.createElement("p"); detail.textContent = `${product.availabilityLabel}. Bu çıktı fiyat teklifi veya uyum sertifikası değildir; teknik keşif başlangıcıdır.`;
  copy.append(kicker, title, detail);
  const serialized = `${JSON.stringify(brief, null, 2)}\n`;
  if (pilotDownloadUrl) URL.revokeObjectURL(pilotDownloadUrl);
  pilotDownloadUrl = URL.createObjectURL(new Blob([serialized], { type: "application/json" }));
  const download = link("JSON kapsamını indir", pilotDownloadUrl, "primary");
  download.download = `kionel-${product.id}-pilot-brief.json`;
  target.append(copy, download);
  target.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
}

function renderPilotError(message: string): void {
  const target = $("pilot-result");
  target.hidden = false;
  target.replaceChildren(element("p", "pilot-error", message));
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag); value.className = className; value.textContent = text; return value;
}

function link(text: string, href: string, tone: "primary" | "ghost"): HTMLAnchorElement {
  const value = document.createElement("a"); value.className = `site-button ${tone}`; value.href = href; value.textContent = text; return value;
}

function boundedInteger(input: HTMLInputElement, min: number, max: number): number {
  const value = Number(input.value);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${min} ile ${max} arasında tam sayı gerekli`);
  return value;
}

addEventListener("pagehide", () => { if (pilotDownloadUrl) URL.revokeObjectURL(pilotDownloadUrl) }, { once: true });
