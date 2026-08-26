import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DisplayState } from "../src/lib/health";
import { hero, toneMark, toneText, type Tone } from "../src/lib/presentation";
import type { PlayView } from "../src/lib/state";

/**
 * States are constructed directly rather than arrived at through `deriveState`:
 * a copy edit changes this file's expectations and nothing else.
 */

const PLAY: PlayView = {
  detectedAt: "2026-08-23T09:41:12.000Z", // 11:41 Amsterdam, summer time
  artist: "Ben Seretan",
  title: "kokosing",
};

const ALL_STATES: DisplayState[] = [
  { kind: "starting_up" },
  { kind: "offline", lastSeenAt: new Date("2026-08-23T09:41:12.000Z") },
  { kind: "off_air", lastPlayAt: PLAY.detectedAt },
  { kind: "off_air", lastPlayAt: null },
  { kind: "stalled", silenceMinutes: 22 },
  { kind: "listening" },
  { kind: "ok", play: PLAY, nowPlaying: true, tickerReadSecondsAgo: 12 },
  { kind: "ok", play: PLAY, nowPlaying: false, tickerReadSecondsAgo: 12 },
];

describe("hero — every state fills every slot", () => {
  test("no state renders a blank kicker, headline or detail", () => {
    // The hero reserves a minimum height and pins itself to the bottom, so an
    // empty slot is not a missing line — it is a visible gap that moves the log.
    for (const state of ALL_STATES) {
      const h = hero(state);
      expect(h.kicker.length, `kicker for ${state.kind}`).toBeGreaterThan(0);
      expect(h.headline.length, `headline for ${state.kind}`).toBeGreaterThan(0);
      expect(h.detail.length, `detail for ${state.kind}`).toBeGreaterThan(0);
    }
  });

  test("the log is hidden only where there is nothing captured to show", () => {
    // "The hero is above the list, never instead of it" — a stitching problem
    // must not hide songs already captured.
    const hidden = ALL_STATES.filter((s) => !hero(s).showLog).map((s) => s.kind);
    expect(hidden.sort()).toEqual(["listening", "starting_up"]);
  });

  test("every tone resolves in both tiers", () => {
    for (const state of ALL_STATES) {
      const tone: Tone = hero(state).tone;
      expect(toneMark[tone]).toBeTruthy();
      expect(toneText[tone]).toBeTruthy();
    }
  });
});

describe("hero — the on-air states", () => {
  test("inside the now window it claims the song is playing", () => {
    const h = hero({ kind: "ok", play: PLAY, nowPlaying: true, tickerReadSecondsAgo: 12 });
    expect(h.kicker).toBe("On air · now playing");
    expect(h.headline).toBe("kokosing");
    expect(h.artist).toBe("Ben Seretan");
    expect(h.detail).toBe("Since 11:41 AM · ticker read just now");
    expect(h.tone).toBe("live");
  });

  test("outside it, the hero keeps its shape and drops the claim", () => {
    const now = hero({ kind: "ok", play: PLAY, nowPlaying: true, tickerReadSecondsAgo: 12 });
    const past = hero({ kind: "ok", play: PLAY, nowPlaying: false, tickerReadSecondsAgo: 12 });
    expect(past.kicker).toBe("On air · last logged");
    expect(past.detail).toBe("Logged at 11:41 AM · ticker read just now");
    expect(past.headline).toBe(now.headline);
    expect(past.tone).toBe(now.tone);
    expect(past.showLog).toBe(now.showLog);
  });

  test("the word 'now' appears only when the data supports it", () => {
    const now = hero({ kind: "ok", play: PLAY, nowPlaying: true, tickerReadSecondsAgo: 5 });
    const past = hero({ kind: "ok", play: PLAY, nowPlaying: false, tickerReadSecondsAgo: 5 });
    expect(now.kicker).toContain("now");
    expect(past.kicker).not.toContain("now");
  });

  test("a credit with no artist omits the line rather than blanking it", () => {
    // `parseUnit` returns an empty artist when the ticker gave no separator.
    // Null is the contract: Hero.astro renders nothing, not an empty element.
    const noArtist: PlayView = { ...PLAY, artist: "" };
    const h = hero({ kind: "ok", play: noArtist, nowPlaying: true, tickerReadSecondsAgo: 3 });
    expect(h.artist).toBeNull();
    expect(h.headline).toBe("kokosing");
  });

  test("artist is null in every state that has no play to name", () => {
    const withoutPlay = ALL_STATES.filter((s) => s.kind !== "ok");
    expect(withoutPlay.every((s) => hero(s).artist === null)).toBe(true);
  });
});

