/** Lowercase, collapse whitespace runs to single spaces, trim outer whitespace. */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Drop n chars from each end of an OCR'd window — only window-edge glyphs
 * mis-read, so the middle is what we trust.
 */
export function trimEdges(s: string, n = 2): string {
  return s.length <= 2 * n ? "" : s.slice(n, s.length - n).trim();
}

/** Plain Levenshtein distance. Inputs here are short (< 100 chars). */
export function editDistance(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  if (n === 0) return m;
  if (m === 0) return n;
  let prev: number[] = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1);
    }
    prev = cur;
  }
  return prev[m];
}
