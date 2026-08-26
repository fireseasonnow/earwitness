/**
 * Burst stitcher: turns ~14 OCR'd marquee fragments into ONE canonical
 * `Artist — Title` unit.
 *
 * Pipeline: align fragments on a shared axis by best overlap (twice — the
 * second pass scores against the first's finished consensus) → per-column
 * majority vote → detect the marquee repeat period → fold votes modulo the
 * period → collapse the fold if it came out holding whole copies → rotate the
 * cyclic unit at the loop boundary.
 *
 * The rotation point comes from (in priority order):
 *  1. a pause anchor — the marquee holds ~1–2 s at the unit start each loop,
 *     so consecutive near-identical frames mark the artist's first character
 *     (verified live and by fixture 2);
 *  2. a separator artifact — the ♪ glyph OCR'd as symbols, ` C `/` dd `
 *     islands, or a collapsed multi-space gap;
 *  3. a single-space cut — the ♪ often renders as a plain space, leaving
 *     nothing to distinguish the real boundary from a word gap. The pick is
 *     reported as low-confidence to the journal, and `resolveTrack` matches
 *     rotations, so an arbitrary cut costs a name and not a duplicate row.
 */
import { editDistance, normalize } from "./normalize";

export interface StitchResult {
  /** Canonical `Artist — Title` unit (original case), or null if stitching failed. */
  unit: string | null;
  /** false → widen the dedup budget and log the reason with the raw fragments. */
  confident: boolean;
  /** Populated when confidence is low or stitching failed. */
  reason: string | null;
  /** Fragments that could not be aligned and were excluded from voting. */
  droppedFragments: string[];
}

const MIN_FRAGMENTS = 4;
const MIN_FRAGMENT_LEN = 8;
const MIN_OVERLAP = 6; // columns of existing data a placement must touch
const MIN_MATCHES = 6; // absolute matching columns required to accept a placement
const MIN_MATCH_RATIO = 0.55;
/*
 * The marquee only ever moves FORWARD, so a correct placement never sits behind
 * the previous one — but a misread frame placed too far ahead drags `lastOffset`
 * with it, and every later frame is then searched from the wrong place. 2 was
 * too tight to climb back: on 2026-08-26 a burst of "Ardley — 01 - Dawn Hour"
 * placed 22 of 60 frames because the true offset sat one column outside the
 * window. 8 stays well inside one period, so it cannot alias onto the next
 * repetition.
 */
const SEARCH_BACK = 8; // offsets searched behind the previous fragment's start
const SEARCH_FWD = 16; // ahead (≈4 chars/frame at 1 fps, wide slack)
/*
 * Both bounds are the credit's own length, and both were measured too narrow on
 * 2026-08-26 — between them they accounted for 44 of that day's 62 failed
 * bursts, every one of which had already produced a clean consensus.
 *
 * "Grabek — three" is 14 characters and loops every 15 columns, under the old
 * floor of 16, so the search skipped its period and found 30 instead: two
 * copies, which every rotation check then rejected as doubled.
 * "Ben Seretan — criss cross applesauce right in the stream of the amp" is 67
 * and loops every ~70, over the old ceiling of 64, so no period was found at
 * all. 96 leaves headroom above the longest credit seen; the cost of the extra
 * offsets is one pass over the consensus each.
 */
const MIN_PERIOD = 12;
const MAX_PERIOD = 96;
// Heavy-noise songs rarely exceed ~0.7 self-agreement even when the period is
// right; anything mis-detected is still caught by the confidence gates.
const MIN_PERIOD_SAMPLES = 15;
const MIN_PERIOD_RATIO = 0.68;
const PAUSE_TEXT_MIN_LEN = 15;
/*
 * Scaled with `burstFps`. The real gate is the offset test below (mid-scroll
 * frames sit ~2 columns apart at 2 fps, ~4 at 1 fps, and must be within 1 to
 * anchor), but this budget has to stay proportional to it: at 1 fps consecutive
 * frames were ~8+ edits apart and 4 was slack, while at 2 fps they are ~4 apart
 * and 4 would sit exactly on a mid-scroll pair. A real pause holds the same text
 * for 2-4 frames, so 2 still clears it comfortably.
 */
