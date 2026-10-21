"""Sosyal önizleme görselini (og:image) üretir.

    python tools/make-og-image.py

1200x630, satış yüzeyiyle aynı palet ve aynı cümle. Kart ile sayfa birbirini
tutmazsa bağlantıyı paylaşan kişi iki farklı ürün görmüş olur.

Yazı tipi olarak Windows'un Segoe UI ve Consolas'ı kullanılır: IBM Plex ttf
olarak sistemde yok ve tek bir kart için font indirmek gereksiz — biçim
yakınlığı bu boyutta yeterli.

Çıktı: apps/web/public/og.png
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps/web/public/og.png"

W, H = 1200, 630
BG = (7, 19, 22)
SURFACE = (15, 32, 37)
BORDER = (36, 59, 66)
BORDER_STRONG = (61, 98, 107)
TEXT = (241, 247, 246)
MUTED = (169, 190, 192)
FAINT = (125, 151, 155)
ACCENT = (109, 227, 194)

FONTS = Path("C:/Windows/Fonts")
title = ImageFont.truetype(str(FONTS / "seguisb.ttf"), 62)
body = ImageFont.truetype(str(FONTS / "segoeui.ttf"), 27)
mono = ImageFont.truetype(str(FONTS / "consola.ttf"), 19)
mono_small = ImageFont.truetype(str(FONTS / "consola.ttf"), 16)

image = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(image)

# Mühendislik ızgarası — sayfadakiyle aynı, aynı sessizlikte.
for x in range(0, W, 48):
    draw.line([(x, 0), (x, H)], fill=(11, 26, 30))
for y in range(0, H, 48):
    draw.line([(0, y), (W, y)], fill=(11, 26, 30))

M = 72  # kenar boşluğu

# Marka işareti: iki yüzey, aralarından geçen optik kareler.
draw.rounded_rectangle([M, 56, M + 14, 104], radius=4, outline=ACCENT, width=3)
draw.rounded_rectangle([M + 62, 56, M + 76, 104], radius=4, outline=ACCENT, width=3)
for i, alpha in enumerate((90, 160, 230)):
    x = M + 22 + i * 14
    draw.rectangle([x, 70, x + 9, 79], fill=(int(ACCENT[0] * alpha / 255), int(ACCENT[1] * alpha / 255), int(ACCENT[2] * alpha / 255)))
    draw.rectangle([x, 84, x + 9, 93], fill=(int(ACCENT[0] * (255 - alpha) / 255), int(ACCENT[1] * (255 - alpha) / 255), int(ACCENT[2] * (255 - alpha) / 255)))
draw.text((M + 96, 58), "KIONEL", font=ImageFont.truetype(str(FONTS / "seguisb.ttf"), 30), fill=TEXT)
draw.text((M + 97, 92), "LAB WORKFLOWS", font=mono_small, fill=FAINT)

draw.text((M, 176), "Verifiable file handover", font=title, fill=TEXT)
draw.text((M, 244), "for isolated lab systems.", font=title, fill=TEXT)
draw.text((M, 340), "Screen to camera. No network, no USB stick.", font=body, fill=MUTED)
draw.text((M, 378), "Two signed receipts, verifiable offline years later.", font=body, fill=MUTED)

# Alt şerit: sayfadaki güven şeridinin aynısı.
draw.line([(M, 470), (W - M, 470)], fill=BORDER)
strip = ["NO NETWORK REQUIRED", "ON-DEVICE FILE CONTENT", "TWO SIGNED RECEIPTS", "OFFLINE VERIFICATION"]
x = M
for label in strip:
    draw.ellipse([x, 505, x + 7, 512], fill=ACCENT)
    draw.text((x + 16, 498), label, font=mono_small, fill=FAINT)
    x += int(draw.textlength(label, font=mono_small)) + 52

draw.text((M, 556), "kionel.com", font=mono, fill=ACCENT)

# Sağ alt: makbuzun kendisi, süs değil.
panel = [W - M - 330, 176, W - M, 430]
draw.rounded_rectangle(panel, radius=12, fill=SURFACE, outline=BORDER_STRONG)
draw.text((panel[0] + 24, panel[1] + 22), "DELIVERY RECEIPT", font=mono_small, fill=FAINT)
rows = [("content hash", "match"), ("dispatch signature", "valid"), ("delivery signature", "valid"), ("needs Kionel", "no")]
y = panel[1] + 68
for label, value in rows:
    draw.text((panel[0] + 24, y), label, font=mono_small, fill=MUTED)
    draw.text((panel[0] + 214, y), value, font=mono_small, fill=ACCENT if value in ("match", "valid") else FAINT)
    y += 38

OUT.parent.mkdir(parents=True, exist_ok=True)
image.save(OUT, optimize=True)
print(f"{OUT} yazıldı ({OUT.stat().st_size // 1024} KB)")
