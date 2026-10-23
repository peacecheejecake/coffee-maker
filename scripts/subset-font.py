"""Subset a font to ASCII + Hangul Jamo/compat + the 2,350 KS X 1001 syllables + common symbols.

Used for the 3D nameplates (troika text needs a woff/ttf/otf file, not CSS fonts).

    python3 -m pip install fonttools
    python3 scripts/subset-font.py <Pretendard-Bold.otf> apps/web/public/fonts/Pretendard-Bold.ksx1001.woff

Source: Pretendard (SIL OFL 1.1) — https://github.com/orioncactus/pretendard
"""
import sys

from fontTools import subset


def ksx1001_hangul() -> str:
    chars = []
    for lead in range(0xB0, 0xC9):
        for trail in range(0xA1, 0xFF):
            chars.append(bytes([lead, trail]).decode("euc-kr"))
    return "".join(chars)


def main(src: str, dst: str) -> None:
    text = (
        "".join(chr(c) for c in range(0x20, 0x7F))
        + ksx1001_hangul()
        + "".join(chr(c) for c in range(0x3131, 0x318F))  # compatibility jamo
        + "·•…–—‘’“”※★☆♥♡○●◎◇◆□■△▲▽▼→←↑↓☕✓✔✗✘×÷±°℃"
    )
    options = subset.Options()
    options.flavor = "woff"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    font = subset.load_font(src, options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    subset.save_font(font, dst, options)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
