import { describe, expect, test } from "bun:test";
import { editDistance, normalize, trimEdges } from "../src/normalize";

describe("normalize", () => {
  test("lowercases, collapses whitespace, trims", () => {
    expect(normalize("  Fields   of\tEthera ")).toBe("fields of ethera");
  });

  test("keeps em-dash and punctuation", () => {
    expect(normalize("Orions Belte — Manual Shear")).toBe("orions belte — manual shear");
  });
});

describe("trimEdges", () => {
  test("drops 2 chars from each end", () => {
    expect(trimEdges("xxorions beltezz")).toBe("orions belte");
  });

  test("re-trims whitespace exposed at the cut", () => {
    expect(trimEdges("a  middle  b")).toBe("middle");
  });

  test("returns empty for very short input", () => {
    expect(trimEdges("abcd")).toBe("");
    expect(trimEdges("abc")).toBe("");
  });
});

describe("editDistance", () => {
  test("identical strings", () => {
    expect(editDistance("same", "same")).toBe(0);
  });

  test("classic kitten/sitting", () => {
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  test("empty sides", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
  });

  test("OCR jitter on a raw unit is within the dedup budget", () => {
    expect(
      editDistance(
        normalize("Fields of Ethera — 02 - Boundless Horizons"),
        normalize("Fields of Etnera — 02 - Boundless Horizons"),
      ),
    ).toBeLessThanOrEqual(2);
  });
});
