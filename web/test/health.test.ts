import { describe, expect, test } from "bun:test";
import { deriveState, type DisplayState } from "../src/lib/health";
import type { LiveFlag, PlayView } from "../src/lib/state";

/**
 * `deriveState` is the whole of what the page decides. It is pure — the clock
 * comes in as the third argument precisely so this file can exist — so every
 * state and every boundary is reachable without a filesystem or a fake timer.
 *
 * Two things are under test and they are not the same thing:
 *
 *   the THRESHOLDS  3 / 15 / 3 / 10 minutes, each checked on both sides
 *   the ORDER       first match wins, and which match comes first
 *
 * The order is the part with no other guard. Nothing in the type system stops
 * someone moving the off-air check above the staleness check during a refactor,
 * and every threshold test would still pass while a dead tracker started
 * reporting itself as merely off air.
 */

const NOW = new Date("2026-08-23T12:00:00.000Z");
const MIN = 60_000;

/** A heartbeat written `agoMs` before NOW. */
function flag(streamLive: boolean, agoMs: number): LiveFlag {
  return { streamLive, updatedAt: new Date(NOW.getTime() - agoMs) };
}

/** A play detected `agoMs` before NOW. */
function play(agoMs: number): PlayView {
  return {
    detectedAt: new Date(NOW.getTime() - agoMs).toISOString(),
    artist: "Ben Seretan",
    title: "kokosing",
  };
}

/** A confirmation stamped `agoMs` before NOW. */
function confirmed(agoMs: number): Date {
  return new Date(NOW.getTime() - agoMs);
}

/**
 * The default is `null` — no confirmation on disk — because that is what an
 * older tracker looks like and the fallback path must stay covered. Cases that
 * are about confirmation pass it explicitly.
 */
const at = (f: LiveFlag | null, p: PlayView | null, c: Date | null = null) =>
  deriveState(f, p, c, NOW);

describe("deriveState — the six states", () => {
  test("no flag file yet is starting up", () => {
    expect(at(null, null).kind).toBe("starting_up");
  });

  test("a stale heartbeat is offline, and reports when it was last seen", () => {
    const state = at(flag(true, 5 * MIN), play(1 * MIN));
    expect(state.kind).toBe("offline");
    if (state.kind !== "offline") throw new Error("unreachable");
    expect(state.lastSeenAt.toISOString()).toBe("2026-08-23T11:55:00.000Z");
  });

  test("flag content 0 is off air, carrying the last play of the day", () => {
    const state = at(flag(false, 10_000), play(30 * MIN));
    expect(state.kind).toBe("off_air");
    if (state.kind !== "off_air") throw new Error("unreachable");
    expect(state.lastPlayAt).toBe("2026-08-23T11:30:00.000Z");
  });

  test("off air with nothing logged today reports no last play", () => {
    const state = at(flag(false, 10_000), null);
    expect(state.kind).toBe("off_air");
    if (state.kind !== "off_air") throw new Error("unreachable");
    expect(state.lastPlayAt).toBeNull();
  });

  test("live but silent past the stall window reports the silence in minutes", () => {
    const state = at(flag(true, 10_000), play(28 * MIN));
    expect(state.kind).toBe("stalled");
    if (state.kind !== "stalled") throw new Error("unreachable");
    expect(state.silenceMinutes).toBe(28);
  });

  test("a fresh play is ok and now playing", () => {
    const state = at(flag(true, 12_000), play(2 * MIN));
    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") throw new Error("unreachable");
    expect(state.nowPlaying).toBe(true);
    expect(state.play.title).toBe("kokosing");
    expect(state.tickerReadSecondsAgo).toBe(12);
  });

  test("a play past the now window is still ok, no longer now playing", () => {
    const state = at(flag(true, 10_000), play(12 * MIN));
    expect(state.kind).toBe("ok");
    if (state.kind !== "ok") throw new Error("unreachable");
    expect(state.nowPlaying).toBe(false);
  });

  test("live and healthy with nothing logged yet is listening", () => {
    expect(at(flag(true, 10_000), null).kind).toBe("listening");
  });

  test("all six states are reachable", () => {
    const kinds = new Set<DisplayState["kind"]>([
      at(null, null).kind,
      at(flag(true, 5 * MIN), null).kind,
      at(flag(false, 10_000), null).kind,
      at(flag(true, 10_000), play(28 * MIN)).kind,
      at(flag(true, 10_000), play(1 * MIN)).kind,
      at(flag(true, 10_000), null).kind,
    ]);
    expect([...kinds].sort()).toEqual([
      "listening",
      "off_air",
      "offline",
      "ok",
      "stalled",
      "starting_up",
    ]);
  });
});

/**
 * Each threshold is a strict `>` on one side. These pin which side, because a
 * `>=` slipped in anywhere here changes what the page says for one whole tick
 * and no other test would notice.
 */
