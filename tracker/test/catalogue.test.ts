import { describe, expect, test } from "bun:test";
import { KNOWN_CREDITS, knownSpelling } from "../src/catalogue";

describe("knownSpelling", () => {
  /*
   * Every string the tracker stored for these two credits between the overlay
   * redesign on 2026-09-24 and 2026-10-08, from the journal. Misread glyphs,
   * dropped letters, and wrong loop cuts all resolve to the checked spelling.
   */
  const observed: [string, string][] = [
    ["O1' Burger Beats — Winter Night", "Ol' Burger Beats — Winter Night"],
    ["0O1' Burger Beats — Winter Night", "Ol' Burger Beats — Winter Night"],
    ["O1' Burgr Beats — Winter Night", "Ol' Burger Beats — Winter Night"],
    ["O1' Burger Beats — Witer Night", "Ol' Burger Beats — Winter Night"],
    ["Night O1' Burger Beats — Winer", "Ol' Burger Beats — Winter Night"],
    ["Night O1' Burger Beats — Winter", "Ol' Burger Beats — Winter Night"],
    ["Beats — Winter Night O1' Burger", "Ol' Burger Beats — Winter Night"],
    ["Burger Beats — Winter Night 0O1'", "Ol' Burger Beats — Winter Night"],
    ["O1' Burger Beats — Ella G", "Ol' Burger Beats — Ella G"],
    ["01' Burger Beats — Ella G", "Ol' Burger Beats — Ella G"],
    ["G O1' Burger Beats — Ella", "Ol' Burger Beats — Ella G"],
    ["G 01' Burger Beats — Ella", "Ol' Burger Beats — Ella G"],
    ["Beats — Ella G O1' Burger", "Ol' Burger Beats — Ella G"],
    ["Burger Beats — Ella G O1'", "Ol' Burger Beats — Ella G"],
  ];

  for (const [read, expected] of observed) {
    test(`"${read}" is stored as "${expected}"`, () => {
      expect(knownSpelling(read)).toBe(expected);
    });
  }

  test("a known credit is its own spelling", () => {
    for (const credit of KNOWN_CREDITS) expect(knownSpelling(credit)).toBe(credit);
  });

  test("a credit not on the list passes through untouched", () => {
    expect(knownSpelling("Joya — 06 - Oregold")).toBe("Joya — 06 - Oregold");
    expect(knownSpelling("Grabek — three")).toBe("Grabek — three");
  });

  test("another title by a known artist is not renamed to a known one", () => {
    expect(knownSpelling("Ol' Burger Beats — Chill Night")).toBe("Ol' Burger Beats — Chill Night");
  });

  test("the closest known credit wins, whatever the list order", () => {
    const known = ["Ab Cd — Efgh", "Ab Cd — Efgi"];
    expect(knownSpelling("Ab Cd — Efgi", known)).toBe("Ab Cd — Efgi");
    expect(knownSpelling("Ab Cd — Efgi", [...known].reverse())).toBe("Ab Cd — Efgi");
  });
});
