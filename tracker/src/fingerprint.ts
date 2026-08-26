import { editDistance, normalize, trimEdges } from "./normalize";

/**
 * Minimal edit distance between `needle` and any substring of `haystack`
 * (semi-global alignment: start and end anywhere in the haystack for free).
 * Edit distance rather than Hamming because the ♪ separator renders at
 * variable width (`C`, `¢¢`, `dd`, or nothing), which shifts characters.
 */
export function fuzzySubstringDistance(needle: string, haystack: string): number {
  const n = needle.length;
  const m = haystack.length;
  if (n === 0) return 0;
  if (m === 0) return n;
  let prev = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    const cur = new Array<number>(m + 1);
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const cost = needle[i - 1] === haystack[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j - 1] + cost, prev[j] + 1, cur[j - 1] + 1);
    }
    prev = cur;
  }
  return Math.min(...prev);
}

/**
 * Edit distance between `a` and the closest ROTATION of `b`, or Infinity when
 * the two are too different in length to be rotations of one another.
 *
 * Every rotation of `b` is a contiguous window of `b + b`, so the semi-global
 * alignment above finds the best one for free. The length guard is what keeps
 * this honest: without it a short unit scores 0 against any longer unit that
 * happens to contain it, and two unrelated songs would merge.
 *
 * This exists because the rotation point of a stitched unit is the stitcher's
 * *guess*, not data (see `stitch.ts` step 5c). Two bursts of one song can be
 * cut at different points, and the tick fingerprint above already treats those
 * as the same song — `resolveTrack` has to agree or the same song lands in the
 * log two or three times running.
 */
export function rotationDistance(a: string, b: string, maxEdits: number): number {
  if (Math.abs(a.length - b.length) > maxEdits) return Infinity;
  return fuzzySubstringDistance(a, b + b);
}

/**
 * References a tick window is matched against: the doubled unit with the ♪
 * loop separator, plus a plain-space variant. OCR often renders ♪ as nothing,
 * and paying edit distance against the ♪ form would burn the whole mismatch
 * budget before any real noise.
 */
export function buildReferences(unit: string): string[] {
  const u = normalize(unit);
  return [`${u} ♪ ${u}`, `${u} ${u}`];
}

/** The ~85% path: does this tick's OCR text still look like `unit`? */
export function isSameSong(tickText: string, unit: string, maxEdits = 2): boolean {
  const t = trimEdges(normalize(tickText));
  if (t.length < 8) return false; // too little text to trust a match
  return buildReferences(unit).some((ref) => fuzzySubstringDistance(t, ref) <= maxEdits);
}
/**
 * Does the END of a burst still read as `unit`?
 *
 * This is the evidence a FAILED stitch leaves behind. Stitching has to recover
 * the marquee's loop, and it can fail on frames that plainly show the song:
 * in `fixture5-unstitchable-burst.txt` — a real `no_repeat_period` failure —
 * 12 of 59 frames match the current unit inside the ordinary tick budget, the
 * last of them by a single edit. Withholding confirmation there tells the page
 * the marquee has become unreadable, when what happened is that it was read and
 * had not changed.
 *
 * Only the TAIL counts, and that is the whole difference between this and
 * "some frame somewhere said the old song". A burst spans half a minute; a song
 * that changes inside it leaves its predecessor in the early frames, and
 * confirming from those would pin the page to a song that has already ended.
 * The last frames are as recent as the tick frame the cheap path confirms from.
 *
 * Same test and same budget as `isSameSong` by construction — this IS
 * `isSameSong`, applied to the frames the stitcher could not assemble.
 */
export function burstStillShows(
  fragments: string[],
  unit: string,
  tailFrames: number,
  maxEdits?: number,
): boolean {
  return fragments.slice(-tailFrames).some((f) => isSameSong(f, unit, maxEdits));
}

/**
 * Does this tick's marquee still read as the burst that just FAILED to stitch?
 *
 * The burst backoff in `tracker.ts` exists to stop a pathological-OCR song
 * re-bursting on every tick. It has to know whether the thing on screen NOW is
 * that same song, and it cannot ask `isSameSong`: that needs a canonical unit,
 * and a failed stitch is precisely the case where there is none.
 *
 * So the failed burst's own fragments are the reference. Two tick frames of one
 * song 30 s apart can share almost nothing — the marquee scrolls ~4 chars/s and
 * a short credit loops several times in between, so the phase is effectively
 * arbitrary — but a burst spans ~30 s at 2 fps and therefore holds EVERY phase
 * of the loop. Whatever phase the new tick caught, some frame of that burst saw
 * it too.
 *
 * The budget is a ratio, not a fixed edit count, because these are raw OCR of a
 * half-legible marquee rather than the clean units `isSameSong` compares.
 * Measured 2026-08-26 over fixtures 2, 5, 6, 7 and 12: a frame of the same song
 * scores p50 0.11-0.26 against the rest of its own burst and 0.54 at p90, while
 * frames of a DIFFERENT song never scored below 0.43 against any of them. The
 * default sits at 0.40, under every cross-song minimum seen — the error it
 * accepts is re-bursting a song it could have skipped, never going blind to a
 * song it has not read.
 */
export function marqueeStillReads(
  tickText: string,
  fragments: string[],
  maxRatio: number,
): boolean {
  const t = trimEdges(normalize(tickText));
  if (t.length < 8) return false; // too little text to trust either way
  for (const f of fragments) {
    const x = trimEdges(normalize(f));
    if (x.length < 8) continue;
    if (editDistance(t, x) / Math.max(t.length, x.length) <= maxRatio) return true;
  }
  return false;
}
