import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStateDir } from "@earwitness/shared";

// All capture constants were measured live (see README).
// Do not re-derive them; if the overlay ever moves, re-locate the crop with
// the full-frame command in the README and update `crop` here.
export const CONFIG = {
  livePageUrl: "https://www.youtube.com/@claude/live",
  /**
   * The credit ticker at 1080p — a band around the text line, and no taller.
   *
   * The stream is an animated scene, and its dotted halftone terrain DRIFTS
   * THROUGH this band from below. When it reaches the crop, tesseract reads the
   * dots as characters and the fragment becomes junk ("iy ait Nodes nt k"); a
   * burst peppered with those loses its repeat period, and the junk frames also
   * fail to align, which pushes an otherwise good half over the
   * `many_fragments_dropped` bar. Filtering cannot undo it — measured
   * 2026-08-26, threshold, median, erosion, opening and removegrain all left a
   * polluted frame unreadable (best 11% recovered, against 6% for no filter at
   * all), because the dots are a dense structured band and not sparse noise.
   * Geometry is the only lever: keep them out.
   *
   * Measured over 300 frames that day: the glyphs live in y 52-82 and the
   * terrain tops out at y 106. This is y 42-87 — ten rows above the tallest
   * glyph seen, five below the deepest descender, and 19 rows of clearance
   * under the bottom edge where the old crop (y 30-99) had 7. The top margin is
   * free, so it stays generous: nothing intrudes from above. On identical
   * recorded frames spanning three songs this read 150/150 against the old
   * crop's 146/150.
   *
   * If the overlay ever moves, re-derive BOTH bounds — the glyph envelope and
   * the terrain's reach — with the row-profile command in the README. Do not
   * simply re-centre on the text.
   */
  crop: "crop=520:46:1390:42", // credit ticker at 1080p

  tickIntervalMs: 30_000,
  /*
   * Must cover TWO full marquee loops, not one. Period detection folds votes
   * modulo the period, so a burst covering 1.26 loops leaves only the overlap
   * columns with a second sample — ~15, exactly MIN_PERIOD_SAMPLES, which is
   * why no_repeat_period dominated on long credits and never appeared on short
   * ones. Measured 2026-08-25: the marquee scrolls ~4 chars/s, so a 49-char
   * unit ("Siren and the Sea — 10 - The Large Floating Vessel") loops in ~14 s
   * including the hold.
   *
   * Credits run longer than the ~55 chars this comment used to assume: the
   * longest seen is 67 ("Ben Seretan — criss cross applesauce right in the
   * stream of the amp"), looping every ~70 columns. A 30 s burst spans ~146
   * columns of that marquee — measured, not derived — so it still clears two
   * loops at the top of the range. Lengthen this before raising MAX_PERIOD in
   * `stitch.ts` any further, or the period search will outrun the evidence.
   */
  burstSeconds: 30,
  /**
   * Two frames a second, not one.
   *
   * At 1 fps an 18 s burst covers an ~11 s marquee loop less than twice, and
   * `no_repeat_period` — the stitcher failing to find the loop at all — was the
   * dominant failure on 2026-08-25: six in a session, on songs whose fragments
   * were plainly readable ("Seretan — criss cross applesauce"). Period
   * detection needs samples, not legibility, and this doubles them without
   * lengthening the burst. The cost is 36 tesseract calls per burst instead of
   * 18, on the ~15% burst path only.
   */
  burstFps: 2,

  /**
   * How much of a burst's TAIL may confirm the song already on the row when the
   * stitch FAILS (`burstStillShows`).
   *
   * Ten seconds, so the frames that vote are no older than the tick frame the
   * cheap path confirms from (~4 s: one capture plus one OCR). Longer would
   * reach back into a burst that may straddle a song change and let the
   * outgoing song confirm itself; shorter throws away readable frames for
   * nothing. Multiplied by `burstFps`, never written as a frame count, so
   * changing the capture rate cannot silently change the window.
   */
  confirmTailSeconds: 10,

  /*
   * `yt-dlp -g` returns a media-playlist URL, not a durable stream URL: it is a
   * snapshot of a sliding window of 2 s segments and stops working after ~25-30 s
   * ("Error when loading first segment"), whatever the 6 h expiry in its
   * signature claims. Keep this WELL under the tick interval or every tick
   * pays a failed capture before re-resolving.
   */
  urlMaxAgeMs: 20_000,
  emptyOcrThreshold: 3, // consecutive empty ticks before one log line

  /**
   * How closely a tick must match a FAILED burst's frames to count as the same
   * song, as a ratio of edit distance to length (`marqueeStillReads`).
   *
   * This gates the burst backoff, and the two errors are not symmetric: too
   * high and a genuine song change is mistaken for the unstitchable song still
   * playing, which is the failure that cost 122 minutes of blindness on
   * 2026-08-26; too low and a pathological song is re-burst a few extra times,
   * which costs CPU on the ~15% burst path and nothing else. Measured
   * cross-song minimum that day was 0.43, so this sits below it.
   */
  cooldownMatchRatio: 0.4,

  minTickTextLen: 5, // shorter raw OCR output counts as an empty frame
  fuzzyMaxEdits: 2, // fingerprint fuzzy-substring budget
  creditDedupMaxEdits: 2, // credit dedup budget

  /*
   * Forensics live in the journal, not in a stored trail, so there
   * is no trail size to configure here. Set SystemMaxUse generously on the host:
   * the journal is the only record, and it is bounded by size, not by count.
   * EARWITNESS_STATE names a DIRECTORY holding plays.json and live.flag. Its
   * default lives in the shared module, because the web app must resolve the
   * same one and a copy is an agreement nothing enforces.
   */
  stateDir: resolveStateDir(),
  frameDir: join(tmpdir(), "earwitness-frames"),

  // A working single-frame grab takes under 3 s (measured 0.7-2.9 s). This only
  // bounds the pathological case, so it must stay small: a generous timeout here
  // is spent in full on every failure and silently eats the tick.
  captureTimeoutMs: 15_000,
  burstTimeoutMs: 90_000, // 30 s burst (burstSeconds) incl. HLS startup

  /**
   * Wall-clock budget for OCR'ing a burst's frames — the phase that had no
   * bound at all.
   *
   * `burstTimeoutMs` above covers only the ffmpeg capture. The OCR that follows
   * is `burstSeconds * burstFps` (60) sequential tesseract calls, each allowed
   * 20 s of its own, so a single tick could legally run twenty minutes. Nothing
   * threw while it did, so nothing reached the journal: on 2026-08-26 a loaded
   * host turned one tick into a 7 min 39 s blackout with not a line logged, and
   * a song change inside it was reported eight minutes late. Any CPU pressure
   * reproduces it — an upgrade, a backup, thermal throttling on this box.
   *
   * 45 s is five times what the work actually takes: measured that day, 152 ms
   * a frame on an idle host, so a full 60-frame burst OCRs in ~9 s. Past the
   * budget the loop stops and stitches from what it has, which the stitcher
   * supports down to MIN_FRAGMENTS.
   *
   * The size is chosen against the PAGE, not the work: the web app calls the
   * tracker offline after 3 minutes without a heartbeat, and the heartbeat is
   * stamped at tick start. Capture (90 s) + this budget (45 s) + the final
   * frame's own timeout (20 s) is 155 s, so even a worst-case burst tick stays
   * inside that window and "no heartbeat" keeps meaning a dead tracker rather
   * than a slow one. Raising this above ~60 s breaks that and should not be
   * done without moving STALE_MS with it.
   */
  burstOcrBudgetMs: 45_000,
  resolveTimeoutMs: 60_000, // yt-dlp
} as const;
