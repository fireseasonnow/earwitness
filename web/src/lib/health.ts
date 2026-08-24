import type { LiveFlag, PlayView } from "./state";

/**
 * Derived display states. The tracker records facts; this decides what they
 * mean, so the staleness policy lives here rather than in the
 * tracker.
 *
 * Six states from a one-byte file and the play list. Each carries only the
 * facts that state needs — the words are `presentation.ts`'s job, so a copy
 * edit never touches the module holding the thresholds.
 *
 * Every state except `starting_up` still renders whatever was already captured.
 * A problem must never hide songs the tracker got right earlier in the day.
 */
export type DisplayState =
  | { kind: "starting_up" }
  | { kind: "offline"; lastSeenAt: Date }
  | { kind: "off_air"; lastPlayAt: string | null }
  | { kind: "stalled"; silenceMinutes: number }
  | { kind: "listening" }
  | { kind: "ok"; play: PlayView; nowPlaying: boolean; tickerReadSecondsAgo: number };

/**
 * A tick can legitimately run ~100 s in the burst path and the flag is written
 * at its start, so the threshold has to clear that with margin or a working
 * tracker gets reported offline mid-burst.
 */
const STALE_MS = 3 * 60 * 1000;

/**
 * A heartbeat only proves the loop is turning, not that it is getting anywhere.
 * On 2026-08-22 the tracker ticked healthily for 28 minutes without logging a
 * play — a stale-URL stall that reset the failure streak on every retry, so
 * nothing downstream could see it. Silence this long is itself a symptom: tracks
 * run 2-4 minutes, and a song the stitcher cannot read is still recorded from
 * its best fragment, so nothing legitimately produces a gap this size.
 *
 * This used to be the *last* warning in a chain that began with a failure count
 * (the old `degraded` state). It is now the only one — that count was operator
 * telemetry a viewer could not act on, and it lives in the journal instead. A
 * "ticker unreadable" state maps here too, with the silence reported and the
 * count left out. If this proves too slow in the soak, lower it; do not
 * reinstate the counter.
 */
const STALL_MS = 15 * 60 * 1000;

/**
 * The freshest play is almost certainly what's on the stream right now
 * (songs run ~2-4 min; detection lags <= ~1 min, worst case ~3).
 *
 * One constant, two consumers: the hero's claim that something is playing now
 * and the list's "now" badge. They are computed once here so they cannot
 * disagree.
 */
const NOW_WINDOW_MS = 6 * 60 * 1000;

/** First match wins. The order below is the point. */
export function deriveState(
  flag: LiveFlag | null,
  newestPlay: PlayView | null,
  now: Date = new Date(),
): DisplayState {
  if (flag === null) return { kind: "starting_up" };

  if (now.getTime() - flag.updatedAt.getTime() > STALE_MS) {
    // More fundamental than the last thing the dead tracker managed to say.
    return { kind: "offline", lastSeenAt: flag.updatedAt };
  }
  if (!flag.streamLive) return { kind: "off_air", lastPlayAt: newestPlay?.detectedAt ?? null };
  // After the off-air check: a named cause is more use than "nothing new".
  if (newestPlay !== null && now.getTime() - Date.parse(newestPlay.detectedAt) > STALL_MS) {
    return {
      kind: "stalled",
      silenceMinutes: Math.floor((now.getTime() - Date.parse(newestPlay.detectedAt)) / 60_000),
    };
  }
  if (newestPlay !== null) {
    const age = now.getTime() - Date.parse(newestPlay.detectedAt);
    return {
      kind: "ok",
      play: newestPlay,
      nowPlaying: age < NOW_WINDOW_MS,
      tickerReadSecondsAgo: Math.max(0, Math.floor((now.getTime() - flag.updatedAt.getTime()) / 1000)),
    };
  }
  // Covers both a fresh start and the minutes just after midnight, when the
  // prune has cleared the day and the crossing song is not yet logged.
  return { kind: "listening" };
}
