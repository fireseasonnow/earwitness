import { describe, expect, test } from "bun:test";
import { AMSTERDAM, clock } from "../src/lib/time";

/**
 * One clock, two places it runs: the server, named "Europe/Amsterdam", and the
 * reader's browser, in whatever zone it reports. The zones below stand in for
 * readers; the last block proves the function still runs once it is cut loose
 * from this module, which is how the browser gets it.
 */

const LA = clock("America/Los_Angeles");
const AUCKLAND = clock("Pacific/Auckland");

const at = (iso: string) => new Date(iso);

describe("dayStart — where a day begins, per zone", () => {
  test("Amsterdam summer and winter", () => {
    expect(AMSTERDAM.dayStart(at("2026-08-22T10:00:00Z")).toISOString()).toBe("2026-08-21T22:00:00.000Z");
    expect(AMSTERDAM.dayStart(at("2026-01-15T10:00:00Z")).toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  test("Amsterdam spring forward: the next day starts 23 hours later, not 24", () => {
    const start = AMSTERDAM.dayStart(at("2026-03-29T10:00:00Z"));
    const next = AMSTERDAM.dayStart(at("2026-03-30T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect((next.getTime() - start.getTime()) / 3600e3).toBe(23);
  });

  test("Amsterdam fall back: 25 hours", () => {
    const start = AMSTERDAM.dayStart(at("2026-10-25T10:00:00Z"));
    const next = AMSTERDAM.dayStart(at("2026-10-26T10:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect((next.getTime() - start.getTime()) / 3600e3).toBe(25);
  });

  test("a reader behind Amsterdam: Los Angeles", () => {
    // 15:00 UTC on 11 Nov is 07:00 in LA, whose day began at 08:00 UTC.
    expect(LA.dayStart(at("2026-11-11T15:00:00Z")).toISOString()).toBe("2026-11-11T08:00:00.000Z");
  });

  test("a reader twelve hours ahead of Amsterdam: Auckland", () => {
    // 15:00 UTC on 11 Nov is 04:00 on the 12th there, which began at 11:00 UTC.
    expect(AUCKLAND.dayStart(at("2026-11-11T15:00:00Z")).toISOString()).toBe("2026-11-11T11:00:00.000Z");
    // 10:59 UTC on the 12th is 23:59 there — the oldest a current day gets.
    expect(AUCKLAND.dayStart(at("2026-11-12T10:59:00Z")).toISOString()).toBe("2026-11-11T11:00:00.000Z");
  });

  test("where clocks skip midnight itself, the day begins at the end of the gap", () => {
    // Havana springs 00:00 → 01:00 on 8 Mar 2026, the Azores on 29 Mar.
    expect(clock("America/Havana").dayStart(at("2026-03-08T15:00:00Z")).toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(clock("Atlantic/Azores").dayStart(at("2026-03-29T15:00:00Z")).toISOString()).toBe(
      "2026-03-29T01:00:00.000Z",
    );
  });

  test("the instant a day begins belongs to that day", () => {
    const start = AMSTERDAM.dayStart(at("2026-08-22T10:00:00Z"));
    expect(AMSTERDAM.dayStart(start).getTime()).toBe(start.getTime());
    expect(AMSTERDAM.date(new Date(start.getTime() - 1))).toBe("2026-08-21");
  });

  test("the runtime's own zone and the solver agree", () => {
    // The browser takes the Date-constructor branch; the server takes the
    // solver. Here both run in one zone, and must land on one instant.
    const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const named = clock(own);
    const local = clock();
    const cursor = new Date("2026-01-01T12:00:00Z");
    for (let i = 0; i < 365; i++) {
      expect(local.dayStart(cursor).getTime(), cursor.toISOString()).toBe(named.dayStart(cursor).getTime());
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  });
});

describe("time — the log's column", () => {
  test("stored UTC renders as wall time in the zone, offset and all", () => {
    expect(AMSTERDAM.time("2026-08-23T09:41:12.000Z")).toBe("11:41 AM"); // CEST, +2
    expect(AMSTERDAM.time("2026-01-15T09:41:12.000Z")).toBe("10:41 AM"); // CET,  +1
    expect(LA.time("2026-08-23T09:41:12.000Z")).toBe("02:41 AM"); // PDT, −7
  });

  test("the two noon/midnight traps read correctly", () => {
    // Midnight is 12 AM (not 00 or 12 PM) and midday is 12 PM (not 00 PM).
    expect(AMSTERDAM.time("2026-08-21T22:00:00.000Z")).toBe("12:00 AM");
    expect(AMSTERDAM.time("2026-08-22T10:00:00.000Z")).toBe("12:00 PM");
    expect(AMSTERDAM.time("2026-08-22T11:00:00.000Z")).toBe("01:00 PM");
  });

  test("every reading is exactly eight characters", () => {
    // The log's time column is a fixed width sized off this, so the padding is
    // a layout contract, not a preference.
    for (const iso of [
      "2026-08-23T05:41:12.000Z",
      "2026-08-23T09:41:12.000Z",
      "2026-08-21T22:00:00.000Z",
      "2026-08-23T20:30:00.000Z",
    ]) {
      expect(AMSTERDAM.time(iso), iso).toMatch(/^\d{2}:\d{2} [AP]M$/);
    }
  });
});

describe("stamp — a moment in a sentence", () => {
  const NOW = at("2026-08-23T12:00:00Z"); // 14:00 Amsterdam

  test("on the same day it is the time alone", () => {
    expect(AMSTERDAM.stamp("2026-08-23T09:41:12Z", NOW)).toBe("11:41 AM");
  });

  test("on an earlier day it names the day", () => {
    expect(AMSTERDAM.stamp("2026-08-22T21:30:00Z", NOW)).toBe("Sat 22 Aug, 11:30 PM");
  });

  test("'today' is the zone's, not UTC's", () => {
    // 13 h before NOW is 01:00 the same Amsterdam day, and already the
    // previous day in UTC; 15 h before is 23:00 the previous Amsterdam day.
    expect(AMSTERDAM.stamp(new Date(NOW.getTime() - 13 * 3600e3), NOW)).toBe("01:00 AM");
    expect(AMSTERDAM.stamp(new Date(NOW.getTime() - 15 * 3600e3), NOW)).toBe("Sat 22 Aug, 11:00 PM");
  });

  test("one instant can be today in one zone and yesterday in another", () => {
    // 09:00 UTC is 11:00 in Amsterdam on the 23rd, and 21:00 the night before
    // in Auckland, where NOW is already 00:00 on the 24th.
    expect(AMSTERDAM.stamp("2026-08-23T09:00:00Z", NOW)).toBe("11:00 AM");
    expect(AUCKLAND.stamp("2026-08-23T09:00:00Z", NOW)).toBe("Sun 23 Aug, 09:00 PM");
  });
});

describe("day and zone — the header", () => {
  test("the date is compact and carries no year", () => {
    expect(AMSTERDAM.day(at("2026-08-22T10:00:00Z"))).toBe("Sat 22 Aug");
  });

  test("the zone is named as a reader knows it, and follows daylight saving", () => {
    expect(LA.zone(at("2026-01-15T12:00:00Z"))).toBe("Pacific Standard Time");
    expect(LA.zone(at("2026-08-15T12:00:00Z"))).toBe("Pacific Daylight Time");
  });
});

describe("the clock runs cut loose from this module", () => {
  test("its source alone rebuilds a working clock", () => {
    // How the browser gets it: `Function.prototype.toString`, pasted into an
    // inline script. Bun inlines module-scope constants, so a borrowed one only
    // shows in `page.test.ts`, which runs the script Vite emits.
    const detached = new Function(`return (${clock.toString()})`)() as typeof clock;
    const la = detached("America/Los_Angeles");
    expect(la.time("2026-08-23T09:41:12.000Z")).toBe("02:41 AM");
    expect(la.dayStart(at("2026-11-11T15:00:00Z")).toISOString()).toBe("2026-11-11T08:00:00.000Z");
    expect(la.stamp("2026-11-10T15:00:00Z", at("2026-11-11T15:00:00Z"))).toBe("Tue 10 Nov, 07:00 AM");
    expect(detached().time("2026-08-23T09:41:12.000Z")).toMatch(/^\d{2}:\d{2} [AP]M$/);
  });
});