describe("deriveState — threshold boundaries", () => {
  test("3 minutes exactly is still alive; a millisecond more is offline", () => {
    // The heartbeat is stamped at tick START and a burst tick can run over a
    // minute, so this margin is what stops a working tracker reporting offline
    // mid-burst.
    expect(at(flag(true, 3 * MIN), null).kind).toBe("listening");
    expect(at(flag(true, 3 * MIN + 1), null).kind).toBe("offline");
  });

  test("15 minutes of silence exactly is not yet stalled", () => {
    expect(at(flag(true, 10_000), play(15 * MIN)).kind).toBe("ok");
    expect(at(flag(true, 10_000), play(15 * MIN + 1)).kind).toBe("stalled");
  });

  test("10 minutes is the edge of the now-playing claim WITHOUT confirmation", () => {
    const justInside = at(flag(true, 10_000), play(10 * MIN - 1));
    const justOutside = at(flag(true, 10_000), play(10 * MIN));
    expect(justInside.kind === "ok" && justInside.nowPlaying).toBe(true);
    expect(justOutside.kind === "ok" && justOutside.nowPlaying).toBe(false);
  });

  test("3 minutes is the edge of the confirmation, and it decides alone", () => {
    const old = play(40 * MIN);
    const justInside = at(flag(true, 10_000), old, confirmed(3 * MIN - 1));
    const justOutside = at(flag(true, 10_000), old, confirmed(3 * MIN));
    expect(justInside.kind === "ok" && justInside.nowPlaying).toBe(true);
    expect(justOutside.kind === "ok" && justOutside.nowPlaying).toBe(false);
  });

  test("a stale confirmation overrides a play young enough for the fallback", () => {
    // The song changed to something the stitcher cannot read: the row is two
    // minutes old and would pass the age fallback, but nothing has confirmed
    // the marquee since. Evidence beats the clock.
    const state = at(flag(true, 10_000), play(2 * MIN), confirmed(5 * MIN));
    expect(state.kind === "ok" && state.nowPlaying).toBe(false);
  });

  test("a fresh confirmation keeps a long track out of the stalled state", () => {
    // 20 minutes past STALL_MS, but the tracker is reading the marquee every
    // tick and it still shows this row. A long track is not a fault.
    const state = at(flag(true, 10_000), play(20 * MIN), confirmed(20_000));
    expect(state.kind).toBe("ok");
    expect(state.kind === "ok" && state.nowPlaying).toBe(true);
  });

  test("the 28-minute stall is still caught: it confirms nothing", () => {
    const state = at(flag(true, 10_000), play(28 * MIN), confirmed(28 * MIN));
    expect(state.kind).toBe("stalled");
  });

  test("silenceMinutes floors rather than rounds", () => {
    const state = at(flag(true, 10_000), play(20 * MIN + 59_000));
    expect(state.kind === "stalled" && state.silenceMinutes).toBe(20);
  });
});

/**
 * The README's Health table is this order, top to bottom. Each test below puts
 * a LOWER-priority condition alongside a higher one and asserts the higher wins
 * — which is the only thing keeping the table honest.
 */
describe("deriveState — first match wins", () => {
  test("starting up beats everything, even a full day of plays", () => {
    expect(at(null, play(1 * MIN)).kind).toBe("starting_up");
  });

  test("offline beats off air: the flag's content is stale news", () => {
    // Both conditions hold — the heartbeat is old AND it last said 0. "Tracker
    // offline" is the more fundamental fact, and the one the operator can act on.
    expect(at(flag(false, 10 * MIN), null).kind).toBe("offline");
  });

  test("offline beats a fresh play", () => {
    expect(at(flag(true, 4 * MIN), play(30_000)).kind).toBe("offline");
  });

  test("off air beats stalled: a named cause beats 'nothing new'", () => {
    // Silence during an off-air stretch is expected, not a symptom.
    expect(at(flag(false, 10_000), play(40 * MIN)).kind).toBe("off_air");
  });

  test("off air beats ok, even with a play from seconds ago", () => {
    expect(at(flag(false, 10_000), play(30_000)).kind).toBe("off_air");
  });

  test("stalled beats ok", () => {
    expect(at(flag(true, 10_000), play(16 * MIN)).kind).toBe("stalled");
  });
});

describe("deriveState — tickerReadSecondsAgo", () => {
  test("measures the heartbeat, not the play", () => {
    // How recently the tracker LOOKED, which is a different question from how
    // recently it found something.
    const state = at(flag(true, 25_000), play(4 * MIN));
    expect(state.kind === "ok" && state.tickerReadSecondsAgo).toBe(25);
  });

  test("never goes negative when the flag mtime is ahead of the clock", () => {
    // Clock skew between the tracker's write and the web process's read must
    // not surface as "ticker read -3 seconds ago".
    const ahead: LiveFlag = { streamLive: true, updatedAt: new Date(NOW.getTime() + 4000) };
    const state = deriveState(ahead, play(1 * MIN), null, NOW);
    expect(state.kind === "ok" && state.tickerReadSecondsAgo).toBe(0);
  });
});

describe("deriveState — the clock is injected, not read", () => {
  test("the same inputs give the same state at a different wall time", () => {
    // No hidden `new Date()` inside: every state above is reproducible, which
    // is what makes these tests deterministic rather than flaky at midnight.
    const later = new Date(NOW.getTime() + 90 * MIN);
    const shifted: LiveFlag = { streamLive: true, updatedAt: new Date(later.getTime() - 10_000) };
    const shiftedPlay: PlayView = {
      detectedAt: new Date(later.getTime() - 2 * MIN).toISOString(),
      artist: "Ben Seretan",
      title: "kokosing",
    };
    expect(deriveState(shifted, shiftedPlay, null, later).kind).toBe("ok");
  });
});
