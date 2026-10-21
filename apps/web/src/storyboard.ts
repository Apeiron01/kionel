/**
 * Hikâye şeridi: bir aktarımın aşamaları, simgeleriyle, sırayla yanar.
 *
 * İnsanlar metinden çok animasyondan anlıyor; aynı bileşen uygulamada seçime göre
 * kendini yeniden kurar, sitede sabit akışları gösterir. Zamanlama CSS
 * değişkenleriyle verilir (CSSOM, satır içi stil değil): sitenin CSP'si satır içi
 * stili engeller ve engellemesi doğrudur.
 */
import "./storyboard.css";

export type Icon =
  | "phone-code" | "keyboard" | "pc-qr" | "pc-colour" | "phone-live" | "phone-film" | "video-open"
  | "file-check" | "compare" | "seal" | "pc-licence" | "unlock" | "clock" | "card";

export interface Step { icon: Icon; who: "Sender" | "Receiver" | "Both" | "Later"; title: string }

const phone = (inner: string) =>
  `<rect x="15" y="5" width="18" height="38" rx="3"/><line x1="21" y1="39" x2="27" y2="39"/>${inner}`;
const monitor = (inner: string) =>
  `<rect x="5" y="8" width="38" height="26" rx="2"/><line x1="18" y1="40" x2="30" y2="40"/><line x1="24" y1="34" x2="24" y2="40"/>${inner}`;
const qr = `<rect class="f" x="17" y="13" width="5" height="5"/><rect class="f" x="26" y="13" width="5" height="5"/><rect class="f" x="17" y="22" width="5" height="5"/><rect class="f" x="26" y="22" width="3" height="3"/>`;

const ICONS: Record<Icon, string> = {
  "phone-code": phone(`<text x="24" y="25" class="t">7K3Q</text><text x="24" y="31" class="t">M9XD</text>`),
  keyboard: `<rect x="4" y="15" width="40" height="18" rx="2"/><line x1="9" y1="21" x2="39" y2="21"/><line x1="9" y1="27" x2="39" y2="27"/><line x1="16" y1="15" x2="16" y2="33"/><line x1="24" y1="15" x2="24" y2="33"/><line x1="32" y1="15" x2="32" y2="33"/>`,
  "pc-qr": monitor(qr),
  "pc-colour": monitor(`<rect class="c1" x="17" y="13" width="5" height="5"/><rect class="c2" x="26" y="13" width="5" height="5"/><rect class="c3" x="17" y="22" width="5" height="5"/><rect class="c4" x="26" y="22" width="5" height="5"/>`),
  "phone-live": phone(`<circle cx="24" cy="12" r="2"/><rect class="f" x="19" y="18" width="4" height="4"/><rect class="f" x="25" y="18" width="4" height="4"/><rect class="f" x="19" y="24" width="4" height="4"/>`),
  "phone-film": phone(`<circle class="rec" cx="24" cy="12" r="2.5"/><rect x="19" y="18" width="10" height="12" rx="1"/>`),
  "video-open": `<rect x="6" y="11" width="36" height="26" rx="2"/><line x1="6" y1="17" x2="42" y2="17"/><line x1="6" y1="31" x2="42" y2="31"/><path class="f" d="M21 20 L29 24 L21 28 Z"/>`,
  "file-check": `<path d="M12 5 H28 L36 13 V43 H12 Z"/><path d="M28 5 V13 H36"/><path class="ok" d="M17 28 L22 33 L31 22"/>`,
  compare: `<rect x="4" y="12" width="17" height="24" rx="2"/><rect x="27" y="12" width="17" height="24" rx="2"/><line x1="9" y1="22" x2="16" y2="22"/><line x1="32" y1="22" x2="39" y2="22"/><line x1="9" y1="27" x2="16" y2="27"/><line x1="32" y1="27" x2="39" y2="27"/><text x="24" y="28" class="t">=</text>`,
  seal: `<circle cx="24" cy="20" r="11"/><path class="ok" d="M19 20 L23 24 L30 16"/><path d="M17 29 L14 43 L24 38 L34 43 L31 29"/>`,
  "pc-licence": monitor(`<circle cx="20" cy="21" r="4"/><line x1="24" y1="21" x2="32" y2="21"/><line x1="29" y1="21" x2="29" y2="25"/>`),
  unlock: `<rect x="12" y="22" width="24" height="20" rx="2"/><path d="M18 22 V15 A6 6 0 0 1 30 13"/><circle class="f" cx="24" cy="32" r="2"/>`,
  clock: `<circle cx="24" cy="24" r="17"/><line x1="24" y1="24" x2="24" y2="13"/><line x1="24" y1="24" x2="32" y2="28"/>`,
  card: `<rect x="6" y="12" width="36" height="24" rx="3"/><line x1="11" y1="20" x2="26" y2="20"/><line x1="11" y1="26" x2="22" y2="26"/><circle cx="34" cy="26" r="4"/>`,
};

