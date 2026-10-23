export const FONT_URL = '/fonts/Pretendard-Bold.ksx1001.woff';
/** Full Pretendard Bold (1.1 MB), fetched only when a name uses characters outside the subset. */
export const FULL_FONT_URL = '/fonts/Pretendard-Bold.woff';

let covered: Set<string> | null = null;

/** The subset's coverage: ASCII + the 2,350 KS X 1001 syllables + compatibility jamo (see scripts/subset-font.py). */
function subsetCoverage(): Set<string> {
  if (covered) return covered;
  covered = new Set<string>();
  for (let c = 0x20; c < 0x7f; c++) covered.add(String.fromCharCode(c));
  for (let c = 0x3131; c < 0x318f; c++) covered.add(String.fromCharCode(c));
  try {
    const decoder = new TextDecoder('euc-kr');
    for (let lead = 0xb0; lead <= 0xc8; lead++) {
      for (let trail = 0xa1; trail <= 0xfe; trail++) covered.add(decoder.decode(new Uint8Array([lead, trail])));
    }
  } catch {
    // No EUC-KR decoder: be conservative and use the full font for any Hangul.
  }
  return covered;
}

/** Subset font when it has every character of `text`, otherwise the full font. */
export function fontFor(text: string): string {
  const set = subsetCoverage();
  return [...text].every((ch) => set.has(ch)) ? FONT_URL : FULL_FONT_URL;
}
