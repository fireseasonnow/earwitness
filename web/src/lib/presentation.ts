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
 * A tone is a pair, not a colour. The mark is a 24px graphic and
 * can carry the sampled terracotta at 3.6:1; the kicker is 10px type and needs
 * the darkened tier at 5.0:1. The other two tones are already dark enough that
 * both tiers are the same value.
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

/** Under 3 minutes by construction — past that the state is `offline`. */
function ago(seconds: number): string {
  return seconds < 60 ? plural(seconds, "second") : plural(Math.floor(seconds / 60), "minute");
}

export function hero(state: DisplayState): Hero {
  switch (state.kind) {
    case "ok": {
      const at = amsTime(state.play.detectedAt);
      const read = `ticker read ${ago(state.tickerReadSecondsAgo)} ago`;
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
