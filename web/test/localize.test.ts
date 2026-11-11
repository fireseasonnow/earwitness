import { describe, expect, test } from "bun:test";
import { localize, localizeScript } from "../src/lib/localize";
import { clock } from "../src/lib/time";

/** Just enough of a page for `localize`: elements by attribute, nothing more. */
class El {
  hidden = false;
  removed = false;
  constructor(
    public attr: string,
    public textContent: string,
    public dataset: Record<string, string> = {},
    public dateTime = "",
  ) {}
  remove() {
    this.removed = true;
  }
}

function page(rowsAt: string[]) {
  const rows = rowsAt.map((at) => Object.assign(new El("data-at", "", { at }), { hidden: true }));
  const times = rowsAt.map((at) => new El("data-time", "", {}, at));
  const els = [
    ...rows,
    ...times,
    new El("data-stamp", "", {}, "2026-11-10T15:00:00.000Z"),
    new El("data-today", "Wed 11 Nov"),
    new El("data-zone", "Amsterdam time"),
    new El("data-local", "Amsterdam copy", { local: "Reader copy" }),
    new El("data-count", "0"),
  ];
  const live = (attr: string) => els.filter((e) => e.attr === attr && !e.removed);
  const doc = {
    querySelectorAll: (sel: string) => live(sel.match(/\[([\w-]+)\]/)![1]!),
    querySelector: (sel: string) => live(sel.match(/\[([\w-]+)\]/)![1]!)[0] ?? null,
  };
  const get = (attr: string) => live(attr)[0]!;
  return { doc: doc as unknown as Document, rows, times, get };
}

// 15:00 UTC on 11 Nov: 07:00 in Los Angeles, 04:00 on the 12th in Auckland.
const NOW = new Date("2026-11-11T15:00:00.000Z");
const PLAYS = [
  "2026-11-11T07:30:00.000Z", // LA: 10 Nov, 11:30 PM — before LA's midnight
  "2026-11-11T09:00:00.000Z", // LA: 01:00 AM;          Auckland: 10:00 PM on the 11th
  "2026-11-11T12:00:00.000Z", // LA: 04:00 AM;          Auckland: 01:00 AM on the 12th
];

describe("localize", () => {
  test("a reader in Los Angeles gets their day, in their time", () => {
    const p = page(PLAYS);
    localize(p.doc, clock("America/Los_Angeles"), NOW);
    expect(p.rows.map((r) => r.removed)).toEqual([true, false, false]);
    expect(p.rows.filter((r) => !r.removed).every((r) => !r.hidden)).toBe(true);
    expect(p.get("data-count").textContent).toBe("2");
    expect(p.times.slice(1).map((t) => t.textContent)).toEqual(["01:00 AM", "04:00 AM"]);
    expect(p.get("data-stamp").textContent).toBe("Tue 10 Nov, 07:00 AM");
    expect(p.get("data-today").textContent).toBe("Wed 11 Nov");
    expect(p.get("data-zone").textContent).toBe("Pacific Standard Time");
    expect(p.get("data-local").textContent).toBe("Reader copy");
  });

  test("a reader in Auckland, twelve hours ahead, gets a different day", () => {
    const p = page(PLAYS);
    localize(p.doc, clock("Pacific/Auckland"), NOW);
    expect(p.rows.map((r) => r.removed)).toEqual([true, true, false]);
    expect(p.get("data-count").textContent).toBe("1");
    expect(p.get("data-today").textContent).toBe("Thu 12 Nov");
    expect(p.get("data-zone").textContent).toBe("New Zealand Daylight Time");
  });

  test("the inline script is the tested source, and parses", () => {
    const src = localizeScript(clock);
    expect(src).toContain(localize.toString());
    expect(src).toContain(clock.toString());
    expect(() => new Function(src)).not.toThrow();
  });
});
