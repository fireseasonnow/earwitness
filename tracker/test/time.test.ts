import { describe, expect, test } from "bun:test";
import { amsDateOf, amsMidnightUtc } from "../src/time";

// The prune boundary is Amsterdam midnight expressed as a UTC instant. A fixed
// 24-hour offset would land inside the wrong day twice a year, silently deleting
// an hour of plays (spring) or keeping an hour of yesterday's (autumn).
describe("amsMidnightUtc", () => {
  test("summer time: midnight is 22:00 UTC the previous day", () => {
    expect(amsMidnightUtc("2026-08-22").toISOString()).toBe("2026-08-21T22:00:00.000Z");
  });

  test("winter time: midnight is 23:00 UTC the previous day", () => {
    expect(amsMidnightUtc("2026-01-15").toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  test("spring forward: the 23-hour day starts at 23:00 UTC", () => {
    // 2026-03-29 is a 23-hour Amsterdam day (02:00 → 03:00 local).
    expect(amsMidnightUtc("2026-03-29").toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(amsMidnightUtc("2026-03-30").toISOString()).toBe("2026-03-29T22:00:00.000Z");
    const hours = (Date.parse("2026-03-30T00:00:00Z") - 2 * 3600e3 - amsMidnightUtc("2026-03-29").getTime()) / 3600e3;
    expect(hours).toBe(23);
  });

  test("fall back: the 25-hour day starts at 22:00 UTC", () => {
    // 2026-10-25 is a 25-hour Amsterdam day (03:00 → 02:00 local).
    expect(amsMidnightUtc("2026-10-25").toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(amsMidnightUtc("2026-10-26").toISOString()).toBe("2026-10-25T23:00:00.000Z");
    const span =
      (amsMidnightUtc("2026-10-26").getTime() - amsMidnightUtc("2026-10-25").getTime()) / 3600e3;
    expect(span).toBe(25);
  });

  test("boundary belongs to the day it starts", () => {
    const start = amsMidnightUtc("2026-08-22");
    expect(amsDateOf(start)).toBe("2026-08-22");
    expect(amsDateOf(new Date(start.getTime() - 1))).toBe("2026-08-21");
  });
});
