import {
  CONTROL_PLANE_API_VERSION,
  CONTROL_PLANE_ENDPOINTS,
  PRODUCT_PHASES,
  controlPlaneOpenApi,
  phaseProgress,
  roadmapSummary,
  type EvidenceStatus,
  type PhaseStatus,
  type ProductPhase,
} from "@kionel/control-plane";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATUS_LABELS: Record<PhaseStatus, string> = {
  complete: "Tamamlandı",
  active: "Aktif",
  planned: "Planlandı",
  "external-evidence": "Dış kanıt gerekli",
};

const EVIDENCE_LABELS: Record<EvidenceStatus, string> = {
  verified: "Doğrulandı",
  pending: "Bekliyor",
  external: "Dış kanıt",
};

let activeFilter = "all";
renderSummary();
renderPhases();
renderApi();

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-filter]"))) {
  button.addEventListener("click", () => {
    activeFilter = button.dataset.filter ?? "all";
    for (const candidate of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-filter]"))) {
      candidate.classList.toggle("active", candidate === button);
    }
    renderPhases();
  });
}

function renderSummary(): void {
  const summary = roadmapSummary();
  const values: readonly [string, string][] = [
    [String(PRODUCT_PHASES.length), "Toplam faz"],
    [String(summary.complete), "Tamamlanan"],
    [String(summary.active), "Aktif"],
    [`${summary.verifiedEvidence}/${summary.totalEvidence}`, "Doğrulanan kanıt"],
  ];
  $("roadmap-summary").replaceChildren(...values.map(([value, label]) => {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = value;
    item.append(detail, term);
    return item;
  }));
}

function renderPhases(): void {
  const phases = PRODUCT_PHASES.filter((phase) => {
    if (activeFilter === "all") return true;
    if (activeFilter === "open") return phase.status !== "complete";
    return phase.status === activeFilter;
  });
  $("phase-list").replaceChildren(...phases.map(phaseCard));
}

function phaseCard(phase: ProductPhase): HTMLElement {
  const article = document.createElement("article");
  article.className = `phase-card status-${phase.status}`;

  const rail = document.createElement("div");
  rail.className = "phase-rail";
  const number = document.createElement("span");
  number.textContent = String(phase.order).padStart(2, "0");
  rail.append(number);

  const body = document.createElement("div");
  body.className = "phase-body";
  const meta = document.createElement("div");
  meta.className = "phase-meta";
  const horizon = document.createElement("span");
  horizon.textContent = phase.horizon;
  const status = document.createElement("span");
  status.className = `status-pill ${phase.status}`;
  status.textContent = STATUS_LABELS[phase.status];
  meta.append(horizon, status);

  const title = document.createElement("h3");
  title.textContent = phase.title;
  const outcome = document.createElement("p");
  outcome.textContent = phase.outcome;

  const progress = document.createElement("div");
  progress.className = "phase-progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", `${phase.title} kanıt ilerlemesi`);
  progress.setAttribute("aria-valuenow", String(phaseProgress(phase)));
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  const fill = document.createElement("i");
  fill.style.width = `${phaseProgress(phase)}%`;
  progress.append(fill);

  const evidence = document.createElement("ul");
  evidence.className = "evidence-list";
  for (const item of phase.evidence) {
    const line = document.createElement("li");
    line.className = `evidence-${item.status}`;
    const mark = document.createElement("span");
    mark.textContent = item.status === "verified" ? "✓" : item.status === "external" ? "↗" : "·";
    const label = document.createElement("span");
    label.textContent = item.label;
    const state = document.createElement("small");
    state.textContent = EVIDENCE_LABELS[item.status];
    line.append(mark, label, state);
    evidence.append(line);
  }
  body.append(meta, title, outcome, progress, evidence);
  article.append(rail, body);
  return article;
}

function renderApi(): void {
  const methods = { GET: "read", POST: "write", PATCH: "write" } as const;
  $("api-list").replaceChildren(...CONTROL_PLANE_ENDPOINTS.map((api) => {
    const row = document.createElement("article");
    row.className = "api-row";
    const method = document.createElement("span");
    method.className = `api-method ${methods[api.method]}`;
    method.textContent = api.method;
    const content = document.createElement("div");
    const path = document.createElement("code");
    path.textContent = api.path;
    const summary = document.createElement("p");
    summary.textContent = api.summary;
    content.append(path, summary);
    const controls = document.createElement("div");
    controls.className = "api-controls";
    if (api.mutating) controls.append(badge("MFA", "mfa"));
    if (api.idempotencyRequired) controls.append(badge("idempotent", "idempotency"));
    if (api.twoPersonApproval) controls.append(badge("2 kişi", "approval"));
    controls.append(badge("metadata", "safe"));
    row.append(method, content, controls);
    return row;
  }));

  const specification = JSON.stringify(controlPlaneOpenApi(), null, 2);
  $("openapi-download").setAttribute("href", URL.createObjectURL(new Blob([specification], { type: "application/json" })));
  $("contract-version").textContent = `API sözleşmesi ${CONTROL_PLANE_API_VERSION}`;
}

function badge(label: string, className: string): HTMLElement {
  const value = document.createElement("span");
  value.className = `api-badge ${className}`;
  value.textContent = label;
  return value;
}
