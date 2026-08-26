import { describe, expect, test } from "bun:test";
import {
  buildReferences,
  burstStillShows,
  fuzzySubstringDistance,
  isSameSong,
  marqueeStillReads,
} from "../src/fingerprint";
import { loadFixture } from "./helpers";

describe("fuzzySubstringDistance", () => {
  test("exact substring costs 0", () => {
    expect(fuzzySubstringDistance("belte — man", "orions belte — manual shear")).toBe(0);
  });

  test("one substitution costs 1", () => {
    expect(fuzzySubstringDistance("belte - man", "orions belte — manual shear")).toBe(1);
  });

  test("unrelated text costs a lot", () => {
    expect(
      fuzzySubstringDistance("a message for cynthia", "orions belte — manual shear"),
    ).toBeGreaterThan(2);
  });
});

describe("buildReferences", () => {
  test("doubles the unit with and without the ♪ separator", () => {
    expect(buildReferences("Orions Belte — Manual Shear")).toEqual([
      "orions belte — manual shear ♪ orions belte — manual shear",
      "orions belte — manual shear orions belte — manual shear",
    ]);
  });
});

describe("fixture 3 — change detection", () => {
  const currentUnit = "Orions Belte — Manual Shear";

  test("frames 1–8 fingerprint-match the current song", async () => {
    const lines = await loadFixture("fixture3-transition.txt");
    for (const line of lines.slice(0, 8)) {
      expect(isSameSong(line, currentUnit)).toBe(true);
    }
  });

  test("frame 9 (the transition) does not match", async () => {
    const lines = await loadFixture("fixture3-transition.txt");
    expect(isSameSong(lines[8], currentUnit)).toBe(false);
  });

  test("the new song's frames do not match the old unit", async () => {
    const lines = await loadFixture("fixture3-transition.txt");
    for (const line of lines.slice(8)) {
      expect(isSameSong(line, currentUnit)).toBe(false);
    }
  });
});

describe("isSameSong edge cases", () => {
  test("very short OCR text never matches", () => {
    expect(isSameSong("dd |", "Orions Belte — Manual Shear")).toBe(false);
  });
});

describe("burstStillShows — confirming from a burst the stitcher rejected", () => {
  const currentUnit = "Owen Kelley — Tonkotsu (Reloaded)";

  test("the tail of the unstitchable burst confirms the current song", async () => {
    // 12 of these 59 real frames match inside the tick budget, the last by one edit.
    const frags = await loadFixture("fixture5-unstitchable-burst.txt");
    expect(burstStillShows(frags, currentUnit, 20)).toBe(true);
  });

  test("a burst of another song does not confirm it", async () => {
    const frags = await loadFixture("fixture2-clean-stitch.txt");
    expect(burstStillShows(frags, currentUnit, 20)).toBe(false);
  });

  test("frames before fixture 3's transition at frame 9 cannot confirm the song that ended", async () => {
    const lines = await loadFixture("fixture3-transition.txt");
    const oldUnit = "Orions Belte — Manual Shear";
    expect(burstStillShows(lines, oldUnit, lines.length)).toBe(true);
    expect(burstStillShows(lines, oldUnit, lines.length - 8)).toBe(false);
  });

  test("a tail longer than the burst is the burst, not an error", async () => {
    const frags = await loadFixture("fixture5-unstitchable-burst.txt");
    expect(burstStillShows(frags, currentUnit, 500)).toBe(true);
  });
});

describe("marqueeStillReads — is the failed burst's song still on screen?", () => {
  const RATIO = 0.4; // CONFIG.cooldownMatchRatio

  test("most frames of a burst read as that same burst", async () => {
    /*
     * Held out one at a time, so nothing matches itself. This is the property
     * the burst backoff needs: while the unstitchable song is still playing,
     * ticks keep landing on it and the cooldown keeps being served.
     *
     * MOST, not all — and the bar is deliberately well under what was measured.
     * Same-song frames scored 0.54 at p90 against the rest of their own burst
     * on 2026-08-26, so roughly 85% clear a 0.40 ratio; 0.6 leaves room for a
     * noisier burst than fixture 5 without going green on a broken matcher.
     * A miss here costs one wasted re-burst, which is the cheap direction.
     */
    const frags = await loadFixture("fixture5-unstitchable-burst.txt");
    const hits = frags.filter((f, i) =>
      marqueeStillReads(f, frags.filter((_, j) => j !== i), RATIO),
    ).length;
    expect(hits / frags.length).toBeGreaterThan(0.6);
  });

  test("no frame of a DIFFERENT song reads as it", async () => {
    // The half of the asymmetry that matters: a song the tracker has not read
    // must never be mistaken for the one that failed, or the backoff goes on
    // suppressing bursts through a song change and the play is lost.
    const failed = await loadFixture("fixture5-unstitchable-burst.txt");
    const others = [
      ...(await loadFixture("fixture12-late-transition.txt")).slice(22),
      ...(await loadFixture("fixture6-long-credit.txt")),
      ...(await loadFixture("fixture2-clean-stitch.txt")),
    ];
    expect(others.some((f) => marqueeStillReads(f, failed, RATIO))).toBe(false);
  });

  test("no fragments to compare against is not a match", () => {
    expect(marqueeStillReads("Orions Belte — Manual Shear", [], RATIO)).toBe(false);
  });

  test("too little text to trust is not a match", async () => {
    const frags = await loadFixture("fixture5-unstitchable-burst.txt");
    expect(marqueeStillReads("Owen", frags, RATIO)).toBe(false);
  });
});
