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
 * The tracker once ticked healthily for 28 minutes without logging a play — a
 * stale-URL stall that reset the failure streak on every retry, so nothing
 * downstream could see it.
 *
 * Silence this long used to be conclusive, on the reasoning that tracks run 2-4
 * minutes and an unreadable song was still recorded from its best fragment. That
 * fallback is gone — it promoted a single unvoted OCR frame to a row, and put
 * "ape suspended PADELM — Clot" on the page — so a run of failed stitches can
 * now produce a legitimate gap of any length. The confirmation flag is what
 * distinguishes the two: a stalled tracker stops confirming, while a long track
 * goes on being confirmed every tick. Hence the guard below, not a longer
 * threshold — the 28-minute stall confirmed nothing, and would still be caught.
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
 * How stale the tracker's confirmation may be before the page stops claiming
 * anything is playing NOW.
 *
 * The tracker stamps `confirmed.flag` on every tick whose fingerprint still
 * matches the current song — the ~85% path — so during a normal song this is
 * seconds old, however long the song runs. It stops the moment the marquee
 * changes to something the stitcher cannot read, which is precisely when the
 * newest row stops being what is playing.
 *
 * Three minutes for the same reason `STALE_MS` is three: a burst tick can run
 * over a minute, and the flag is stamped around it, not during it.
 */
const CONFIRM_WINDOW_MS = 3 * 60 * 1000;

/**
 * Fallback when the tracker has never stamped a confirmation — an older
 * tracker, or the first seconds of a fresh state directory. Then the only
 * evidence is the play's own age.
 *
 * Ten minutes, not the six this used to be. Six came from "songs run 2-4 min,
 * detection lags <= ~3", but observed gaps between detections reach 7 minutes
 * with the song demonstrably still on the marquee, so six declared a playing
 * song stale. This path is now the exception rather than the rule, and it errs
 * towards the claim the confirmation flag would have supported.
 *
 * One constant, two consumers: the hero's claim that something is playing now
 * and the list's "now" badge. They are computed once here so they cannot
 * disagree.
 */
const NOW_WINDOW_MS = 10 * 60 * 1000;

/**
 * Is the newest play what the stream is playing right now?
 *
 * Confirmation wins whenever it exists, because it is a reading of the marquee
 * rather than an inference from a clock.
 */
function isNowPlaying(newestPlay: PlayView, confirmedAt: Date | null, now: Date): boolean {
  if (confirmedAt !== null) return now.getTime() - confirmedAt.getTime() < CONFIRM_WINDOW_MS;
  return now.getTime() - Date.parse(newestPlay.detectedAt) < NOW_WINDOW_MS;
}

/** First match wins. The order below is the point. */
export function deriveState(
  flag: LiveFlag | null,
  newestPlay: PlayView | null,
  confirmedAt: Date | null = null,
  now: Date = new Date(),
): DisplayState {
  if (flag === null) return { kind: "starting_up" };

  if (now.getTime() - flag.updatedAt.getTime() > STALE_MS) {
    // More fundamental than the last thing the dead tracker managed to say.
    return { kind: "offline", lastSeenAt: flag.updatedAt };
  }
  if (!flag.streamLive) return { kind: "off_air", lastPlayAt: newestPlay?.detectedAt ?? null };
  // After the off-air check: a named cause is more use than "nothing new".
  // Fresh confirmation vetoes it: the tracker is reading the marquee and it
  // still shows the newest row, so the silence is a long track, not a fault.
  const nowPlaying = newestPlay !== null && isNowPlaying(newestPlay, confirmedAt, now);
  if (
    newestPlay !== null &&
    !nowPlaying &&
    now.getTime() - Date.parse(newestPlay.detectedAt) > STALL_MS
  ) {
    return {
      kind: "stalled",
      silenceMinutes: Math.floor((now.getTime() - Date.parse(newestPlay.detectedAt)) / 60_000),
    };
  }
  if (newestPlay !== null) {
    return {
      kind: "ok",
      play: newestPlay,
      nowPlaying,
      tickerReadSecondsAgo: Math.max(0, Math.floor((now.getTime() - flag.updatedAt.getTime()) / 1000)),
    };
  }
  // Covers both a fresh start and the minutes just after midnight, when the
  // prune has cleared the day and the crossing song is not yet logged.
  return { kind: "listening" };
}
