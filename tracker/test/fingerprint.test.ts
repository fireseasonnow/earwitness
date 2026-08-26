import { describe, expect, test } from "bun:test";
import {
  buildReferences,
  burstStillShows,
  fuzzySubstringDistance,
  isSameSong,
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
