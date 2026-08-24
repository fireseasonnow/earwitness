import { describe, expect, test } from "bun:test";
import { parseUnit } from "../index";

describe("parseUnit", () => {
  test("fixture-1 unit: numeric prefix stripped for display", () => {
    const p = parseUnit("Fields of Ethera — 02 - Boundless Horizons");
    expect(p.artist).toBe("Fields of Ethera");
    expect(p.title).toBe("Boundless Horizons");
    expect(p.ok).toBe(true);
  });

  test("fixture-2 unit: plain artist/title", () => {
    const p = parseUnit("Orions Belte — Manual Shear");
    expect(p.artist).toBe("Orions Belte");
    expect(p.title).toBe("Manual Shear");
    expect(p.ok).toBe(true);
  });

  test("splits on the FIRST em-dash separator only", () => {
    const p = parseUnit("Artist — Title — Reprise");
    expect(p.artist).toBe("Artist");
    expect(p.title).toBe("Title — Reprise");
    expect(p.ok).toBe(true);
  });

  test("plain hyphens do not split", () => {
    const p = parseUnit("Aedh — A Message For Cynthia");
    expect(p.artist).toBe("Aedh");
    expect(p.title).toBe("A Message For Cynthia");
    expect(p.ok).toBe(true);
  });

  test("no separator → parse failure, whole unit kept as title", () => {
    const p = parseUnit("No Separator Here");
    expect(p.ok).toBe(false);
    expect(p.artist).toBe("");
    expect(p.title).toBe("No Separator Here");
  });

  test("numeric prefix that IS the whole title is kept", () => {
    const p = parseUnit("Artist — 03 - ");
    expect(p.ok).toBe(true);
    expect(p.title).toBe("03 -");
  });
});
