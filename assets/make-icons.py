#!/usr/bin/env python3
"""Generates the app icon in every format the installers need, from one drawing.

Run: python3 assets/make-icons.py   (needs Pillow; only the maintainer runs this,
CI consumes the committed output so the build has no Python/Pillow dependency)

Outputs, all committed:
  assets/icon.png            1024x1024, source of truth / store listings
  assets/icon.ico            multi-resolution, Windows installer + .lnk icons
  assets/icon.icns           macOS .app bundle icon
  frontend/app/favicon.ico   same .ico — Next.js exports it to public/favicon.ico,
                             which install.sh/install.ps1 already point shortcuts at

Why this exists at all: the repo's only icon was Next.js's stock favicon (a black
circle with Vercel's triangle). Fine as an unnoticed browser-tab glyph, not fine
as the icon on a church volunteer's desktop and in a Windows installer — it's
another company's mark, and it says nothing about the app.

The mark is an open book (scripture) under an echo arc (live audio, and the
product name). Drawn from primitives rather than traced from a design file so it
regenerates cleanly at any size; colours are the app's own, taken from
frontend/app/globals.css (--bg-*, --gold*), so the icon matches the UI it opens.
"""

import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

# 4x supersample, then downsample with LANCZOS — PIL's draw primitives have no
# antialiasing of their own, and this icon is nothing but diagonals and arcs.
S = 4
SIZE = 1024
C = SIZE * S

GOLD = (201, 164, 92)
GOLD_BRIGHT = (230, 201, 135)
BG_TOP = (36, 32, 25)
BG_BOTTOM = (10, 9, 8)


def lerp(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def draw_icon():
    img = Image.new("RGBA", (C, C), (0, 0, 0, 0))

    # Background: vertical gradient, clipped to a rounded square. 22% corner
    # radius is roughly what macOS Big Sur+ and Windows 11 tiles use, so the
    # icon doesn't read as visibly squarer or rounder than its neighbours.
    grad = Image.new("RGBA", (1, C))
    for y in range(C):
        grad.putpixel((0, y), lerp(BG_TOP, BG_BOTTOM, y / (C - 1)) + (255,))
    img.paste(grad.resize((C, C)), (0, 0))
    img.putalpha(rounded_mask(C, round(C * 0.22)))

    d = ImageDraw.Draw(img)

    def sc(pts):
        return [(x * S, y * S) for x, y in pts]

    # Hairline gold rim — keeps the icon from disappearing into a dark dock or
    # taskbar, which is exactly where this one will usually sit.
    d.rounded_rectangle(
        [8 * S, 8 * S, C - 8 * S, C - 8 * S],
        radius=round(C * 0.21),
        outline=GOLD + (70,),
        width=3 * S,
    )

    # Echo arcs: three concentric strokes opening upward out of the book's spine.
    # Radii are bounded so the outermost still clears the rounded corner — an arc
    # cropped by the canvas edge reads as a rendering bug, not a design.
    # Drawn before the pages so the book overlaps their lower ends cleanly.
    for radius, width, alpha in ((140, 26, 255), (220, 24, 150), (300, 22, 70)):
        box = sc([(512 - radius, 460 - radius), (512 + radius, 460 + radius)])
        d.arc([box[0], box[1]], start=205, end=335, fill=GOLD_BRIGHT + (alpha,), width=width * S)

    # Open book: two pages meeting at a spine gap. The gap is background rather
    # than a drawn line so it stays crisp at 16px, where a 1px dark stroke on
    # gold would grey out into mud.
    left = sc([(500, 498), (150, 428), (118, 770), (500, 840)])
    right = sc([(524, 498), (874, 428), (906, 770), (524, 840)])
    d.polygon(left, fill=GOLD)
    d.polygon(right, fill=GOLD_BRIGHT)

    # Page shadow under each outer edge, so the book reads as a solid object
    # rather than a flat chevron once it's small.
    d.polygon(sc([(150, 428), (118, 770), (150, 776), (176, 440)]), fill=lerp(GOLD, BG_BOTTOM, 0.45))
    d.polygon(sc([(874, 428), (906, 770), (874, 776), (848, 440)]), fill=lerp(GOLD, BG_BOTTOM, 0.45))

    return img.resize((SIZE, SIZE), Image.LANCZOS)


def main():
    icon = draw_icon()

    png_path = os.path.join(HERE, "icon.png")
    icon.save(png_path)

    # 256 is the largest size Windows reads from an .ico; 16/20/24/32/48/64 are
    # the sizes Explorer, the taskbar and Alt-Tab actually request, and letting
    # PIL derive each one from the 1024 master beats letting Windows rescale a
    # single large layer at draw time.
    ico_path = os.path.join(HERE, "icon.ico")
    icon.save(ico_path, sizes=[(s, s) for s in (16, 20, 24, 32, 48, 64, 128, 256)])

    icns_path = os.path.join(HERE, "icon.icns")
    icon.save(icns_path)

    # The frontend's favicon is the same file: Next.js exports app/favicon.ico to
    # out/favicon.ico -> dist/public/favicon.ico, which is the path install.ps1
    # and install.sh already hand to the shortcut they create.
    favicon = os.path.join(REPO, "frontend", "app", "favicon.ico")
    icon.save(favicon, sizes=[(s, s) for s in (16, 20, 24, 32, 48, 64, 128, 256)])

    for p in (png_path, ico_path, icns_path, favicon):
        print(f"{os.path.relpath(p, REPO):40s} {os.path.getsize(p):>9,d} bytes")


main()
