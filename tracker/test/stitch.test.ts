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

describe("fixture 5 — unstitchable burst", () => {
  // Kept as a failing burst on purpose: it is what `burstStillShows` exists
  // for. If a stitcher improvement ever recovers this one, that is good news
  // and this test is the notice to go find another failure to hold the
  // fingerprint test honest.
  test("readable frames are not enough — the loop is unrecoverable", async () => {
    const frags = await loadFixture("fixture5-unstitchable-burst.txt");
    const res = stitch(frags);
    expect(res.unit).toBeNull();
    expect(res.reason).toContain("no_repeat_period");
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
  // Fixture 4 is a burst whose two loops span different column counts (jittery
  // scroll, dropped glyphs), so period detection reaches for their sum and the
  // stitched unit holds the song TWICE. It shipped that to the page on
  // 2026-08-23 as `Ben Seren n walls are humming Ben Seretan — walls are
  // humming`: the ` — ` count cannot catch it, because the rotation degrades
  // the duplicate separator and leaves exactly one.
  //
  // The assertion is the property, not a string: a unit may never contain the
  // song twice. Refusing is a fine outcome — the caller then falls back to the
  // best single fragment, which is closer to the truth than a doubled name.
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
