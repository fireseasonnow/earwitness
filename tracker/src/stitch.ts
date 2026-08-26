/**
 * Burst stitcher: turns ~14 OCR'd marquee fragments into ONE canonical
 * `Artist — Title` unit.
 *
 * Pipeline: align fragments on a shared axis by best overlap → per-column
 * majority vote → detect the marquee repeat period → fold votes modulo the
 * period → rotate the cyclic unit at the loop boundary.
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
import { editDistance } from "./normalize";

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
const SEARCH_BACK = 2; // offsets searched behind the previous fragment's start
const SEARCH_FWD = 16; // ahead (≈4 chars/frame at 1 fps, wide slack)
const MIN_PERIOD = 16;
const MAX_PERIOD = 64;
// Heavy-noise songs rarely exceed ~0.7 self-agreement even when the period is
// right; anything mis-detected is still caught by the confidence gates.
const MIN_PERIOD_SAMPLES = 15;
const MIN_PERIOD_RATIO = 0.68;
const PAUSE_TEXT_MIN_LEN = 15;
// Scaled with `burstFps`. The real gate is the offset test below (mid-scroll
// frames sit ~2 columns apart at 2 fps, ~4 at 1 fps, and must be within 1 to
// anchor), but this budget has to stay proportional to it: at 1 fps consecutive
// frames were ~8+ edits apart and 4 was slack, while at 2 fps they are ~4 apart
// and 4 would sit exactly on a mid-scroll pair. A real pause holds the same text
// for 2-4 frames, so 2 still clears it comfortably.
const PAUSE_MAX_EDITS = 2;

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
 * True when the unit is two marquee repetitions, not one — a period detected at
 * a multiple of the truth.
 *
 * The ` — ` count below is supposed to catch that and cannot: a rotation that
 * lands on the separator strips the leading space off the duplicate
 * (`— walls are humming Ben Seretan — walls are humming`), and heavy OCR noise
 * degrades it outright (` n ` for `an — `), leaving exactly one ` — ` in a
 * string holding the song twice. Comparing the halves does not care how the
 * second separator was mangled.
 */
function looksDoubled(unit: string): boolean {
  if (unit.length < 20) return false;
  const half = Math.floor(unit.length / 2);
  const budget = Math.max(2, Math.round(0.3 * half)); // OCR mangles one copy
  return editDistance(unit.slice(0, half), unit.slice(unit.length - half)) <= budget;
}

/** A rotation is plausible only if it reads as a single `Artist — Title`. */
function validUnit(unit: string): boolean {
  return (
    unit.length >= 10 &&
    countOccurrences(unit, " — ") === 1 &&
    !SPACE_RUN.test(unit) &&
    !JUNK_ISLAND.test(unit) &&
    !/^\s|\s$/.test(unit) &&
    !looksDoubled(unit)
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

export function stitch(fragments: string[]): StitchResult {
  const frags = fragments
    .map((f) => f.replace(/[\r\n]+/g, " ").trimEnd())
    .filter((f) => f.trim().length >= MIN_FRAGMENT_LEN);

  if (frags.length < MIN_FRAGMENTS) {
    return { unit: null, confident: false, reason: "too_few_fragments", droppedFragments: frags };
  }

  // 1. Place fragments on a shared axis by best overlap against everything
  //    placed so far (more robust than strictly consecutive pairs).
  const tally = new Tally();
  const placements: { text: string; offset: number }[] = [];
  const dropped: string[] = [];
  let lastOffset = 0;
  for (let i = 0; i < frags.length; i++) {
    const f = frags[i];
    if (i === 0) {
      tally.addFragment(f, 0);
      placements.push({ text: f, offset: 0 });
      continue;
    }
    let best: { offset: number; matches: number; overlap: number } | null = null;
    for (let s = lastOffset - SEARCH_BACK; s <= lastOffset + SEARCH_FWD; s++) {
      const { matches, overlap } = scorePlacement(tally, f, s);
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
  const period = periodPick.period;

  // 4. Fold votes modulo the period so every unit position accumulates
  //    votes from all marquee repetitions.
  const folded = new Tally();
  for (const [col, votes] of tally.cols) {
    const p = (((col - minCol) % period) + period) % period;
    for (const [ch, n] of votes) folded.add(p, ch, n);
  }
  const unitChars = new Array<string>(period);
  const lowConf = new Set<number>();
  for (let p = 0; p < period; p++) {
    const top = folded.top(p);
    unitChars[p] = top ? top.char : " ";
    if (!top || (top.voters >= 2 && !top.majority)) lowConf.add(p);
  }
  const cyclic = unitChars.join("");
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
