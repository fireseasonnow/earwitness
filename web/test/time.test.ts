import { afterAll, describe, expect, setSystemTime, test } from "bun:test";
import { amsTime, todayAms, todayDisplay, todayRangeUtc } from "../src/lib/time";
import { amsMidnightUtc } from "../../tracker/src/time";

/**
 * The Amsterdam day boundary is implemented TWICE — here and in
 * `tracker/src/time.ts` — deliberately: two packages, no shared module. The
 * last block is what guards the duplication: same instant from both, across a
 * full year.
 *
 * `amsMidnightUtc` is private here, so the solver is driven through
 * `todayRangeUtc` with the clock moved rather than exported to be testable.
 */

/** Amsterdam noon on `date` — safely inside the day whatever the offset. */
function atNoon(date: string): void {
  setSystemTime(new Date(`${date}T10:00:00.000Z`));
}

afterAll(() => setSystemTime());

describe("todayRangeUtc", () => {
  test("summer time: the day runs 22:00 UTC to 22:00 UTC", () => {
    atNoon("2026-08-22");
    expect(todayRangeUtc()).toEqual({
      startIso: "2026-08-21T22:00:00.000Z",
      endIso: "2026-08-22T22:00:00.000Z",
    });
  });

  test("winter time: the day runs 23:00 UTC to 23:00 UTC", () => {
    atNoon("2026-01-15");
    expect(todayRangeUtc()).toEqual({
      startIso: "2026-01-14T23:00:00.000Z",
      endIso: "2026-01-15T23:00:00.000Z",
    });
  });

  test("spring forward: a 23-hour day, not 24", () => {
    // 2026-03-29, 02:00 → 03:00 local. A fixed 24-hour offset would put the end
    // of the range an hour into the next day and render tomorrow's first plays.
    atNoon("2026-03-29");
    const { startIso, endIso } = todayRangeUtc();
    expect(startIso).toBe("2026-03-28T23:00:00.000Z");
    expect(endIso).toBe("2026-03-29T22:00:00.000Z");
    expect((Date.parse(endIso) - Date.parse(startIso)) / 3600e3).toBe(23);
  });

  test("fall back: a 25-hour day, not 24", () => {
    // 2026-10-25, 03:00 → 02:00 local. A fixed offset would cut the day an hour
    // early and silently drop the last hour of plays from the page.
    atNoon("2026-10-25");
    const { startIso, endIso } = todayRangeUtc();
    expect(startIso).toBe("2026-10-24T22:00:00.000Z");
    expect(endIso).toBe("2026-10-25T23:00:00.000Z");
    expect((Date.parse(endIso) - Date.parse(startIso)) / 3600e3).toBe(25);
  });

  test("the range is half-open, so a boundary instant belongs to one day only", () => {
    // `playsToday` filters with `>= start` and `< end`. A play stamped exactly
    // at midnight must appear once, on the day it starts — not twice, not never.
    atNoon("2026-08-22");
    const today = todayRangeUtc();
    atNoon("2026-08-23");
    const tomorrow = todayRangeUtc();
    expect(today.endIso).toBe(tomorrow.startIso);
  });

  test("just before midnight is still yesterday", () => {
    // 21:59:59 UTC on 21 Aug is 23:59:59 Amsterdam — the last second of the 21st.
    setSystemTime(new Date("2026-08-21T21:59:59.000Z"));
    expect(todayAms()).toBe("2026-08-21");
    setSystemTime(new Date("2026-08-21T22:00:00.000Z"));
    expect(todayAms()).toBe("2026-08-22");
  });
});

describe("display formatting", () => {
  test("stored UTC renders as Amsterdam wall time, offset and all", () => {
    expect(amsTime("2026-08-23T09:41:12.000Z")).toBe("11:41 AM"); // CEST, +2
    expect(amsTime("2026-01-15T09:41:12.000Z")).toBe("10:41 AM"); // CET,  +1
  });

  test("the two noon/midnight traps read correctly", () => {
    // 12-hour clocks get these wrong more often than any other value: midnight
    // is 12 AM (not 00 or 12 PM) and midday is 12 PM (not 00 PM).
    expect(amsTime("2026-08-21T22:00:00.000Z")).toBe("12:00 AM"); // 00:00 Ams
    expect(amsTime("2026-08-22T10:00:00.000Z")).toBe("12:00 PM"); // 12:00 Ams
    expect(amsTime("2026-08-22T11:00:00.000Z")).toBe("01:00 PM"); // 13:00 Ams
  });

  test("every reading is exactly eight characters", () => {
    // The log's time column is a fixed width sized off this. A single-digit
    // hour under `hour: "numeric"` would render seven and break the alignment,
    // so the padding is a layout contract, not a preference.
    const samples = [
      "2026-08-23T05:41:12.000Z", // 07:41 AM — single-digit hour
      "2026-08-23T09:41:12.000Z", // 11:41 AM
      "2026-08-21T22:00:00.000Z", // 12:00 AM
      "2026-08-23T20:30:00.000Z", // 10:30 PM
    ];
    for (const iso of samples) {
      expect(amsTime(iso), iso).toMatch(/^\d{2}:\d{2} [AP]M$/);
      expect(amsTime(iso)).toHaveLength(8);
    }
  });

  test("the header date is compact and carries no year", () => {
    atNoon("2026-08-22");
    const shown = todayDisplay();
    expect(shown).toBe("Sat 22 Aug");
    expect(shown).not.toContain("2026");
  });
});

/**
 * The guard the duplication actually needs.
 *
 * Testing each copy against hand-written expectations proves each is
 * self-consistent; it does not prove they agree. They must: the tracker prunes
 * everything before ITS midnight, and the page renders everything inside THIS
 * one. A drift of an hour between them means the page hides plays the tracker
 * is still keeping, twice a year, for one hour — and it would look like a
 * tracker bug from every angle except this test.
 */
describe("both packages agree on where the day starts", () => {
  test("every day of 2026, including both DST transitions", () => {
    const disagreements: string[] = [];
    const cursor = new Date("2026-01-01T12:00:00.000Z");

    for (let i = 0; i < 365; i++) {
      const date = cursor.toISOString().slice(0, 10);
      setSystemTime(new Date(`${date}T10:00:00.000Z`));
      const web = todayRangeUtc().startIso;
      const tracker = amsMidnightUtc(date).toISOString();
      if (web !== tracker) disagreements.push(`${date}: web ${web} vs tracker ${tracker}`);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    expect(disagreements).toEqual([]);
  });

  test("the comparison is real — it would catch a fixed-offset regression", () => {
    // A guard that cannot fail is decoration. A 24-hour offset from the start of
    // one day does NOT land on the start of the next across a DST transition,
    // which is exactly the bug the solver in both copies exists to avoid.
    const springForward = amsMidnightUtc("2026-03-29").getTime();
    const naiveNextDay = springForward + 24 * 3600e3;
    expect(amsMidnightUtc("2026-03-30").getTime()).not.toBe(naiveNextDay);
  });
});