describe("hero — the trouble states", () => {
  test("offline names the Amsterdam time it was last heard from", () => {
    const h = hero({ kind: "offline", lastSeenAt: new Date("2026-08-23T09:41:12.000Z") });
    expect(h.kicker).toBe("Tracker offline");
    expect(h.headline).toBe("Nothing heard since 11:41 AM");
    expect(h.tone).toBe("attention");
    expect(h.showLog).toBe(true);
  });

  test("winter time shifts the same instant by an hour", () => {
    // Stored UTC, displayed Amsterdam — the offset is not a constant.
    const h = hero({ kind: "offline", lastSeenAt: new Date("2026-01-15T09:41:12.000Z") });
    expect(h.headline).toBe("Nothing heard since 10:41 AM");
  });

  test("stalled reports the silence, never a failure count", () => {
    const h = hero({ kind: "stalled", silenceMinutes: 22 });
    expect(h.kicker).toBe("Nothing coming through");
    expect(h.headline).toBe("Nothing new for 22 minutes");
    expect(h.tone).toBe("attention");
    expect(h.showLog).toBe(true);
  });

  test("off air keeps the day's log up and says so", () => {
    const withPlay = hero({ kind: "off_air", lastPlayAt: PLAY.detectedAt });
    expect(withPlay.kicker).toBe("Off air");
    expect(withPlay.headline).toBe("Nothing on the air");
    expect(withPlay.detail).toContain("11:41 AM");
    expect(withPlay.tone).toBe("dormant");

    const empty = hero({ kind: "off_air", lastPlayAt: null });
    expect(empty.detail).toContain("Nothing logged today");
    expect(empty.detail).not.toContain("Last play");
  });

  test("starting up and listening are the two quiet states", () => {
    expect(hero({ kind: "starting_up" }).headline).toBe("Tuning in");
    expect(hero({ kind: "listening" }).headline).toBe("No song logged yet");
    expect(hero({ kind: "starting_up" }).tone).toBe("dormant");
    expect(hero({ kind: "listening" }).tone).toBe("live");
  });
});

describe("hero — plurals", () => {
  const detailFor = (seconds: number): string =>
    hero({ kind: "ok", play: PLAY, nowPlaying: true, tickerReadSecondsAgo: seconds }).detail;

  test("one is singular, everything else is not", () => {
    expect(detailFor(60)).toContain("1 minute ago");
    expect(detailFor(125)).toContain("2 minutes ago");
    expect(hero({ kind: "stalled", silenceMinutes: 1 }).headline).toBe("Nothing new for 1 minute");
    expect(hero({ kind: "stalled", silenceMinutes: 16 }).headline).toBe("Nothing new for 16 minutes");
  });

  test("a reading under a minute is not quoted in seconds", () => {
    // The page re-renders every 30 s and a burst tick runs over a minute, so a
    // figure in seconds neither holds still nor climbs. Everything inside the
    // refresh window reads the same, and it is the same phrase at 0 as at 59.
    for (const s of [0, 1, 2, 29, 30, 59]) {
      expect(detailFor(s)).toContain("ticker read just now");
      expect(detailFor(s)).not.toContain("second");
    }
  });

  test("past a minute it says how far behind, because that is actionable", () => {
    expect(detailFor(60)).toContain("ticker read 1 minute ago");
    expect(detailFor(125)).toContain("ticker read 2 minutes ago");
    // Bounded by construction: past STALE_MS the state is `offline`, not `ok`.
    expect(detailFor(179)).toContain("ticker read 2 minutes ago");
  });
});

describe("tone tiers", () => {
  test("the live tone darkens for text, the other two do not need to", () => {
    // Sampled terracotta is 3.6:1 — fine for a 24px mark, not for 10px type.
    expect(toneMark.live).not.toBe(toneText.live);
    expect(toneMark.dormant).toBe(toneText.dormant);
    expect(toneMark.attention).toBe(toneText.attention);
  });

  test("both maps cover all three tones", () => {
    expect(Object.keys(toneMark).sort()).toEqual(["attention", "dormant", "live"]);
    expect(Object.keys(toneText).sort()).toEqual(["attention", "dormant", "live"]);
  });
});

/**
 * Both modules can pass every test above while a string migrates into the
 * thresholds file or a duration into the words file, so the split is asserted
 * against the sources themselves.
 */
describe("words and thresholds stay in separate modules", () => {
  const WEB = join(import.meta.dir, "..", "src", "lib");
  const healthSrc = readFileSync(join(WEB, "health.ts"), "utf8");
  const presentationSrc = readFileSync(join(WEB, "presentation.ts"), "utf8");

  /** Everything the hero can say, from the tests above. */
  const USER_FACING = [
    "On air",
    "Off air",
    "Tracker offline",
    "Nothing coming through",
    "Starting up",
    "Listening",
    "Tuning in",
    "Nothing on the air",
    "No song logged yet",
  ];

  /** A duration written as a millisecond constant. */
  const DURATION = /\b\d+\s*\*\s*(?:\d+\s*\*\s*)?1000\b|\b\d+_000\b/;

  test("health.ts contains none of the words the page says", () => {
    expect(USER_FACING.filter((w) => healthSrc.includes(w))).toEqual([]);
  });

  test("presentation.ts contains no duration constant", () => {
    expect(DURATION.test(presentationSrc)).toBe(false);
  });

  test("the guard would catch either violation", () => {
    // A guard whose patterns cannot match a real regression passes forever.
    expect(USER_FACING.some((w) => presentationSrc.includes(w))).toBe(true);
    expect(DURATION.test(healthSrc)).toBe(true);
  });
});
