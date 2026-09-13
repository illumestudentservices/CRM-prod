"""Generate the browser-tab icon from the Illume logo mark.

`public/logo.png` is a wide lock-up (globe mark + ILLUME wordmark, 379x110).
A wordmark is illegible at 16px, so only the mark on the left is used. The
split point is the first fully blank column run in the source (x=77), found by
scanning the ink profile rather than hardcoding a guess.

The source has a WHITE background, not transparency, so the mark is separated
by luminance before it can be recoloured.

Run: python scripts/make-favicon.py
Outputs: app/favicon.ico, app/apple-icon.png
"""

from PIL import Image, ImageDraw

SRC = "public/logo.png"
BRAND = (22, 112, 156)  # #16709C, sampled from the mark
ICO_SIZES = [16, 32, 48, 64, 128, 256]


def mark_alpha() -> Image.Image:
    """The logo mark as an alpha mask: opaque where there is ink."""
    im = Image.open(SRC).convert("RGBA")
    icon = im.crop((0, 0, 77, im.height))

    # White background -> transparent, ink -> opaque. Anti-aliased edges keep
    # their partial alpha so the mark does not come out jagged at 16px.
    #
    # The scale matters: a bare `255 - luminance` looks right but is not. Brand
    # blue has luminance 90, so it would yield alpha 165 and the solid strokes
    # would render at 65% over white — a visibly washed-out, pale-blue mark.
    # Normalising against the brand's own luminance maps white -> 0 and full
    # brand blue -> 255, so ink lands at its true colour.
    ink = 255 - (BRAND[0] * 299 + BRAND[1] * 587 + BRAND[2] * 114) // 1000

    alpha = Image.new("L", icon.size, 0)
    src = icon.load()
    dst = alpha.load()
    for y in range(icon.height):
        for x in range(icon.width):
            r, g, b, a = src[x, y]
            if a < 20:
                continue
            lum = (r * 299 + g * 587 + b * 114) // 1000
            dst[x, y] = min(255, round((255 - lum) * 255 / ink))

    return alpha.crop(alpha.getbbox())


def build(size: int, invert: bool) -> Image.Image:
    """Square icon at `size`. invert=True gives a blue tile with a white mark."""
    a = mark_alpha()

    # Fit the mark into a padded square. 78% leaves a margin so the glyph is
    # not flush against the tile edge at any size.
    box = int(size * 0.78)
    scale = min(box / a.width, box / a.height)
    a = a.resize((max(1, round(a.width * scale)), max(1, round(a.height * scale))), Image.LANCZOS)

    if invert:
        radius = max(1, round(size * 0.18))
        tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        ImageDraw.Draw(tile).rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=BRAND + (255,))
        glyph = Image.new("RGBA", a.size, (255, 255, 255, 255))
    else:
        tile = Image.new("RGBA", (size, size), (255, 255, 255, 255))
        glyph = Image.new("RGBA", a.size, BRAND + (255,))

    glyph.putalpha(a)
    tile.paste(glyph, ((size - a.width) // 2, (size - a.height) // 2), glyph)
    return tile


def main(invert: bool = False) -> None:
    """invert=False is the shipped look: blue mark on a white tile, matching
    the logo's own colours. Pass True for the reverse (white mark on a blue
    tile), which reads better at 16px but does not match the lock-up."""

    base = build(256, invert)
    base.save("app/favicon.ico", sizes=[(s, s) for s in ICO_SIZES])
    build(180, invert).save("app/apple-icon.png")
    print("wrote app/favicon.ico and app/apple-icon.png")


if __name__ == "__main__":
    main()
