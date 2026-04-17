from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
BUILD_DIR = ROOT / "build"
PNG_PATH = BUILD_DIR / "icon.png"
ICO_PATH = BUILD_DIR / "icon.ico"

SIZE = 1024
BG = "#09121e"
OUTER_RING = "#0e2238"
CARD = "#f4f7fb"
CARD_EDGE = "#d8e0ea"
FOLDER = "#f4b660"
FOLDER_SHADE = "#d8922b"
BRANCH = "#3cb98f"
ACCENT = "#7fe2c0"
DOT = "#0c2234"


def rounded_box(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int, fill: str) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    image = Image.new("RGBA", (SIZE, SIZE), BG)
    draw = ImageDraw.Draw(image)

    rounded_box(draw, (64, 64, 960, 960), 220, OUTER_RING)
    rounded_box(draw, (108, 108, 916, 916), 192, BG)

    card_x0, card_y0, card_x1, card_y1 = 190, 208, 834, 836
    rounded_box(draw, (card_x0, card_y0, card_x1, card_y1), 96, CARD)
    draw.rounded_rectangle(
        (card_x0, card_y0, card_x1, card_y1),
        radius=96,
        outline=CARD_EDGE,
        width=8,
    )

    rounded_box(draw, (248, 286, 540, 484), 46, FOLDER)
    rounded_box(draw, (248, 254, 402, 340), 34, FOLDER)
    draw.rectangle((248, 366, 540, 484), fill=FOLDER_SHADE)

    draw.line((374, 448, 374, 664), fill=BRANCH, width=46)
    draw.line((374, 664, 648, 664), fill=BRANCH, width=46)
    draw.line((558, 526, 730, 526), fill=BRANCH, width=46)

    for cx, cy in ((374, 664), (648, 664), (558, 526), (730, 526)):
        draw.ellipse((cx - 52, cy - 52, cx + 52, cy + 52), fill=ACCENT)
        draw.ellipse((cx - 24, cy - 24, cx + 24, cy + 24), fill=DOT)

    image.save(PNG_PATH, format="PNG")
    image.save(
        ICO_PATH,
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )

    print(f"Saved {PNG_PATH}")
    print(f"Saved {ICO_PATH}")


if __name__ == "__main__":
    main()