/** Hazır akışlar. Başlıklar kısa: şerit bir bakışta okunmalı. */
export const STORIES: Record<string, Step[]> = {
  "camera-live": [
    { icon: "phone-live", who: "Receiver", title: "Receive: shows a code" },
    { icon: "pc-qr", who: "Sender", title: "Scans it, shows its own" },
    { icon: "compare", who: "Both", title: "Compare the codes" },
    { icon: "pc-qr", who: "Sender", title: "Sends the file as codes" },
    { icon: "file-check", who: "Receiver", title: "File + signed receipt" },
  ],
  "code-live": [
    { icon: "phone-code", who: "Receiver", title: "Show a code" },
    { icon: "keyboard", who: "Sender", title: "Type it, press Send" },
    { icon: "pc-qr", who: "Sender", title: "Shows the file as codes" },
    { icon: "phone-live", who: "Receiver", title: "Reads them live" },
    { icon: "file-check", who: "Receiver", title: "File + signed receipt" },
  ],
  "code-record": [
    { icon: "phone-code", who: "Receiver", title: "Show a code" },
    { icon: "keyboard", who: "Sender", title: "Type it, choose Fast" },
    { icon: "pc-qr", who: "Sender", title: "Counts down while sending" },
    { icon: "phone-film", who: "Receiver", title: "Film until “Enough”" },
    { icon: "video-open", who: "Receiver", title: "Kionel reads the video" },
    { icon: "file-check", who: "Receiver", title: "File + signed receipt" },
  ],
  "code-colour": [
    { icon: "phone-code", who: "Receiver", title: "Show a code" },
    { icon: "keyboard", who: "Sender", title: "Type it, choose Robust" },
    { icon: "pc-colour", who: "Sender", title: "Colour codes, full screen" },
    { icon: "phone-film", who: "Receiver", title: "Film until “Enough”" },
    { icon: "video-open", who: "Receiver", title: "Colour recognised by itself" },
    { icon: "file-check", who: "Receiver", title: "File + signed receipt" },
  ],
  later: [
    { icon: "phone-code", who: "Receiver", title: "Show a code once" },
    { icon: "pc-qr", who: "Sender", title: "Type it and send" },
    { icon: "phone-film", who: "Receiver", title: "Film with the camera app" },
    { icon: "clock", who: "Later", title: "Hours later, any licensed device" },
    { icon: "video-open", who: "Later", title: "Open the video, type the code" },
    { icon: "file-check", who: "Later", title: "File + signed receipt" },
  ],
  card: [
    { icon: "card", who: "Receiver", title: "Create a card once" },
    { icon: "pc-qr", who: "Sender", title: "Load it once on the sender" },
    { icon: "pc-qr", who: "Sender", title: "Send without a code" },
    { icon: "phone-film", who: "Receiver", title: "Read live or film" },
    { icon: "file-check", who: "Receiver", title: "File + signed receipt" },
  ],
  seal: [
    { icon: "keyboard", who: "Sender", title: "Choose file + work order" },
    { icon: "seal", who: "Sender", title: "Seal: the file stays" },
    { icon: "pc-qr", who: "Sender", title: "One small code" },
    { icon: "phone-live", who: "Receiver", title: "Scan it" },
    { icon: "file-check", who: "Receiver", title: "Signed proof, no data" },
  ],
  licence: [
    { icon: "pc-licence", who: "Sender", title: "Show licence as a code" },
    { icon: "phone-live", who: "Receiver", title: "Receive, live camera" },
    { icon: "compare", who: "Receiver", title: "Confirm whose licence" },
    { icon: "unlock", who: "Receiver", title: "Business features on" },
  ],
};

