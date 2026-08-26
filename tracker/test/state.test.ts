import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG } from "../src/config";
import {
  STATE_VERSION,
  StateUnreadableError,
  emptyState,
  lastPlayCredit,
  playsPath,
  pruneToDay,
  readLiveFlag,
  readState,
  recordPlay,
  resolveCredit,
  writeLiveFlag,
  writeState,
} from "../src/state";
import { amsMidnightUtc } from "../src/time";

const ORIONS = "Orions Belte — Manual Shear";
const FIELDS = "Fields of Ethera — 02 - Boundless Horizons";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "earwitness-test-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const plays = () => readState(dir).plays;
const credits = () => plays().map((p) => p.credit);

describe("consecutive duplicate suppression", () => {
  test("the same unit twice records one play", () => {
    expect(recordPlay(dir, ORIONS, CONFIG.creditDedupMaxEdits).inserted).toBe(true);
    expect(recordPlay(dir, ORIONS, CONFIG.creditDedupMaxEdits).inserted).toBe(false);
    expect(plays()).toHaveLength(1);
  });

  test("jittered re-observations beyond the pairwise budget still record one play", () => {
    // The 2026-07-30 duplicate: both stitches resolve to the stored credit
    // within 2 edits (1 and 2), but differ from EACH OTHER by 3 — which the old
    // string guard read as a different song. Identity cannot diverge like that.
    const a = "Ardley — Dawn Hour";
    const b = "Ardley — Dawn Hovr"; // 1 edit from a
    const c = "Ardley — Davn Houv"; // 2 edits from a, 3 from b — over budget
    expect(recordPlay(dir, a, 2).inserted).toBe(true);
    const second = recordPlay(dir, b, 2);
    const third = recordPlay(dir, c, 2);
    expect(second.inserted).toBe(false);
    expect(third.inserted).toBe(false);
    expect(second.credit).toBe(third.credit);
    expect(plays()).toHaveLength(1);
  });

  test("a repeat with a different song between is a new play", () => {
    recordPlay(dir, ORIONS, 2);
    recordPlay(dir, FIELDS, 2);
    expect(recordPlay(dir, ORIONS, 2).inserted).toBe(true);
    expect(credits()).toEqual([ORIONS, FIELDS, ORIONS]);
  });

  test("a partial reading then a confident stitch of the same song: one play", () => {
    const fragment = "Orions Belte — Manual Shea";
    const fallback = recordPlay(dir, fragment, 5);
    expect(fallback.inserted).toBe(true);
    const confident = recordPlay(dir, ORIONS, 5);
    expect(confident.inserted).toBe(false);
    expect(confident.credit).toBe(fallback.credit);
  });

  test("an unparseable unit is recorded like any other", () => {
    // Nothing about the row says the parse failed: the caller reports it to the
    // journal, which is the only place a quality signal lives.
    const r = recordPlay(dir, "no separator here", 2);
    expect(r.inserted).toBe(true);
    expect(plays()).toEqual([{ detectedAt: expect.any(String), credit: "no separator here" }]);
  });

  test("lastPlayCredit is null on empty state", () => {
    expect(lastPlayCredit(emptyState())).toBeNull();
  });

  test("suppression reads the last play from disk, not from memory", () => {
    // The guard must survive a restart mid-song. Nothing is held
    // between these two calls but the file itself.
    expect(recordPlay(dir, ORIONS, 2).inserted).toBe(true);
    const state = readState(dir); // simulates a fresh process reading it back
    expect(lastPlayCredit(state)).toBe(ORIONS);
    expect(recordPlay(dir, ORIONS, 2).inserted).toBe(false);
  });

  test("a suppressed play writes nothing at all", () => {
    recordPlay(dir, ORIONS, 2);
    const before = readFileSync(playsPath(dir), "utf8");
    expect(recordPlay(dir, ORIONS, 2).inserted).toBe(false);
    expect(readFileSync(playsPath(dir), "utf8")).toBe(before);
  });

  test("suppression survives a restart mid-song with a jittered re-read", () => {
    // The restart case in full: the process is gone, the only carrier is the
    // file, and the re-detection is not byte-identical.
    expect(recordPlay(dir, ORIONS, 2).inserted).toBe(true);
    expect(recordPlay(dir, "Orions Belte — Manual Shear ", 2).inserted).toBe(false);
    expect(recordPlay(dir, "0rions Belte — Manual Shear", 2).inserted).toBe(false);
    expect(plays()).toHaveLength(1);
  });
});

