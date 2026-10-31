"""Build every GradApp icon from the one logo file.

    python3 scripts/icons.py            (needs Pillow and numpy)

Input:  assets/logo-source.png  (the G mark, any background colour that is
        pure black is removed)
Output: desktop/assets/  app icon, tray icons, transparent mark
        website/assets/  favicons, touch icon, PWA icons, transparent mark

Run it again whenever the logo changes; everything else follows.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

DESKTOP = Path(__file__).resolve().parent.parent
ASSETS = DESKTOP / "assets"
WEB = DESKTOP.parent / "website" / "assets"
TILE = (11, 13, 17, 255)  # the app's graphite, behind the mark on app icons


def cut_mark(path: Path) -> Image.Image:
    """The mark on transparency, trimmed and centred on a square canvas."""
    a = np.asarray(Image.open(path).convert("RGB")).astype(np.float32)
    alpha = np.clip((a.max(axis=2) - 6) / 40.0, 0, 1)
    rgb = np.where(alpha[..., None] > 0, np.clip(a / np.maximum(alpha[..., None], 1e-3), 0, 255), 0)
    image = Image.fromarray(np.dstack([rgb, alpha * 255]).astype(np.uint8), "RGBA")
    mark = image.crop(image.getbbox())
    side = max(mark.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    return square


def fit(mark: Image.Image, size: int, scale: float) -> Image.Image:
    """The mark at `scale` of a transparent `size` canvas."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = max(1, round(size * scale))
    m = mark.resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(m, ((size - inner) // 2, (size - inner) // 2))
    return canvas


def tile(mark: Image.Image, size: int, *, inset: float = 0.0, radius: float = 0.225, scale: float = 0.6) -> Image.Image:
    """App-icon style: the mark on a rounded graphite square."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pad = round(size * inset)
    box = size - 2 * pad
    mask = Image.new("L", (box * 4, box * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, box * 4 - 1, box * 4 - 1), radius=round(box * 4 * radius), fill=255)
    bg = Image.new("RGBA", (box, box), TILE)
    canvas.paste(bg, (pad, pad), mask.resize((box, box), Image.LANCZOS))
    canvas.alpha_composite(fit(mark, box, scale), (pad, pad))
    return canvas


def silhouette(mark: Image.Image, size: int, dot: bool) -> Image.Image:
    """macOS menu-bar template: black shape, alpha only."""
    base = fit(mark, size, 0.92)
    alpha = base.getchannel("A")
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.putalpha(alpha)
    if dot:
        d = ImageDraw.Draw(out)
        r = size * 0.2
        d.ellipse((size - 2 * r, 0, size, 2 * r), fill=(0, 0, 0, 255))
    return out


def with_dot(image: Image.Image) -> Image.Image:
    out = image.copy()
    s = out.width
    r = s * 0.19
    ImageDraw.Draw(out).ellipse((s - 2 * r - 1, 1, s - 1, 2 * r + 1), fill=(52, 211, 153, 255), outline=(11, 13, 17, 255), width=max(1, s // 32))
    return out


def main() -> None:
    mark = cut_mark(ASSETS / "logo-source.png")
    WEB.mkdir(parents=True, exist_ok=True)

    # Desktop app
    fit(mark, 1024, 1.0).save(ASSETS / "logo.png")
    tile(mark, 1024, inset=0.08).save(ASSETS / "icon.png")  # macOS grid: art inside a margin
    tile(mark, 256, inset=0.0, radius=0.2, scale=0.66).save(ASSETS / "icon-256.png")
    for size, suffix in ((32, ""), (64, "@2x")):
        colour = fit(mark, size, 0.94)
        colour.save(ASSETS / f"tray{suffix}.png")
        with_dot(colour).save(ASSETS / f"tray-active{suffix}.png")
    for size, suffix in ((16, ""), (32, "@2x")):
        silhouette(mark, size, False).save(ASSETS / f"trayTemplate{suffix}.png")
        silhouette(mark, size, True).save(ASSETS / f"trayActiveTemplate{suffix}.png")

    # Website
    fit(mark, 512, 1.0).save(WEB / "logo.png")
    fit(mark, 128, 1.0).save(WEB / "logo-128.png")
    fit(mark, 96, 1.0).save(DESKTOP / "src" / "renderer" / "logo.png")
    fit(mark, 32, 0.96).save(WEB / "favicon-32.png")
    fit(mark, 64, 1.0).save(WEB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    tile(mark, 180, radius=0.0, scale=0.62).save(WEB / "apple-touch-icon.png")
    tile(mark, 192, radius=0.22, scale=0.6).save(WEB / "icon-192.png")
    tile(mark, 512, radius=0.22, scale=0.6).save(WEB / "icon-512.png")
    tile(mark, 512, radius=0.0, scale=0.5).save(WEB / "icon-maskable-512.png")
    print("icons written to", ASSETS, "and", WEB)


if __name__ == "__main__":
    main()