const PAUSE_MAX_EDITS = 2;

/*
 * Locating the song change inside a straddled burst (`transitionIndex`).
 * Fragments each side of the cut must be enough to stitch from, and the two
 * sides must genuinely look like different text: measured 2026-08-26, a real
 * straddle scores 0.02 (fixture 10) and 0.23 (fixture 12) while single-song
 * bursts — including the noisiest, fixtures 5, 9 and 11 — never dropped below
 * 0.33. Trigrams rather than whole frames because the marquee is scrolling:
 * the same credit appears at a different offset in every frame, and only the
 * character runs survive that.
 */
const SPLIT_MIN_SIDE = 8;
const SPLIT_MAX_OVERLAP = 0.3;
const SPLIT_GRAM = 3;
/*
 * A song change is not a knife edge. The marquee swaps its text between one
 * frame and the next, and the frames around that swap catch it mid-redraw:
 * fixture 12 changes song at frame 22 and yields four degenerate "Ben a -
 * kokosing" reads before the new credit renders whole, which is enough to cost
 * the later half its repeat period. So the cut is searched forward from the
 * detected transition rather than pinned to it — 6 frames is 3 s at 2 fps,
 * past any swap, and every candidate still has to clear the same bar below.
 */
const SPLIT_GUARD_FRAMES = 6;

