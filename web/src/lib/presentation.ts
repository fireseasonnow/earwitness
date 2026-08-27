import type { DisplayState } from "./health";
import { amsTime } from "./time";

/**
 * State -> the hero's four slots.
 *
 * A pure function of the state it is handed: no clock, no environment, no
 * filesystem. Every state is therefore reachable in a test by constructing it
 * directly, and a state renders identically wherever it came from.
 *
 * The words live here and nowhere else. `health.ts` holds the thresholds and
 * the priority order, and a copy edit must not touch it.
 */

/** Three tones, each resolving to two tiers — see `toneMark` / `toneText`. */
export type Tone = "live" | "dormant" | "attention";

export interface Hero {
  kicker: string;
  /** Omitted entirely rather than blank: no empty line, no stray separator. */
  artist: string | null;
  headline: string;
  detail: string;
  tone: Tone;
  /** False only for `starting_up`, which has nothing captured to show. */
  showLog: boolean;
}

/**
 * A tone is a pair of class names, not a colour: the mark is a 24px graphic and
 * the kicker is 10px type, so a tone is free to run a lighter tier on the mark
 * than it may set type in.
 *
 * None of the three spends that freedom today. The live orange runs at one tier
 * by choice — `text-terra` and `text-terra-text` resolve to the same literal so
 * the note and the wordmark match — and the other two are dark enough already.
 * The palette in `global.css` holds the values and the contrast they cost.
 *
 * Written as whole literal class names so Tailwind's scanner finds them.
 */
export const toneMark: Record<Tone, string> = {
  live: "text-terra",
  dormant: "text-dormant",
  attention: "text-ochre-text",
};

export const toneText: Record<Tone, string> = {
  live: "text-terra-text",
  dormant: "text-dormant",
  attention: "text-ochre-text",
};

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * How long ago the tracker last read the ticker, at the resolution the page can
 * actually keep.
 *
 * Under 3 minutes by construction — past that the state is `offline`.
 *
 * Seconds are deliberately NOT shown. The page is server-rendered and refreshes
 * every 30 s, so a figure quoted to the second is re-computed six times a minute
 * at best and sits frozen in between; worse, it does not climb. A burst tick
 * runs over a minute while an ordinary one takes 30 s, so consecutive refreshes
 * read "47 seconds", then "12 seconds", then "39 seconds", which looks like a
 * fault and is not one. The precision was never real.
 *
 * What is left is the only distinction a viewer can act on: the tracker looked
 * at the marquee just now, or it is lagging and the newest row may be behind.
 * The exact figure is operator telemetry — the same reason the old `degraded`
 * failure count was taken off the page — and it stays in the journal, where an
 * operator already reads `live.flag` timings anyway.
 */
function ago(seconds: number): string {
  return seconds < 60 ? "just now" : plural(Math.floor(seconds / 60), "minute") + " ago";
}

export function hero(state: DisplayState): Hero {
  switch (state.kind) {
    case "ok": {
      const at = amsTime(state.play.detectedAt);
      const read = `ticker read ${ago(state.tickerReadSecondsAgo)}`;
      // "Now playing" assumes the newest play is what is on the air. Outside
      // the 6-minute window that is a claim the data does not support, so the
      // hero keeps its shape and drops it.
      return state.nowPlaying
        ? {
            kicker: "On air · now playing",
            artist: state.play.artist.length > 0 ? state.play.artist : null,
            headline: state.play.title,
            detail: `Since ${at} · ${read}`,
            tone: "live",
            showLog: true,
          }
        : {
            kicker: "On air · last logged",
            artist: state.play.artist.length > 0 ? state.play.artist : null,
            headline: state.play.title,
            detail: `Logged at ${at} · ${read}`,
            tone: "live",
            showLog: true,
          };
    }

    case "listening":
      return {
        kicker: "Listening",
        artist: null,
        headline: "No song logged yet",
        detail: "The stream is up — waiting for the first song change since midnight.",
        tone: "live",
        showLog: false,
      };

    // Where a "ticker unreadable" state lands: it reports the silence a viewer
    // can see rather than the failure count they cannot act on.
    case "stalled":
      return {
        kicker: "Nothing coming through",
        artist: null,
        headline: `Nothing new for ${plural(state.silenceMinutes, "minute")}`,
        detail:
          "The stream is on air and the tracker is running, but no song change has " +
          "been logged. Everything captured before that is below.",
        tone: "attention",
        showLog: true,
      };

    case "off_air":
      return {
        kicker: "Off air",
        artist: null,
        headline: "Nothing on the air",
        detail:
          state.lastPlayAt === null
            ? "Nothing logged today. The log stays up until midnight."
            : `Last play ${amsTime(state.lastPlayAt)}. Today's log stays up until midnight.`,
        tone: "dormant",
        showLog: true,
      };

    case "offline":
      return {
        kicker: "Tracker offline",
        artist: null,
        headline: `Nothing heard since ${amsTime(state.lastSeenAt.toISOString())}`,
        detail: "The tracker stopped reporting. Plays captured before it went quiet are below.",
        tone: "attention",
        showLog: true,
      };

    case "starting_up":
      return {
        kicker: "Starting up",
        artist: null,
        headline: "Tuning in",
        detail: "Resolving the stream and taking a first reading.",
        tone: "dormant",
        showLog: false,
      };
  }
}