describe("canonical credit", () => {
  // Every play of one song must carry ONE spelling or the page shows two songs
  // where there is one. Nothing in the shape enforces it since the track table
  // went, and a violation looks exactly like correct output.
  const SERETAN = "Ben Seretan — walls are humming";
  const JITTERED = "Ben Seretan — walls are humrning"; // 2 edits

  test("a jittered re-observation appends the MATCHED credit, not its own", () => {
    recordPlay(dir, SERETAN, 2);
    recordPlay(dir, FIELDS, 2); // a different song between, so the next one inserts
    const again = recordPlay(dir, JITTERED, 2);
    expect(again.inserted).toBe(true);
    expect(again.credit).toBe(SERETAN);
    expect(credits()).toEqual([SERETAN, FIELDS, SERETAN]);
  });

  test("one song never renders under two spellings across a day", () => {
    const variants = [SERETAN, "Ben Seretan — walls are humming", "Ben Seretan — walls are hummlng"];
    for (const v of variants) {
      recordPlay(dir, v, 2);
      recordPlay(dir, FIELDS, 2); // break the consecutive-duplicate suppression
    }
    const seretan = credits().filter((c) => c.startsWith("Ben"));
    expect(seretan).toHaveLength(3);
    expect(new Set(seretan).size).toBe(1);
  });

  test("a genuinely new song stores its own credit", () => {
    const r = recordPlay(dir, ORIONS, 2);
    expect(r.isNew).toBe(true);
    expect(r.credit).toBe(ORIONS);
  });

  test("the scan runs over distinct credits in first-occurrence order", () => {
    // The order is the rule: `resolveCredit` returns the FIRST match, so if the
    // distinct set were sorted or re-keyed, a later spelling could win and this
    // is the only place that would notice.
    const state = emptyState();
    state.plays.push({ detectedAt: "2026-08-23T09:00:00.000Z", credit: SERETAN });
    state.plays.push({ detectedAt: "2026-08-23T09:30:00.000Z", credit: FIELDS });
    state.plays.push({ detectedAt: "2026-08-23T10:00:00.000Z", credit: SERETAN });
    expect(resolveCredit(state, JITTERED, 2)).toEqual({ credit: SERETAN, isNew: false });
  });

  test("resolveCredit allocates nothing and mutates nothing", () => {
    const state = emptyState();
    state.plays.push({ detectedAt: "2026-08-23T09:00:00.000Z", credit: SERETAN });
    const snapshot = JSON.stringify(state);
    resolveCredit(state, ORIONS, 2);
    resolveCredit(state, JITTERED, 2);
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe("pruneToDay", () => {
  function seed(credit: string, detectedAt: string): void {
    const state = readState(dir);
    state.plays.push({ detectedAt, credit });
    writeState(dir, state);
  }

  test("keeps today and drops earlier days", () => {
    seed("yesterday", "2026-08-21T20:00:00.000Z"); // 22:00 Amsterdam, 2026-08-21
    seed("today", "2026-08-21T22:30:00.000Z"); // 00:30 Amsterdam, 2026-08-22
    pruneToDay(dir, amsMidnightUtc("2026-08-22"));
    expect(credits()).toEqual(["today"]);
  });

  test("a song played on both days keeps only today's play", () => {
    seed("repeat", "2026-08-21T20:00:00.000Z");
    seed("repeat", "2026-08-22T09:00:00.000Z");
    pruneToDay(dir, amsMidnightUtc("2026-08-22"));
    expect(plays()).toHaveLength(1);
  });

  test("nothing outside the play array is left orphaned", () => {
    seed("gone", "2026-08-21T20:00:00.000Z");
    pruneToDay(dir, amsMidnightUtc("2026-08-22"));
    expect(readState(dir)).toEqual(emptyState());
  });

  test("the boundary instant itself is retained", () => {
    seed("boundary", amsMidnightUtc("2026-08-22").toISOString());
    pruneToDay(dir, amsMidnightUtc("2026-08-22"));
    expect(plays()).toHaveLength(1);
  });

  test("on a 23-hour day the boundary is the true Amsterdam midnight, not -24 h", () => {
    // Spring-forward day: 23:30 UTC on 2026-03-28 is 00:30 Amsterdam on the
    // 29th and must survive. A fixed 24-hour offset would put the boundary at
    // 2026-03-29T00:00Z and delete it.
    seed("early hours of the 29th", "2026-03-28T23:30:00.000Z");
    pruneToDay(dir, amsMidnightUtc("2026-03-29"));
    expect(plays()).toHaveLength(1);
  });

  test("on a 25-hour day the doubled hour still belongs to that day", () => {
    // Fall-back day: 2026-10-25 runs 22:00Z(24th) → 23:00Z(25th). 00:30Z on the
    // 25th is 02:30 Amsterdam, inside the day.
    seed("doubled hour", "2026-10-25T00:30:00.000Z");
    pruneToDay(dir, amsMidnightUtc("2026-10-25"));
    expect(plays()).toHaveLength(1);
  });

  test("prune on a fresh directory writes valid empty state", () => {
    pruneToDay(dir, amsMidnightUtc("2026-08-22"));
    expect(readState(dir)).toEqual(emptyState());
  });
});

describe("atomic writes", () => {
  test("the target is never left partially written and no temp file survives", () => {
    // Distinct enough to be separate songs: two units differing only by a digit
    // are 2 edits apart and would (correctly) dedup into one.
    const units = ["Alpha — One", "Bravo — Two", "Charlie — Three", "Delta — Four", "Echo — Five"];
    for (const u of units) recordPlay(dir, u, 2);
    // A temp file left behind means a write path that did not complete its
    // rename — which is also how a reader could observe one.
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(() => readState(dir)).not.toThrow();
    expect(plays()).toHaveLength(5);
  });

  test("a reader mid-write sees whole state, because the target is renamed into place", () => {
    // The guarantee is structural: writeState never opens the target for
    // truncation, so every byte a reader can see was complete before the rename.
    recordPlay(dir, ORIONS, 2);
    const first = readFileSync(playsPath(dir), "utf8");
    expect(JSON.parse(first).plays).toHaveLength(1);
    recordPlay(dir, FIELDS, 2);
    expect(JSON.parse(readFileSync(playsPath(dir), "utf8")).plays).toHaveLength(2);
  });

  test("writeState creates the directory when it does not exist", () => {
    const nested = join(dir, "a", "b");
    expect(existsSync(nested)).toBe(false);
    writeState(nested, emptyState());
    expect(readState(nested)).toEqual(emptyState());
  });
});

describe("the written record carries only what was observed", () => {
  test("a play object has exactly detectedAt and credit", () => {
    recordPlay(dir, ORIONS, 2);
    const raw = JSON.parse(readFileSync(playsPath(dir), "utf8"));
    expect(Object.keys(raw)).toEqual(["version", "plays"]);
    expect(Object.keys(raw.plays[0]).sort()).toEqual(["credit", "detectedAt"]);
  });

  test("no review, confidence or quality field is written under any name", () => {
    recordPlay(dir, "no separator here", 2); // the most "flaggable" input there is
    const text = readFileSync(playsPath(dir), "utf8");
    for (const banned of ["review", "confiden", "quality", "flag", "needs_"]) {
      expect(text).not.toContain(banned);
    }
  });
});

describe("state format version contract", () => {
  const bak = (v: number) => join(dir, `plays.json.v${v}.bak`);

  test("a matching version reads and preserves the day", () => {
    recordPlay(dir, ORIONS, 2);
    expect(JSON.parse(readFileSync(playsPath(dir), "utf8")).version).toBe(STATE_VERSION);
    expect(readState(dir).plays).toHaveLength(1);
  });

  test("an older version is renamed aside and the tracker continues from empty", () => {
    const v1 = {
      version: 1,
      nextTrackId: 2,
      tracks: [{ id: 1, artist: "Orions Belte", title: "Manual Shear", rawUnit: ORIONS }],
      plays: [{ trackId: 1, at: "2026-08-23T09:55:23.477Z" }],
    };
    writeFileSync(playsPath(dir), JSON.stringify(v1, null, 2));
    expect(readState(dir)).toEqual(emptyState());
    // Renamed, not destroyed, and in the same directory so the rename is atomic.
    expect(existsSync(playsPath(dir))).toBe(false);
    expect(JSON.parse(readFileSync(bak(1), "utf8"))).toEqual(v1);
    // And the tracker keeps ticking: the next play writes a fresh v2 file.
    expect(recordPlay(dir, ORIONS, 2).inserted).toBe(true);
    expect(readState(dir).plays).toHaveLength(1);
  });

  test("a numeric-but-wrong version is rejected, not accepted for having the right type", () => {
    // The 2026-08-23 drift in one line: `typeof version === "number"` passed
    // and the value was thrown away, so a stale shape read as a current one.
    writeFileSync(playsPath(dir), JSON.stringify({ version: 99, plays: [] }));
    expect(readState(dir)).toEqual(emptyState());
    expect(existsSync(bak(99))).toBe(true);
  });

  test("a rename-aside is reported, not silent", () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(" "));
    try {
      writeFileSync(playsPath(dir), JSON.stringify({ version: 1, plays: [] }));
      readState(dir);
    } finally {
      console.log = original;
    }
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("v1");
    expect(lines[0]).toContain(`v${STATE_VERSION}`);
    expect(lines[0]).toContain("plays.json.v1.bak");
  });

  test("a version mismatch does not write plays.json before the next real write", () => {
    // Rule of the state layer: `writeState` is the only path to that name. The
    // rename moves the file AWAY from it and returns empty state in memory.
    writeFileSync(playsPath(dir), JSON.stringify({ version: 1, plays: [] }));
    readState(dir);
    expect(existsSync(playsPath(dir))).toBe(false);
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  test("a v2 file whose plays are the wrong shape is unreadable, not a mismatch", () => {
    writeFileSync(playsPath(dir), JSON.stringify({ version: 2, plays: [{ trackId: 1, at: "x" }] }));
    expect(() => readState(dir)).toThrow(StateUnreadableError);
    expect(existsSync(playsPath(dir))).toBe(true);
  });
});

describe("unreadable state", () => {
  test("invalid JSON throws rather than degrading to empty", () => {
    writeFileSync(playsPath(dir), "{ this is not json");
    expect(() => readState(dir)).toThrow(StateUnreadableError);
  });

  test("an unparseable file is not renamed aside — that path is for old, not corrupt", () => {
    writeFileSync(playsPath(dir), "{ this is not json");
    expect(() => readState(dir)).toThrow(StateUnreadableError);
    expect(readdirSync(dir).filter((f) => f.endsWith(".bak"))).toEqual([]);
  });

  test("valid JSON of the wrong shape throws", () => {
    writeFileSync(playsPath(dir), JSON.stringify({ hello: "world" }));
    expect(() => readState(dir)).toThrow(StateUnreadableError);
  });

  test("an unreadable file is never overwritten by a recordPlay attempt", () => {
    const garbage = "{ half a file";
    writeFileSync(playsPath(dir), garbage);
    expect(() => recordPlay(dir, ORIONS, 2)).toThrow(StateUnreadableError);
    expect(readFileSync(playsPath(dir), "utf8")).toBe(garbage);
  });

  test("an unreadable file is never overwritten by a prune", () => {
    const garbage = "nope";
    writeFileSync(playsPath(dir), garbage);
    expect(() => pruneToDay(dir, amsMidnightUtc("2026-08-22"))).toThrow(StateUnreadableError);
    expect(readFileSync(playsPath(dir), "utf8")).toBe(garbage);
  });

  test("a missing file is not an error", () => {
    expect(readState(dir)).toEqual(emptyState());
  });
});

describe("live flag", () => {
  test("absent until the tracker writes it", () => {
    expect(readLiveFlag(dir)).toBeNull();
  });

  test("content carries stream-live and mtime carries the heartbeat", () => {
    const before = Date.now();
    writeLiveFlag(dir, true);
    const live = readLiveFlag(dir);
    expect(live?.streamLive).toBe(true);
    expect(live?.updatedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test("off air is written as 0 and read back as false", () => {
    writeLiveFlag(dir, false);
    expect(readLiveFlag(dir)?.streamLive).toBe(false);
  });

  test("one byte, overwritten in place rather than accumulated", () => {
    for (const v of [true, false, true, false]) writeLiveFlag(dir, v);
    expect(readFileSync(join(dir, "live.flag"), "utf8")).toBe("0");
  });
});

describe("rotation-invariant dedup", () => {
  /*
   * The stitcher GUESSES where the marquee loop starts; when the ♪ separator
   * OCRs as a plain space nothing in the burst distinguishes the real boundary
   * from a word gap. Levenshtein rates a rotation as maximally different, so
   * three bursts of one song became three rows on 2026-08-23.
   */
  const SERETAN = "Ben Seretan — walls are humming";
  const ROT_1 = "Seretan — walls are humming Ben";
  const ROT_2 = "humming Ben Seretan — walls are";

  function stateWith(...creditList: string[]) {
    const s = emptyState();
    for (const [i, credit] of creditList.entries()) {
      s.plays.push({ detectedAt: `2026-08-23T0${i}:00:00.000Z`, credit });
    }
    return s;
  }

  test("rotations of one unit resolve to the same credit", () => {
    const state = stateWith(SERETAN);
    for (const rot of [ROT_1, ROT_2]) {
      expect(resolveCredit(state, rot, CONFIG.creditDedupMaxEdits)).toEqual({
        credit: SERETAN,
        isNew: false,
      });
    }
  });

  test("a rotation carrying OCR jitter still resolves to it", () => {
    const state = stateWith(SERETAN);
    const noisy = resolveCredit(state, "Seretan — walls are hummlng Ben", CONFIG.creditDedupMaxEdits);
    expect(noisy.credit).toBe(SERETAN);
  });

  test("a rotation logs one play, not one per burst", () => {
    expect(recordPlay(dir, SERETAN, CONFIG.creditDedupMaxEdits).inserted).toBe(true);
    expect(recordPlay(dir, ROT_1, CONFIG.creditDedupMaxEdits).inserted).toBe(false);
    expect(recordPlay(dir, ROT_2, CONFIG.creditDedupMaxEdits).inserted).toBe(false);
    expect(plays()).toHaveLength(1);
  });

  test("the first spelling seen wins — a later rotation does not rename it", () => {
    const state = stateWith(SERETAN);
    expect(resolveCredit(state, ROT_1, CONFIG.creditDedupMaxEdits).credit).toBe(SERETAN);
  });

  test("different songs are still different credits", () => {
    const state = stateWith(ORIONS);
    expect(resolveCredit(state, FIELDS, CONFIG.creditDedupMaxEdits)).toEqual({
      credit: FIELDS,
      isNew: true,
    });
  });

  test("a short unit does not merge into a longer one that contains it", () => {
    // Without the length guard the doubled haystack makes every substring free.
    const state = stateWith("Ben Seretan — walls are humming again and again");
    const short = resolveCredit(state, "Seretan — walls", CONFIG.creditDedupMaxEdits);
    expect(short.isNew).toBe(true);
  });
});
