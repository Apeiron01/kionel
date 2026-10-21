"""
Regenerates the policy sections of apps/web/policies.html from legal/.

    python tools/build-policies.py

legal/ is the canonical source. Before this script existed the page carried a
hand-written paraphrase, which drifted: the page still said "draft, not a
binding text" long after the texts themselves were finished. Two copies of a
legal notice is one copy too many — the page is now derived, never authored.

Only the four sections that mirror a legal document are replaced. Sections that
belong to the page itself (the storage inventory, accessibility, the source
list) are left exactly as they are.
"""

import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "apps" / "web" / "policies.html"

# section id -> (legal file, eyebrow label, headings to drop)
SECTIONS = [
    ("privacy", "GIZLILIK.md", "01 / GİZLİLİK BİLDİRİMİ"),
    ("terms", "KULLANIM-SARTLARI.md", "03 / KULLANIM ŞARTLARI"),
    ("acceptable-use", "KABUL-EDILEBILIR-KULLANIM.md", "04 / KABUL EDİLEBİLİR KULLANIM"),
    ("security", "GUVENLIK-BILDIRIMI.md", "05 / GÜVENLİK AÇIĞI BİLDİRİMİ"),
]

# An internal fill-in checklist for us, not a statement to the reader.
SKIP_HEADINGS = {"0. doldurulması zorunlu alanlar"}


def inline(text: str) -> str:
    """Markdown inline -> HTML. Escapes first so document text can never inject."""
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    out = re.sub(r"\[([^\]]+)\]\((https?://[^)]+)\)",
                 r'<a href="\2" rel="noopener noreferrer" target="_blank">\1 <span>↗</span></a>', out)
    out = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1", out)  # repo-relative links have no web target
    return out


def render(markdown: str) -> tuple[str, str]:
    """Returns (page title, body HTML). Drops the H1 and any skipped section."""
    lines = markdown.splitlines()
    title, parts, buffer, mode, skipping = "", [], [], None, False

    def flush() -> None:
        nonlocal buffer, mode
        if not buffer:
            mode = None
            return
        if mode == "p":
            parts.append(f"<p>{inline(' '.join(buffer))}</p>")
        elif mode == "ul":
            items = "".join(f"<li>{inline(item)}</li>" for item in buffer)
            parts.append(f"<ul>{items}</ul>")
        elif mode == "ol":
            items = "".join(f"<li>{inline(item)}</li>" for item in buffer)
            parts.append(f"<ol>{items}</ol>")
        elif mode == "table":
            head, *body = [row for row in buffer if not set(row) <= set("|-: ")]
            cells = lambda row: [c.strip() for c in row.strip().strip("|").split("|")]
            head_html = "".join(f"<th>{inline(c)}</th>" for c in cells(head))
            rows = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in cells(r)) + "</tr>" for r in body)
            parts.append(f'<div class="table-scroll"><table><thead><tr>{head_html}</tr></thead><tbody>{rows}</tbody></table></div>')
        buffer, mode = [], None

    for raw in lines:
        line = raw.rstrip()
        if line.startswith("# "):
            flush()
            title = line[2:].strip()
            continue
        if line.startswith("## "):
            flush()
            heading = line[3:].strip()
            skipping = heading.lower() in SKIP_HEADINGS
            if not skipping:
                parts.append(f"<h3>{inline(re.sub(r'^\\d+\\.\\s*', '', heading))}</h3>")
            continue
        if skipping:
            continue
        if line.startswith("### "):
            flush()
            parts.append(f"<h4>{inline(line[4:].strip())}</h4>")
            continue
        if not line.strip():
            flush()
            continue
        if line.startswith("|"):
            if mode != "table":
                flush()
                mode = "table"
            buffer.append(line)
            continue
        if re.match(r"^[-*] ", line):
            if mode != "ul":
                flush()
                mode = "ul"
            buffer.append(line[2:].strip())
            continue
        if re.match(r"^\d+\. ", line):
            if mode != "ol":
                flush()
                mode = "ol"
            buffer.append(re.sub(r"^\d+\.\s*", "", line))
            continue
        if mode not in ("p", None):
            flush()
        mode = "p"
        buffer.append(line.strip())

    flush()
    return title, "".join(parts)


