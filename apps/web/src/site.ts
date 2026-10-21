/**
 * Satış yüzeyinin davranışı: mobil menü, bölüm açılışları ve hareket anahtarı.
 *
 * Ayrı dosya, çünkü funnel.ts satın alma ve numune aracının işini yapıyor;
 * bu üçü her sayfada gerekli ve hiçbirine bağlı değil.
 */

// ---- mobil menü -------------------------------------------------------------
const nav = document.querySelector<HTMLElement>("header nav");
const toggle = document.querySelector<HTMLButtonElement>(".nav-toggle");
toggle?.addEventListener("click", () => {
  const open = nav?.classList.toggle("open") ?? false;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "Close" : "Menu";
});
// Bir bağlantıya basınca menü kapanmalı; açık kalırsa hedef sayfanın üstünü örter.
nav?.addEventListener("click", (event) => {
  if ((event.target as HTMLElement).tagName === "A" && nav.classList.contains("open")) {
    nav.classList.remove("open");
    toggle?.setAttribute("aria-expanded", "false");
    if (toggle) toggle.textContent = "Menu";
  }
});

// ---- bölüm açılışları -------------------------------------------------------
/**
 * Sayfa kaydıkça bölümler yerine oturur. IntersectionObserver kullanılıyor:
 * scroll olayında hesap yapmak her karede iş demekti ve kaydırmayı takıldırırdı.
 */
const revealable = document.querySelectorAll<HTMLElement>("main > h2, main > .cards, main > .preview, main > .fit, main > .plans, main > .steps-flow, main > .table-scroll");
if (revealable.length && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  // tsconfig lib'inde dom.iterable yok; NodeList doğrudan döngüye girmiyor.
  for (const element of Array.from(revealable)) {
    element.classList.add("reveal");
    observer.observe(element);
  }
}

// ---- hareket anahtarı -------------------------------------------------------
/**
 * İşletim sisteminde animasyon kapalıysa site de kapatır. Ama bazı kullanıcı
 * bunu bilmeden kapatmış oluyor (Windows'ta "görsel efektler" kapalıysa) ve
 * ürünün çalışma mantığını anlatan diyagramı hiç görmüyor. Bu düğme yalnız o
 * durumda çıkar ve tercih bu tarayıcıda hatırlanır.
 */
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
const MOTION_KEY = "kionel.motion";
function applyMotion(on: boolean): void {
  document.documentElement.dataset.motion = on ? "on" : "";
}
if (reduced.matches) {
  let stored: string | null = null;
  try { stored = localStorage.getItem(MOTION_KEY); } catch { /* depolama kapalı olabilir */ }
  applyMotion(stored === "on");
  const button = document.createElement("button");
  button.className = "motion-toggle";
  button.type = "button";
  const label = () => { button.textContent = document.documentElement.dataset.motion === "on" ? "Turn animation off" : "Turn animation on"; };
  label();
  button.addEventListener("click", () => {
    const on = document.documentElement.dataset.motion !== "on";
    applyMotion(on);
    try { localStorage.setItem(MOTION_KEY, on ? "on" : "off"); } catch { /* yoksay */ }
    label();
  });
  document.body.append(button);
}
