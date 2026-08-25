import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStateDir } from "@earwitness/shared";

// All capture constants were measured live (see README).
// Do not re-derive them; if the overlay ever moves, re-locate the crop with
// the full-frame command in the README and update `crop` here.
export const CONFIG = {
  livePageUrl: "https://www.youtube.com/@claude/live",
  crop: "crop=520:70:1390:30", // credit ticker at 1080p

  tickIntervalMs: 30_000,
  // Must cover one full marquee loop INCLUDING the ~1-2 s hold at the unit
  // start: loop ≈ unitLen/4 + pause. Live units reach ~55 chars → 18 s.
  burstSeconds: 18,
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

  // `yt-dlp -g` returns a media-playlist URL, not a durable stream URL: it is a
  // snapshot of a sliding window of 2 s segments and stops working after ~25-30 s
  // ("Error when loading first segment"), whatever the 6 h expiry in its
  // signature claims. Keep this WELL under the tick interval or every tick
  // pays a failed capture before re-resolving.
  urlMaxAgeMs: 20_000,
  emptyOcrThreshold: 3, // consecutive empty ticks before one log line

  minTickTextLen: 5, // shorter raw OCR output counts as an empty frame
  fuzzyMaxEdits: 2, // fingerprint fuzzy-substring budget
  creditDedupMaxEdits: 2, // credit dedup budget

  // Forensics live in the journal, not in a stored trail, so there
  // is no trail size to configure here. Set SystemMaxUse generously on the host:
  // the journal is the only record, and it is bounded by size, not by count.
  // EARWITNESS_STATE names a DIRECTORY holding plays.json and live.flag. Its
  // default lives in the shared module, because the web app must resolve the
  // same one and a copy is an agreement nothing enforces.
  stateDir: resolveStateDir(),
  frameDir: join(tmpdir(), "earwitness-frames"),

  // A working single-frame grab takes under 3 s (measured 0.7-2.9 s). This only
  // bounds the pathological case, so it must stay small: a generous timeout here
  // is spent in full on every failure and silently eats the tick.
  captureTimeoutMs: 15_000,
  burstTimeoutMs: 60_000, // 18 s burst (burstSeconds) incl. HLS startup
  resolveTimeoutMs: 60_000, // yt-dlp
} as const;
