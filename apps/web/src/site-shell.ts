/**
 * Shared progressive-enhancement shell for Kionel public pages.
 *
 * Implements the scroll choreography from design/kionel/Motion.dc.html in the
 * fixed order: smooth scroll -> text reveal -> staggered content -> pinned
 * scrollytelling -> interactive hover -> pointer-reactive depth.
 *
 * One requestAnimationFrame driver runs the continuous work (pointer damping,
 * scroll progress, pin progress, magnetics) and parks itself when nothing is
 * moving. Scattered per-event frames were what made the page feel stepped:
 * values landed instantly on their target instead of travelling to it.
 */

const EASE_SETTLED = 0.08; // below this the loop parks rather than chasing sub-pixels

interface Damped {
  current: number;
  target: number;
}

const damped = (value: number): Damped => ({ current: value, target: value });

/** Critically-damped-ish approach. Frame-rate corrected so 120Hz matches 60Hz. */
function approach(value: Damped, rate: number, deltaMs: number): boolean {
  const factor = 1 - Math.pow(1 - rate, deltaMs / 16.667);
  const distance = value.target - value.current;
  if (Math.abs(distance) < 0.01) {
    value.current = value.target;
    return false;
  }
  value.current += distance * factor;
  return true;
}

export function initializeSiteShell(): void {
  const root = document.documentElement;
  root.classList.add("site-js");

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const pointerFine = matchMedia("(pointer: fine)");
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  const progress = document.querySelector<HTMLElement>("[data-scroll-progress]");
  const menuButton = document.querySelector<HTMLButtonElement>("[data-menu-toggle]");
  const menu = document.querySelector<HTMLElement>("[data-site-menu]");

  // -- navigation ------------------------------------------------------------

  const closeMenu = (): void => {
    if (!menuButton || !menu) return;
    menuButton.setAttribute("aria-expanded", "false");
    menu.dataset.open = "false";
  };
  menuButton?.addEventListener("click", () => {
    if (!menu) return;
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    menu.dataset.open = String(open);
  });
  menu?.addEventListener("click", (event) => {
    if ((event.target as Element).closest("a")) closeMenu();
  });
  addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu() });

  // -- 02 text reveal: wrap each masked element's content in a moving line ----
  // The mask needs a child to slide inside the clipped box. Doing it here keeps
  // the markup semantic and leaves the no-JS page unchanged.

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-mask]"))) {
    if (element.firstElementChild && element.children.length === 1) continue;
    const line = document.createElement("span");
    while (element.firstChild) line.appendChild(element.firstChild);
    element.appendChild(line);
  }

  // -- 02 + 03 reveal and stagger --------------------------------------------

  const revealItems = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal], [data-mask]"));

  if (reduceMotion.matches || !("IntersectionObserver" in globalThis)) {
    for (const item of revealItems) item.dataset.visible = "true";
  } else {
    // Stagger is per group, capped at five, so a long list arrives as one block
    // instead of trickling in for two seconds.
    for (const group of Array.from(document.querySelectorAll<HTMLElement>("[data-stagger]"))) {
      const children = Array.from(group.children) as HTMLElement[];
      children.forEach((child, index) => {
        if (!child.hasAttribute("data-reveal") && !child.hasAttribute("data-mask")) {
          child.setAttribute("data-reveal", "");
          revealItems.push(child);
        }
        child.style.setProperty("--reveal-delay", `${Math.min(index, 4) * 80}ms`);
      });
    }

    const observer = new IntersectionObserver((entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        (entry.target as HTMLElement).dataset.visible = "true";
        self.unobserve(entry.target); // animates in once; scrolling back does not replay
      }
    }, { rootMargin: "0px 0px -8%", threshold: 0.12 });

    for (const item of revealItems) observer.observe(item);

    // Failsafe. An element that opts into the reveal is invisible until the
    // observer says otherwise, so anything that never intersects — a zero-height
    // ancestor, a print stylesheet, a deep-link landing mid-document, a browser
    // that shipped a broken observer — would stay blank forever. Text hidden by
    // decoration is worse than text that arrives without it: after this window
    // everything still waiting is simply shown.
    const failsafe = setTimeout(() => {
      for (const item of revealItems) item.dataset.visible = "true";
      observer.disconnect();
    }, 2500);
    addEventListener("beforeunload", () => clearTimeout(failsafe), { once: true });
  }

  // -- 05 section link highlighting ------------------------------------------

  const navigation = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-section-link]"));
  const sections = navigation
    .map((link) => document.querySelector<HTMLElement>(link.hash))
    .filter((section): section is HTMLElement => !!section);
  if (sections.length && "IntersectionObserver" in globalThis) {
    const activeObserver = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (!visible) return;
      for (const link of navigation) {
        if (link.hash === `#${visible.target.id}`) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    }, { rootMargin: "-25% 0px -60%", threshold: [0.05, 0.25, 0.6] });
    for (const section of sections) activeObserver.observe(section);
  }

  // -- continuous layer ------------------------------------------------------

  const pins = Array.from(document.querySelectorAll<HTMLElement>("[data-pin]"));
  const magnets = Array.from(document.querySelectorAll<HTMLElement>("[data-magnetic]"));
  const usePointer = !reduceMotion.matches && pointerFine.matches;

  const pointerX = damped(innerWidth * 0.7);
  const pointerY = damped(innerHeight * 0.22);
  const pointerActive = damped(0);
  const scroll = damped(0);

  let running = 0;
  let previous = 0;

  const readScroll = (): void => {
    const scrollable = document.documentElement.scrollHeight - innerHeight;
    scroll.target = scrollable > 0 ? Math.min(1, Math.max(0, scrollY / scrollable)) : 0;
    header?.classList.toggle("scrolled", scrollY > 16);
  };

  const writePins = (): void => {
    for (const pin of pins) {
      const box = pin.getBoundingClientRect();
      const span = box.height - innerHeight;
      const ratio = span > 0 ? Math.min(1, Math.max(0, -box.top / span)) : 0;
      pin.style.setProperty("--pin-progress", ratio.toFixed(4));
    }
  };

  const tick = (now: number): void => {
    const delta = previous ? Math.min(now - previous, 64) : 16.667;
    previous = now;

    // Pointer trails the cursor; scroll settles into place. Both are the
    // difference between "responsive" and "smooth".
    let moving = approach(scroll, 0.18, delta);
    if (usePointer) {
      moving = approach(pointerX, 0.12, delta) || moving;
      moving = approach(pointerY, 0.12, delta) || moving;
      moving = approach(pointerActive, 0.09, delta) || moving;
      root.style.setProperty("--pointer-x", `${pointerX.current.toFixed(1)}px`);
      root.style.setProperty("--pointer-y", `${pointerY.current.toFixed(1)}px`);
      root.style.setProperty("--pointer-active", pointerActive.current.toFixed(3));
    }

    progress?.style.setProperty("--scroll-progress", scroll.current.toFixed(4));
    if (pins.length) writePins();

    // Park when settled. A rAF loop that never stops is a battery bug.
    running = moving || Math.abs(scroll.target - scroll.current) > EASE_SETTLED / 100
      ? requestAnimationFrame(tick)
      : 0;
    if (!running) previous = 0;
  };

  const wake = (): void => {
    if (!running) running = requestAnimationFrame(tick);
  };

  addEventListener("scroll", () => { readScroll(); wake() }, { passive: true });
  addEventListener("resize", () => { readScroll(); wake() }, { passive: true });
  readScroll();
  wake();

  if (usePointer) {
    addEventListener("pointermove", (event) => {
      pointerX.target = event.clientX;
      pointerY.target = event.clientY;
      pointerActive.target = 1;
      wake();
    }, { passive: true });
    addEventListener("pointerleave", () => { pointerActive.target = 0; wake() }, { passive: true });

    // -- 05 magnetic hover ---------------------------------------------------
    // Pull is capped and released through the CSS transition, so leaving the
    // field glides back instead of snapping.
    for (const magnet of magnets) {
      const strength = Number(magnet.dataset.magnetic) || 6;
      magnet.addEventListener("pointermove", (event) => {
        const box = magnet.getBoundingClientRect();
        const dx = (event.clientX - (box.left + box.width / 2)) / (box.width / 2);
        const dy = (event.clientY - (box.top + box.height / 2)) / (box.height / 2);
        magnet.dataset.magnetActive = "true";
        magnet.style.setProperty("--mag-x", (dx * strength).toFixed(2));
        magnet.style.setProperty("--mag-y", (dy * strength).toFixed(2));
      }, { passive: true });
      magnet.addEventListener("pointerleave", () => {
        magnet.dataset.magnetActive = "false";
        magnet.style.setProperty("--mag-x", "0");
        magnet.style.setProperty("--mag-y", "0");
      }, { passive: true });
    }
  }
}
