"""
Picks the best of several downloaded icon candidates and writes one PNG.

    python scripts/logo-normalise.py <out.png> <candidate> [<candidate> ...]

Prints one JSON object describing what was chosen, or {"ok": false} if none of
the candidates was a usable image.

WHY PYTHON. Choosing between candidates means reading each one's real pixel
dimensions, and converting the winner means decoding ICO (whose frames are
BMP, not PNG) and flattening transparency. Pillow does both and is already a
dependency of this repo's tooling — scripts/import-clients.mjs reads the client
spreadsheet through openpyxl for the same reason. The alternative was hand-
rolling an image decoder in Node or adding an npm image library, and neither is
worth it for a script that runs once when the client list changes.

SELECTION RULE. Largest area wins, because every candidate is the same
institution's own mark at a different resolution and the card renders it at 44px
on a display that may be 2x or 3x. Ties break toward the earlier candidate,
which is the order the fetcher ranked them by trustworthiness (the site's own
apple-touch-icon before a third-party cache).
"""

import json
import sys

from PIL import Image

# Below this, the icon is a 16px scrap that will look like mud at any size the
# UI actually uses. Still written if it is all we have — a blurry real crest
# beats coloured initials — but reported so the caller can say so.
DECENT_PX = 96


def measure(path):
    try:
        with Image.open(path) as im:
            # An ICO holds several frames; Image.size reports only the one
            # Pillow selected, so ask the container what it actually contains.
            sizes = im.info.get("sizes")
            if sizes:
                w, h = max(sizes, key=lambda s: s[0] * s[1])
            else:
                w, h = im.size
            return {"path": path, "format": im.format, "w": w, "h": h}
    except Exception:
        return None


def main():
    out, candidates = sys.argv[1], sys.argv[2:]
    measured = [m for m in (measure(c) for c in candidates) if m]
    if not measured:
        print(json.dumps({"ok": False}))
        return 0

    best = max(measured, key=lambda m: m["w"] * m["h"])

    with Image.open(best["path"]) as im:
        if im.format == "ICO":
            # Ask for the largest frame explicitly; without this Pillow hands
            # back whichever frame it opened first, which is usually the 16px.
            im.size = (best["w"], best["h"])
            im = im.convert("RGBA")
        elif im.mode not in ("RGBA", "RGB"):
            im = im.convert("RGBA")
        im.save(out, format="PNG", optimize=True)

    print(json.dumps({
        "ok": True,
        "from": best["path"],
        "format": best["format"],
        "w": best["w"],
        "h": best["h"],
        "lowRes": best["w"] < DECENT_PX,
        "considered": len(measured),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