// The ♪ separator between marquee repetitions, as OCR actually renders it.
const SPACE_RUN = / {2,}/; // ♪ rendered as nothing → collapsed gap
const JUNK_ISLAND = / [♪¢{}«»|*_=~^<>;:.'"`]{1,3} /; // ♪ rendered as symbols
const LETTER_ISLAND = / [cCdD¢]{1,2} /; // ♪ rendered as C / dd / ¢¢
const ISLAND_CHARS = "♪¢{}«»|*_=~^<>;:.'\"`cCdD";

function ciEq(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

/** Per-column character votes across all aligned fragments. */
class Tally {
  cols = new Map<number, Map<string, number>>();

  add(col: number, ch: string, weight = 1): void {
    let votes = this.cols.get(col);
    if (!votes) {
      votes = new Map();
      this.cols.set(col, votes);
    }
    votes.set(ch, (votes.get(ch) ?? 0) + weight);
  }

  addFragment(text: string, offset: number): void {
    for (let p = 0; p < text.length; p++) this.add(offset + p, text[p]);
  }

  /** Share of votes at a column agreeing with `ch` (0 when unvoted). */
  agreement(col: number, ch: string): number | null {
    const votes = this.cols.get(col);
    if (!votes) return null;
    let voters = 0;
    let agree = 0;
    const lower = ch.toLowerCase();
    for (const [raw, n] of votes) {
      voters += n;
      if (raw === ch || raw.toLowerCase() === lower) agree += n;
    }
    return voters === 0 ? null : agree / voters;
  }

  /**
   * Winning character at a column. Majority means one case-insensitive
   * character group holds a strict majority of the votes.
   */
  top(col: number): { char: string; voters: number; majority: boolean } | null {
    const votes = this.cols.get(col);
    if (!votes) return null;
    const groups = new Map<string, { count: number; bestRaw: string; bestRawCount: number }>();
    let voters = 0;
    for (const [raw, n] of votes) {
      voters += n;
      const key = raw.toLowerCase();
      const g = groups.get(key);
      if (!g) groups.set(key, { count: n, bestRaw: raw, bestRawCount: n });
      else {
        g.count += n;
        if (n > g.bestRawCount) {
          g.bestRaw = raw;
          g.bestRawCount = n;
        }
      }
    }
    let best: { count: number; bestRaw: string } | null = null;
    for (const g of groups.values()) {
      if (!best || g.count > best.count) best = g;
    }
    if (!best) return null;
    return { char: best.bestRaw, voters, majority: best.count * 2 > voters };
  }
}

function scorePlacement(
  tally: Tally,
  text: string,
  offset: number,
): { matches: number; overlap: number } {
  // Fractional agreement, not plurality-match: on very noisy songs earlier
  // garbage splits column votes and a correctly aligned frame would score 0.
  let matches = 0;
  let overlap = 0;
  for (let p = 0; p < text.length; p++) {
    const share = tally.agreement(offset + p, text[p]);
    if (share === null) continue;
    overlap++;
    matches += share;
  }
  return { matches, overlap };
}

function countOccurrences(s: string, sub: string): number {
  let n = 0;
  for (let i = s.indexOf(sub); i >= 0; i = s.indexOf(sub, i + 1)) n++;
  return n;
}

interface SeparatorCandidate {
  start: number; // position of the separator in the cyclic unit, < period
  len: number;
}

/**
 * The content period of a cyclic string that holds WHOLE repetitions of itself,
 * or null when it holds one.
 *
 * Rotation is the test, not a comparison of halves. The ♪ separator OCRs at a
 * different width in each repetition (` `, ` - `, ` C `), so two copies inside
 * one period are not the same length and no fixed split lands on both — a
 * halves comparison missed "Reunion Passport — Reunion - Passport — " for
 * exactly that reason. Rotating by the content period slides every copy onto
 * its neighbour and costs only the separator's few characters.
 *
 * Whole copies only: `n` must be within 3 of an integer multiple of `k`. That
 * constraint is what stops a real credit from collapsing onto a prefix of
 * itself — "Ben Seretan — criss cross applesauce…" has no k dividing its 67
 * columns that also matches under rotation.
 */
function repeatPeriod(cyclic: string, budget: number): number | null {
  const n = cyclic.length;
  for (let k = MIN_PERIOD; k <= n / 2; k++) {
    const copies = Math.round(n / k);
    if (copies < 2 || Math.abs(n - copies * k) > 3) continue;
    const rotated = cyclic.slice(k) + cyclic.slice(0, k);
    if (editDistance(cyclic, rotated) <= Math.max(2, Math.round(budget * n))) return k;
  }
  return null;
}

/**
 * Two budgets, because a period that came out a multiple has two very different
 * cases behind it.
 *
 * Copies that agree (`COLLAPSE`) are a period detected at 2× or 3× the truth —
 * a short credit whose real loop sat under the search floor, or one whose
 * separator alternates. There the fold is sound and one copy IS the unit, so
 * `collapseRepeats` keeps one.
 *
 * Copies that merely resemble each other (`REJECT`) mean the fold smeared two
 * readings of the song together, and no slice of it is a credit. That is the
 * one the row must never see: it reads as "Kelley - Tonkotsu (Relceets Owen
 * Kelley — Tonkotsu (RelOwen Kelley", which parses perfectly well.
 */
const COLLAPSE_BUDGET = 0.15;
const REJECT_BUDGET = 0.35;
/**
 * OCR can mangle a copy past any whole-string comparison and still leave the
 * evidence in place: a credit does not say the same ten characters twice, and a
 * fold of two repetitions does.
 */
const REPEATED_RUN = 10;

/** One repetition of a cyclic period that turned out to hold several. */
function collapseRepeats(cyclic: string): string {
  const k = repeatPeriod(cyclic, COLLAPSE_BUDGET);
  return k === null ? cyclic : cyclic.slice(0, k);
}

function hasRepeatedRun(unit: string, len: number): boolean {
  const s = unit.toLowerCase();
  for (let i = 0; i + len <= s.length; i++) {
    if (s.indexOf(s.slice(i, i + len), i + 1) >= 0) return true;
  }
  return false;
}

/** A rotation is plausible only if it reads as a single `Artist — Title`. */
function validUnit(unit: string): boolean {
  return (
    unit.length >= 10 &&
    countOccurrences(unit, " — ") === 1 &&
    !SPACE_RUN.test(unit) &&
    !JUNK_ISLAND.test(unit) &&
    !/^\s|\s$/.test(unit) &&
    repeatPeriod(unit, REJECT_BUDGET) === null &&
    !hasRepeatedRun(unit, REPEATED_RUN)
  );
}

function scanCandidates(doubled: string, period: number, re: RegExp): SeparatorCandidate[] {
  const out: SeparatorCandidate[] = [];
  const g = new RegExp(re.source, "g");
  for (const m of doubled.matchAll(g)) {
    if (m.index >= period) continue; // duplicate of index - period
    out.push({ start: m.index, len: m[0].length });
  }
  return out;
}

/**
 * Length of the separator run ending just before `idx` in `doubled`
 * (idx must be ≥ period so lookback never underflows). 0 → no separator.
 */
function sepLenBefore(doubled: string, idx: number): number {
  // glyph island: space + 1–2 island chars + space, e.g. " C ", " dd "
  for (const g of [2, 1]) {
    if (doubled[idx - 1] === " " && doubled[idx - 2 - g] === " ") {
      let ok = true;
      for (let k = 2; k < 2 + g; k++) if (!ISLAND_CHARS.includes(doubled[idx - k])) ok = false;
      if (ok) return g + 2;
    }
  }
  let n = 0;
  while (n < 4 && doubled[idx - 1 - n] === " ") n++;
  return n;
}

interface Placed {
  tally: Tally;
  placements: { text: string; offset: number }[];
  dropped: string[];
}

/**
 * Place fragments on a shared column axis, each at its best-scoring offset.
 *
 * `reference` is what a placement is scored against: null for the first pass,
 * which scores against the tally it is building, or a finished tally for the
 * second. Votes always accumulate into the pass's OWN tally either way, so a
 * second pass never feeds its own placements back into the reference it is
 * being judged by.
 */
function placeFragments(frags: string[], reference: Tally | null): Placed {
  const tally = new Tally();
  const against = reference ?? tally;
  const placements: { text: string; offset: number }[] = [];
  const dropped: string[] = [];
  let lastOffset = 0;
  for (let i = 0; i < frags.length; i++) {
    const f = frags[i];
    // The first pass has nothing to score against until something is placed, so
    // frame 0 anchors the axis at 0. The second has the whole consensus and
    // scores frame 0 like any other.
    if (reference === null && i === 0) {
      tally.addFragment(f, 0);
      placements.push({ text: f, offset: 0 });
      continue;
    }
    let best: { offset: number; matches: number; overlap: number } | null = null;
    for (let s = lastOffset - SEARCH_BACK; s <= lastOffset + SEARCH_FWD; s++) {
      const { matches, overlap } = scorePlacement(against, f, s);
      if (overlap < MIN_OVERLAP) continue;
      const score = matches * 2 - overlap; // matches - mismatches
      const bestScore = best ? best.matches * 2 - best.overlap : -Infinity;
      if (score > bestScore) best = { offset: s, matches, overlap };
    }
    if (best && best.matches >= MIN_MATCHES && best.matches >= MIN_MATCH_RATIO * best.overlap) {
      tally.addFragment(f, best.offset);
      placements.push({ text: f, offset: best.offset });
      lastOffset = best.offset;
    } else {
      dropped.push(f);
    }
  }
  return { tally, placements, dropped };
}

/**
 * Stitch one alignment of one burst. `stitch` below is what callers want: this
 * assumes every fragment is a window onto the SAME credit.
 */
function stitchAligned(fragments: string[]): StitchResult {
  const frags = fragments
    .map((f) => f.replace(/[\r\n]+/g, " ").trimEnd())
    .filter((f) => f.trim().length >= MIN_FRAGMENT_LEN);

  if (frags.length < MIN_FRAGMENTS) {
    return { unit: null, confident: false, reason: "too_few_fragments", droppedFragments: frags };
  }

  /*
   * 1. Place fragments on a shared axis by best overlap, twice: the first pass
   *    scores each fragment against whatever happened to be placed before it,
   *    so the early ones are judged by a nearly empty tally and the whole axis
   *    hangs off frame 0. The second scores every fragment against the finished
   *    consensus of the first, which is why it can place fragments the first
   *    dropped — and it is kept only if it places MORE of them, so a pass that
   *    goes worse cannot make the burst worse.
   */
  const first = placeFragments(frags, null);
  const second = placeFragments(frags, first.tally);
  const { tally, placements, dropped } =
    second.placements.length > first.placements.length ? second : first;
  if (placements.length < MIN_FRAGMENTS) {
    return { unit: null, confident: false, reason: "too_few_aligned", droppedFragments: dropped };
  }

  // 2. Linear consensus over all voted columns. Columns witnessed by a
  //    single fragment are span edges and OCR junk magnets — they carry no
  //    corroboration, so period detection ignores them.
  const colIndexes = [...tally.cols.keys()].sort((a, b) => a - b);
  const minCol = colIndexes[0];
  const maxCol = colIndexes[colIndexes.length - 1];
  const span = maxCol - minCol + 1;
  const consensus = new Array<{ char: string; voters: number } | null>(span).fill(null);
  for (let c = minCol; c <= maxCol; c++) {
    const top = tally.top(c);
    consensus[c - minCol] = top ? { char: top.char, voters: top.voters } : null;
  }

  // 3. Detect the marquee repeat period via best self-overlap.
  const ratios: { period: number; ratio: number }[] = [];
  for (let t = MIN_PERIOD; t <= Math.min(MAX_PERIOD, span - 10); t++) {
    let total = 0;
    let match = 0;
    for (let c = 0; c + t < span; c++) {
      const a = consensus[c];
      const b = consensus[c + t];
      if (!a || !b || a.voters < 2 || b.voters < 2) continue;
      total++;
      if (ciEq(a.char, b.char)) match++;
    }
    if (total >= MIN_PERIOD_SAMPLES) ratios.push({ period: t, ratio: match / total });
  }
  const bestRatio = ratios.reduce((m, r) => Math.max(m, r.ratio), 0);
  const periodPick = ratios.find((r) => r.ratio >= Math.max(MIN_PERIOD_RATIO, bestRatio - 0.05));
  if (!periodPick) {
    return { unit: null, confident: false, reason: "no_repeat_period", droppedFragments: dropped };
  }
  const foldPeriod = periodPick.period;

  // 4. Fold votes modulo the period so every unit position accumulates
  //    votes from all marquee repetitions.
  const folded = new Tally();
  for (const [col, votes] of tally.cols) {
    const p = (((col - minCol) % foldPeriod) + foldPeriod) % foldPeriod;
    for (const [ch, n] of votes) folded.add(p, ch, n);
  }
  const unitChars = new Array<string>(foldPeriod);
  const lowConf = new Set<number>();
  for (let p = 0; p < foldPeriod; p++) {
    const top = folded.top(p);
    unitChars[p] = top ? top.char : " ";
    if (!top || (top.voters >= 2 && !top.majority)) lowConf.add(p);
  }
  /*
   * A period detected at a multiple of the marquee's own folds whole copies of
   * the credit into one cyclic string. One copy is the unit; `lowConf` keeps its
   * positions from the fold, which is why the collapse keeps the FIRST copy —
   * its indexes are the ones those flags were recorded against.
   */
  const cyclic = collapseRepeats(unitChars.join(""));
  const period = cyclic.length;
  const doubled = cyclic + cyclic;
  const evaluate = (c: SeparatorCandidate) =>
    doubled.slice(c.start + c.len, c.start + period);

  // 5a. Pause anchors: consecutive near-identical frames mean the marquee
  //     held at the unit start — their aligned offset IS the rotation point.
  const anchorCands: SeparatorCandidate[] = [];
  const seenStarts = new Set<number>();
  for (let i = 1; i < placements.length; i++) {
    const a = placements[i - 1];
    const b = placements[i];
    if (
      Math.abs(a.offset - b.offset) <= 1 &&
      a.text.length >= PAUSE_TEXT_MIN_LEN &&
      editDistance(a.text, b.text) <= PAUSE_MAX_EDITS
    ) {
      const anchor = (((a.offset - minCol) % period) + period) % period;
      const len = sepLenBefore(doubled, anchor + period);
      if (len === 0) continue;
      const start = (((anchor - len) % period) + period) % period;
      if (seenStarts.has(start)) continue;
      seenStarts.add(start);
      anchorCands.push({ start, len });
    }
  }

  // 5b. Separator artifacts in the folded consensus.
  const glyphCands = [
    ...scanCandidates(doubled, period, SPACE_RUN),
    ...scanCandidates(doubled, period, JUNK_ISLAND),
  ].filter((c) => !seenStarts.has(c.start));
  const weakCands = scanCandidates(doubled, period, LETTER_ISLAND).filter(
    (c) => !seenStarts.has(c.start) && !glyphCands.some((g) => g.start === c.start),
  );

  // 5c. Pick the rotation: anchors and artifacts first; when the ♪ rendered
  //     as a plain single space there is no artifact, so fall back to any
  //     single-space cut that parses — reported, never silent.
  let pool = [...anchorCands, ...glyphCands].filter((c) => validUnit(evaluate(c)));
  let unanchored = false;
  if (pool.length === 0) pool = weakCands.filter((c) => validUnit(evaluate(c)));
  if (pool.length === 0) {
    unanchored = true;
    for (let p = 0; p < period; p++) {
      if (cyclic[p] !== " ") continue;
      const c = { start: p, len: 1 };
      if (validUnit(evaluate(c))) pool.push(c);
    }
  }
  if (pool.length === 0) {
    return { unit: null, confident: false, reason: "no_separator", droppedFragments: dropped };
  }
  const chosen = pool[0];
  const unit = evaluate(chosen);

  // Low-confidence columns inside the unit matter; ambiguity in the separator
  // region is expected (that's the ♪ glyph) and doesn't taint the unit.
  let unitLowConf = 0;
  for (let k = chosen.len; k < period; k++) {
    if (lowConf.has((chosen.start + k) % period)) unitLowConf++;
  }

  const uniqueStarts = new Set(pool.map((c) => c.start));
  const reasons: string[] = [];
  if (unanchored) reasons.push("unanchored_rotation");
  if (uniqueStarts.size > 1) reasons.push("ambiguous_separator");
  if (unitLowConf > 0) reasons.push(`no_majority_positions:${unitLowConf}`);
  if (dropped.length * 3 > frags.length) reasons.push("many_fragments_dropped");

  return {
    unit,
    confident: reasons.length === 0,
    reason: reasons.length > 0 ? reasons.join(",") : null,
    droppedFragments: dropped,
  };
}

/** Trigrams of a group of fragments, as one bag. */
function gramsOf(frags: string[]): Set<string> {
  const out = new Set<string>();
  for (const f of frags) {
    const t = normalize(f);
    for (let i = 0; i + SPLIT_GRAM <= t.length; i++) out.add(t.slice(i, i + SPLIT_GRAM));
  }
  return out;
}

/**
 * Where inside a straddled burst does the song change?
 *
 * Adjacent frames are the obvious place to look and the wrong one: OCR of this
 * marquee drops whole frames to noise, so consecutive-frame similarity has
 * minima all over a single-song burst — on 2026-08-26 it put fixture 12's
 * break at frame 14 or 26, when the song actually changes at 22.
 *
 * Judging the two SIDES instead is stable, because every frame votes. The cut
 * that splits the burst into its two songs is the one where the text before
 * shares least with the text after; within one song every cut still has both
 * sides reading the same credit, so the score stays high everywhere and no
 * transition is reported.
 *
 * Returns null when nothing looks like a transition — the burst is one song
 * that simply would not stitch, and cutting it is not the answer.
 */
function transitionIndex(frags: string[]): number | null {
  if (frags.length < 2 * SPLIT_MIN_SIDE) return null;
  let best: { cut: number; overlap: number } | null = null;
  for (let cut = SPLIT_MIN_SIDE; cut <= frags.length - SPLIT_MIN_SIDE; cut++) {
    const before = gramsOf(frags.slice(0, cut));
    const after = gramsOf(frags.slice(cut));
    if (before.size === 0 || after.size === 0) continue;
    let shared = 0;
    for (const g of before) if (after.has(g)) shared++;
    const overlap = shared / Math.min(before.size, after.size);
    if (best === null || overlap < best.overlap) best = { cut, overlap };
  }
  if (best === null || best.overlap > SPLIT_MAX_OVERLAP) return null;
  return best.cut;
}

/**
 * A burst can straddle a song change, and then nothing explains all of it: the
 * frames hold two different credits, the alignment is fighting itself, and the
 * period search finds nothing. That was 2026-08-26's largest remaining failure
 * class, and it is the one case where refusing costs the most — a transition is
 * exactly when the page most needs the new row.
 *
 * So the burst is retried on each half, the LATER one first: the tracker bursts
 * because the marquee changed, so the newer song is the one on air and the one
 * the row should carry.
 *
 * A half is weaker evidence than a whole burst — half the frames, and the cut is
 * arbitrary rather than placed at the transition — so it has to be cleaner: a
 * half that also could not align a third of its frames is refused. That bar is
 * what keeps `Owen Kelley — Tonkotsu (Re` off the row, a truncation this path
 * produced from a burst whose alignment had compressed at the loop wrap. It also
 * refuses reads that were correct, which is the trade this project keeps making
 * in that direction.
 */
export function stitch(fragments: string[]): StitchResult {
  const whole = stitchAligned(fragments);
  if (whole.unit !== null || fragments.length < 2 * MIN_FRAGMENTS) return whole;

  /*
   * The detected transition and the frames just after it, then the midpoint.
   * The midpoint stays as a fallback because a cut has to beat the noise floor
   * to be reported at all, and a burst whose transition is near the middle is
   * served by it anyway. Nothing here fires on a single-song burst: no
   * transition is detected, so only the midpoint is ever tried, exactly as
   * before.
   */
  const t = transitionIndex(fragments);
  const candidates: number[] = [];
  if (t !== null) {
    for (let d = 0; d <= SPLIT_GUARD_FRAMES; d += 2) {
      if (fragments.length - (t + d) >= SPLIT_MIN_SIDE) candidates.push(t + d);
    }
  }
  candidates.push(Math.floor(fragments.length / 2));
  const cuts = candidates.filter((c, i, a) => a.indexOf(c) === i);
  for (const cut of cuts) {
    // The LATER half first: the tracker bursts because the marquee changed, so
    // the newer song is the one on air and the one the row should carry.
    for (const half of [fragments.slice(cut), fragments.slice(0, cut)]) {
      const res = stitchAligned(half);
      if (res.unit === null || (res.reason ?? "").includes("many_fragments_dropped")) continue;
      // Never confident: the caller widens the dedup budget, and the journal gets
      // `burst_split` so a run of these is visible as what it is.
      return {
        ...res,
        confident: false,
        reason: [res.reason, "burst_split"].filter(Boolean).join(","),
      };
    }
  }
  return whole;
}
