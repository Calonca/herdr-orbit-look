#!/usr/bin/env python3
"""A blurred copy of a background, for the glass of the mods that draw their own
block (glass.js): herdr-app has no backdrop blur, so the mods draw this picture
under their glass, placed as the window's background is.

    scripts/blur.py mods/orbit/backgrounds/space.png   -> mods/orbit/backgrounds/space-blur.png
    scripts/blur.py <picture> [radius]         radius in pixels of the picture (default 1.2% of its width)

Same size as the original, so the mods can place it with the same cover math.
"""
import sys
from pathlib import Path

from PIL import Image, ImageFilter


def blurred_path(path: Path) -> Path:
    return path.with_name(f"{path.stem}-blur.png")


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    src = Path(sys.argv[1])
    image = Image.open(src).convert("RGB")
    radius = float(sys.argv[2]) if len(sys.argv) > 2 else image.width * 0.012
    image.filter(ImageFilter.GaussianBlur(radius)).save(blurred_path(src), optimize=True)
    print(blurred_path(src))


if __name__ == "__main__":
    main()
