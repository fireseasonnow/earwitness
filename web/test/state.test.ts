import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The page's read side. It takes the opposite position to the tracker on the
 * same two files: the tracker refuses to start rather than write over something
 * it cannot read, and this degrades to a health state rather than throw —
 * because the page renders per request and the next one retries, while a write
 * would be destroying the day.
 *
 * So the three ways to end up with no rows are all NORMAL here, and that is the
 * contract under test:
 *
 *   file absent        the tracker has not written yet
 *   file unparseable   a torn or hand-edited file
 *   version mismatch   the other unit deployed first
 *
 * `state.ts` resolves its directory once at module scope, so EARWITNESS_STATE
 * has to be set before the first import — hence the dynamic import below rather
 * than a top-level one. One directory for the whole file; the tests vary its
 * contents, not its path.
 */

const DIR = mkdtempSync(join(tmpdir(), "earwitness-web-test-"));
process.env.EARWITNESS_STATE = DIR;

const PLAYS = join(DIR, "plays.json");
const FLAG = join(DIR, "live.flag");

// After the env var is set, so the module captures this directory.
const { playsToday, liveFlag } = await import("../src/lib/state");

/** A play stamped `msAgo` before the frozen clock. */
function play(msAgo: number, credit: string): { detectedAt: string; credit: string } {
  return { detectedAt: new Date(NOW.getTime() - msAgo).toISOString(), credit };
}

function writePlays(body: unknown): void {
  writeFileSync(PLAYS, typeof body === "string" ? body : JSON.stringify(body));
}

const NOW = new Date("2026-08-23T12:00:00.000Z"); // 14:00 Amsterdam, mid-day
const MIN = 60_000;

beforeAll(() => setSystemTime(NOW));
afterAll(() => {
  setSystemTime();
  rmSync(DIR, { recursive: true, force: true });
});
afterEach(() => {
  for (const f of [PLAYS, FLAG]) {
    try {
      unlinkSync(f);
    } catch {
      /* not every test writes both */
    }
  }
});

describe("playsToday — the three ways to end up with no rows", () => {
  test("no file at all: the tracker has not written yet", () => {
    expect(playsToday()).toEqual([]);
  });

  test("a file that will not parse degrades instead of throwing", () => {
    // The tracker reports this and EXITS, because it cannot tell a corrupt file
    // from a whole day of plays. The page must not: it would 500 on every
    // request until someone intervened.
    writePlays('{"version": 2, "plays": [{"detectedAt"');
    expect(() => playsToday()).not.toThrow();
    expect(playsToday()).toEqual([]);
  });

  test("a file from another release renders nothing rather than guessing", () => {
    // Readable, but not ours. Rendering its rows under the shape we expect puts
    // wrong or empty text on the page — worse than an honest "nothing yet"
    // while a staggered deploy finishes.
    writePlays({ version: 1, plays: [play(5 * MIN, "Ben Seretan — kokosing")] });
    expect(playsToday()).toEqual([]);
  });

  test("the version must be exactly 2, not merely a number", () => {
    for (const version of [3, "2", null, undefined, 2.0000001]) {
      writePlays({ version, plays: [play(5 * MIN, "A — B")] });
      expect(playsToday(), `version ${String(version)}`).toEqual([]);
    }
  });

  test("a well-formed file with a non-array plays field is not trusted", () => {
    writePlays({ version: 2, plays: { "0": play(5 * MIN, "A — B") } });
    expect(playsToday()).toEqual([]);
  });
});

describe("playsToday — reading a good file", () => {
  test("returns the day's plays oldest first, artist and title derived", () => {
    // Artist and title are NOT stored. They are `parseUnit(credit)` at the point
    // of use, which is why fixing the parser improves this morning's rows on the
    // next render instead of waiting for midnight.
    writePlays({
      version: 2,
      plays: [play(90 * MIN, "Ben Seretan — kokosing"), play(5 * MIN, "Julia Holter — Sun Girl")],
    });
    const rows = playsToday();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ artist: "Ben Seretan", title: "kokosing" });
    expect(rows[1]).toMatchObject({ artist: "Julia Holter", title: "Sun Girl" });
    // Order is the contract: DayView takes the LAST element as the newest play
    // to derive the health state.
    expect(Date.parse(rows[1]!.detectedAt)).toBeGreaterThan(Date.parse(rows[0]!.detectedAt));
  });

  test("a credit with no separator yields an empty artist, not a dropped row", () => {
    writePlays({ version: 2, plays: [play(5 * MIN, "no separator here")] });
    const rows = playsToday();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.artist).toBe("");
    expect(rows[0]!.title).toBe("no separator here");
  });

  test("an empty day is an empty array, not a failure", () => {
    writePlays({ version: 2, plays: [] });
    expect(playsToday()).toEqual([]);
  });
});

describe("playsToday — the day filter is a safety net, not the retention policy", () => {
  test("yesterday's plays never render, even if the prune was missed", () => {
    // The tracker prunes at rollover. Between a missed rollover and a page load,
    // stale entries must still never reach the page.
    writePlays({
      version: 2,
      plays: [
        play(20 * 60 * MIN, "Yesterday — gone"), // ~20 h ago, previous Ams day
        play(30 * MIN, "Today — kept"),
      ],
    });
    const titles = playsToday().map((p) => p.title);
    expect(titles).toEqual(["kept"]);
  });

  test("a play stamped exactly at Amsterdam midnight belongs to the new day", () => {
    // The range is half-open: >= start, < end. 2026-08-22T22:00:00Z is midnight
    // starting the 23rd in summer time.
    writePlays({
      version: 2,
      plays: [
        { detectedAt: "2026-08-22T21:59:59.999Z", credit: "Before — excluded" },
        { detectedAt: "2026-08-22T22:00:00.000Z", credit: "Boundary — included" },
      ],
    });
    expect(playsToday().map((p) => p.title)).toEqual(["included"]);
  });

  test("a play stamped in the future is not rendered", () => {
    // Clock skew, or a hand-edited file. Either way it is not part of today.
    writePlays({
      version: 2,
      plays: [{ detectedAt: "2026-08-24T06:00:00.000Z", credit: "Tomorrow — nope" }],
    });
    expect(playsToday()).toEqual([]);
  });
});

describe("liveFlag", () => {
  test("absent file is null — nothing heard from the tracker yet", () => {
    // Distinct from "0". Null drives "Starting up", 0 drives "Off air".
    expect(liveFlag()).toBeNull();
  });

  test("content 1 is live, content 0 is off air", () => {
    writeFileSync(FLAG, "1");
    expect(liveFlag()?.streamLive).toBe(true);
    writeFileSync(FLAG, "0");
    expect(liveFlag()?.streamLive).toBe(false);
  });

  test("a trailing newline does not read as off air", () => {
    writeFileSync(FLAG, "1\n");
    expect(liveFlag()?.streamLive).toBe(true);
  });

  test("the heartbeat is the file's mtime, not anything stored inside it", () => {
    // No timestamp is written — the filesystem already keeps one. That is the
    // whole reason the file is one byte.
    writeFileSync(FLAG, "1");
    const stamped = new Date("2026-08-23T11:58:30.000Z");
    utimesSync(FLAG, stamped, stamped);
    expect(liveFlag()?.updatedAt.toISOString()).toBe("2026-08-23T11:58:30.000Z");
  });

  test("anything other than 1 reads as not live", () => {
    for (const body of ["", "x", "2", "true"]) {
      writeFileSync(FLAG, body);
      expect(liveFlag()?.streamLive, `content ${JSON.stringify(body)}`).toBe(false);
    }
  });
});