const STEP_MS = 1600;
/** Kendiliğinden tekrarlayan içerik durdurulabilir olmalı (WCAG 2.2.2); birkaç turdan sonra kendisi de durur. */
const AUTO_CYCLES = 4;
const timers = new WeakMap<HTMLElement, number>();

/**
 * Vurgu adım adım JavaScript'le ilerler: her kart kendi süresi boyunca yanık
 * kalır. Hareket azaltma tercihi olan kullanıcıda kayma ve nokta olmaz ama vurgu
 * yine ilerler — yalnız renk değişir, hareket yoktur. Önceki CSS sürümü bu
 * tercihte animasyonu tamamen kapatıyordu ve şerit hiçbir şey anlatmıyordu.
 */
function play(target: HTMLElement, steps: HTMLElement[], button: HTMLButtonElement): void {
  window.clearInterval(timers.get(target));
  let index = -1;
  let ticks = 0;
  const tick = () => {
    if (document.hidden) return;
    steps.forEach((step) => step.classList.remove("on"));
    index = (index + 1) % steps.length;
    steps[index].classList.add("on");
    ticks++;
    if (ticks >= steps.length * AUTO_CYCLES) stop(target, steps, button, true);
  };
  tick();
  timers.set(target, window.setInterval(tick, STEP_MS));
  button.textContent = "Pause";
  button.setAttribute("aria-pressed", "false");
}

function stop(target: HTMLElement, steps: HTMLElement[], button: HTMLButtonElement, finished: boolean): void {
  window.clearInterval(timers.get(target));
  timers.delete(target);
  if (finished) steps.forEach((step) => step.classList.add("on"));
  button.textContent = finished ? "Replay" : "Play";
  button.setAttribute("aria-pressed", "true");
}

export function renderStory(target: HTMLElement, name: keyof typeof STORIES | string): void {
  const steps = STORIES[name];
  if (!steps) return;
  if (target.dataset.rendered === name) return;
  target.dataset.rendered = name;
  target.classList.add("story");
  target.setAttribute("role", "group");
  target.setAttribute("aria-label", steps.map((s, i) => `${i + 1}. ${s.who}: ${s.title}`).join(". "));
  target.style.setProperty("--n", String(steps.length));
  const items = steps.map((step) => {
    const item = document.createElement("div");
    item.className = "st";
    item.setAttribute("aria-hidden", "true");
    item.innerHTML =
      `<span class="st-who">${step.who}</span>` +
      `<svg viewBox="0 0 48 48" aria-hidden="true">${ICONS[step.icon]}</svg>` +
      `<span class="st-title"></span>`;
    item.querySelector(".st-title")!.textContent = step.title;
    return item;
  });
  const button = document.createElement("button");
  button.type = "button";
  button.className = "story-toggle";
  button.onclick = () => (timers.has(target) ? stop(target, items, button, false) : play(target, items, button));
  target.replaceChildren(...items, button);
  play(target, items, button);
}

/** Sayfadaki her [data-story] kabını çizer (site sayfaları için). */
export function renderAllStories(root: ParentNode = document): void {
  for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-story]"))) {
    renderStory(element, element.dataset.story!);
  }
}
