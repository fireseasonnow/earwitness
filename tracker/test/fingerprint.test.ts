import { describe, expect, test } from "bun:test";
import { buildReferences, fuzzySubstringDistance, isSameSong } from "../src/fingerprint";
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
