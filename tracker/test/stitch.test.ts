import { describe, expect, test } from "bun:test";
import { stitch } from "../src/stitch";
import { loadFixture } from "./helpers";

describe("fixture 1 — hard stitch (noisy burst)", () => {
  test("emits the canonical unit despite heavy OCR noise", async () => {
    const frags = await loadFixture("fixture1-hard-stitch.txt");
    const res = stitch(frags);
    expect(res.unit).toBe("Fields of Ethera — 02 - Boundless Horizons");
  });
});

describe("fixture 2 — clean stitch", () => {
  test("emits the canonical unit with confidence", async () => {
    const frags = await loadFixture("fixture2-clean-stitch.txt");
    const res = stitch(frags);
    expect(res.unit).toBe("Orions Belte — Manual Shear");
    expect(res.confident).toBe(true);
  });
});

describe("fixture 3 — burst after the transition", () => {
  test("stitches the new song from the post-transition frames", async () => {
    const lines = await loadFixture("fixture3-transition.txt");
    const res = stitch(lines.slice(8));
    expect(res.unit).toBe("Aedh — A Message For Cynthia");
  });
});

describe("the credit's own length — both period bounds were measured too narrow", () => {
  test("fixture 6 — a 67-character credit loops past the old ceiling of 64", async () => {
    const frags = await loadFixture("fixture6-long-credit.txt");
    expect(stitch(frags).unit).toBe(
      "Ben Seretan — criss cross applesauce right in the stream of the amp",
    );
  });

  test("fixture 7 — a 14-character credit loops under the old floor of 16", async () => {
    const frags = await loadFixture("fixture7-short-credit.txt");
    expect(stitch(frags).unit).toBe("Grabek — three");
  });

  test("fixture 8 — the ♪ renders as nothing then as '-', so the copies inside the period are 19 and 21 columns", async () => {
    const frags = await loadFixture("fixture8-alternating-separator.txt");
    expect(stitch(frags).unit).toBe("Passport — Reunion");
  });
});

describe("fixture 9 — a fold holding the song three times, one copy mangled", () => {
  test("it parses as a credit and is still refused", async () => {
    const frags = await loadFixture("fixture9-smeared-repeat.txt");
    expect(stitch(frags).unit).toBeNull();
  });

  test("the same shape built by hand is refused too", () => {
    const one = "Ardley — 01 - Dawn Hour";
    const doubled = `${one} ${one.replace("01", "1M").replace("Hour", "ro")}`;
    const frags = Array.from({ length: 20 }, (_, i) => (doubled + " " + doubled).slice(i, i + 28));
    expect(stitch(frags).unit).not.toBe(doubled);
  });
});

describe("fixture 5 — unstitchable burst", () => {
  // Kept failing on purpose: the fingerprint test confirms from this burst.
  test("readable frames are not enough — the loop is unrecoverable", async () => {
    const frags = await loadFixture("fixture5-unstitchable-burst.txt");
    const res = stitch(frags);
    expect(res.unit).toBeNull();
    expect(res.reason).toContain("no_repeat_period");
  });
});

describe("a burst that straddles a song change", () => {
  test("fixture 10 — half is `criss cross applesauce`, half is `Fiddleheads Unfurling`", async () => {
    const frags = await loadFixture("fixture10-transition-burst.txt");
    const res = stitch(frags);
    // The later half: the tracker bursts because the marquee changed.
    expect(res.unit).toBe("Parker Tichko — Fiddleheads Unfurling");
    expect(res.reason).toContain("burst_split");
    expect(res.confident).toBe(false);
  });

  test("fixture 11 — a half that drops a third of its frames is refused", async () => {
    // Recovers as "Owen Kelley — Tonkotsu (Re" without the bar: the alignment
    // compressed at the loop wrap and the fold came out a period short.
    const frags = await loadFixture("fixture11-compressed-wrap.txt");
    expect(stitch(frags).unit).toBeNull();
  });

  test("a burst too short to halve is left alone", () => {
    expect(stitch(["Grabek — three Grabek", "abek — three Grabek —"]).unit).toBeNull();
  });
});

describe("robustness", () => {
  test("empty and whitespace-only fragments are dropped", async () => {
    const frags = await loadFixture("fixture2-clean-stitch.txt");
    const res = stitch(["", "   ", ...frags, "\n"]);
    expect(res.unit).toBe("Orions Belte — Manual Shear");
  });

  test("too few fragments fails instead of guessing", () => {
    const res = stitch(["Orions Belte — Manual", "ions Belte — Manual Sh"]);
    expect(res.unit).toBeNull();
    expect(res.confident).toBe(false);
    expect(res.reason).toBe("too_few_fragments");
  });

  test("incoherent fragments fail instead of guessing", () => {
    const res = stitch([
      "aaaa bbbb cccc dddd",
      "zzzz yyyy xxxx wwww",
      "1111 2222 3333 4444",
      "qqqq rrrr ssss tttt",
      "mmmm nnnn oooo pppp",
    ]);
    expect(res.unit).toBeNull();
    expect(res.confident).toBe(false);
  });
});

describe("double-period rotations", () => {
  /*
   * Fixture 4 is a burst whose two loops span different column counts (jittery
   * scroll, dropped glyphs), so period detection reaches for their sum and the
   * stitched unit holds the song TWICE. It shipped that to the page on
   * 2026-08-23 as `Ben Seren n walls are humming Ben Seretan — walls are
   * humming`: the ` — ` count cannot catch it, because the rotation degrades
   * the duplicate separator and leaves exactly one.
   *
   * The assertion is the property, not a string: a unit may never contain the
   * song twice. Refusing is a fine outcome.
   */
  const timesRepeated = (unit: string | null): number =>
    unit === null ? 0 : (unit.toLowerCase().match(/humming/g) ?? []).length;

  test("a burst with mismatched loop widths never emits the song twice", async () => {
    const frags = await loadFixture("fixture4-double-period.txt");
    const res = stitch(frags);
    expect(timesRepeated(res.unit)).toBeLessThan(2);
    expect(res.confident).toBe(false);
  });

  test("a tape that is literally two repetitions is refused", () => {
    const twice = "— walls are humming Ben Seretan — walls are humming Ben Seretan";
    const frags = Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: 40 }, (_, k) => twice[(i * 4 + k) % twice.length]).join(""),
    );
    expect(timesRepeated(stitch(frags).unit)).toBeLessThan(2);
  });
});