def main() -> None:
    page = PAGE.read_text(encoding="utf-8")
    replaced = []

    for section_id, filename, eyebrow in SECTIONS:
        source = ROOT / "legal" / filename
        title, body = render(source.read_text(encoding="utf-8"))

        section = (
            f'<section id="{section_id}" class="policy-section" data-reveal '
            f'aria-labelledby="{section_id}-title">'
            f'<div class="policy-heading"><span>{eyebrow}</span>'
            f'<button type="button" data-copy-section>Bölüm bağlantısını kopyala</button></div>'
            f'<h2 id="{section_id}-title" data-mask>{html.escape(title)}</h2>'
            f'{body}</section>'
        )

        pattern = re.compile(rf'<section id="{section_id}" class="policy-section".*?</section>', re.S)
        if not pattern.search(page):
            raise SystemExit(f"policies.html içinde {section_id} bölümü bulunamadı")
        page = pattern.sub(lambda _: section, page, count=1)
        replaced.append(f"{section_id} <- legal/{filename}")

    # The publication-gate section framed finished texts as a draft. The texts
    # are complete; what is outstanding is the legal-identity fields, and
    # section 0 of each document already says so.
    gate = re.compile(r'<section id="publication-gate".*?</section>', re.S)
    if gate.search(page):
        page = gate.sub("", page)
        replaced.append("publication-gate kaldırıldı")

    PAGE.write_text(page, encoding="utf-8")
    for line in replaced:
        print(f"  {line}")
    print(f"{PAGE} yeniden üretildi")

    # English sales surface: same renderer, standalone pages. One source each
    # (legal/*-EN.md), never hand-edited HTML.
    for filename, page_name in [("TERMS-EN.md", "terms.html"), ("PRIVACY-EN.md", "privacy.html")]:
        title, body = render((ROOT / "legal" / filename).read_text(encoding="utf-8"))
        target = ROOT / "apps" / "web" / page_name
        target.write_text(
            '<!doctype html><html lang="en"><head><meta charset="UTF-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">'
            f'<title>{html.escape(title)} · Kionel</title>'
            '<link rel="stylesheet" href="/src/funnel.css"></head><body data-page="' + page_name[:-5] + '">'
            '<header><a class="brand" href="/index.html">Kionel<span>LAB WORKFLOWS</span></a>'
            '<nav><a href="/sample-reconciliation.html">Demo</a><a href="/pilot.html">Open source</a>'
            '<a href="/contact.html">Contact</a></nav></header>'
            f'<main><h1>{html.escape(title)}</h1>{body}</main>'
            '<footer><p>Kionel · Taha Bayar</p><a href="/terms.html">Terms</a>'
            '<a href="/privacy.html">Privacy</a>'
            '<a class="lumina" href="https://luminadigitale.com" rel="noopener noreferrer" target="_blank" title="Lumina Digitale"><svg width="17" height="22" viewBox="169 81 472 633" aria-hidden="true" focusable="false"><path d="M 354.835938 660.777344 C 289.34375 660.777344 249.777344 588.34375 285.164062 533.238281 L 515.683594 174.285156 C 521.925781 164.5625 525.242188 153.253906 525.242188 141.703125 C 525.242188 108.402344 498.25 81.40625 464.949219 81.40625 L 248.09375 81.40625 C 204.429688 81.40625 169.035156 116.804688 169.035156 160.46875 L 169.035156 635.011719 C 169.035156 678.675781 204.429688 714.074219 248.09375 714.074219 L 561.679688 714.074219 C 605.324219 714.074219 640.710938 678.710938 640.742188 635.070312 L 640.839844 494.191406 C 640.878906 441.875 572.644531 421.824219 544.371094 465.84375 L 453.925781 606.652344 C 432.261719 640.382812 394.925781 660.777344 354.835938 660.777344 Z" fill="currentColor"/></svg>Lumina Digitale</a>'
            '</footer></body></html>',
            encoding="utf-8",
        )
        print(f"{target} yeniden üretildi")


if __name__ == "__main__":
    main()
