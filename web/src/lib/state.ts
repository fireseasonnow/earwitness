import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseUnit, resolveStateDir } from "@earwitness/shared";
import { todayRangeUtc } from "./time";

/**
 * Read-only view of the tracker's state directory.
 *
 * Three plain files, read through `node:fs`. No database driver, no native
 * binding, no runtime builtin — which is why the built server is no longer
 * pinned to a particular runtime.
 */

/** The only `plays.json` shape this build understands. */
const STATE_VERSION = 2;

export interface PlayView {
  /** UTC ISO-8601: when the tracker RESOLVED the play, not when it started. */
  detectedAt: string;
  artist: string;
  title: string;
}

export interface LiveFlag {
  streamLive: boolean;
  /** File mtime — the tracker's heartbeat. */
  updatedAt: Date;
}

// Resolved through the shared module, which is where the default lives: the two
// processes have no other channel, so a copied default is a silent split-brain
// waiting for someone to edit one of them.
const stateDir = resolveStateDir();

const playsFile = join(stateDir, "plays.json");
const flagFile = join(stateDir, "live.flag");
const confirmedFile = join(stateDir, "confirmed.flag");

interface RawPlay {
  detectedAt: string;
  credit: string;
}

/**
 * Plays of the current Amsterdam day, oldest first.
 *
 * The tracker appends chronologically and nothing is sorted here. This order is
 * the contract: `DayView` takes the LAST element as the newest play to derive
 * the health state. `PlayLog` reverses a copy for display.
 *
 * The tracker prunes previous days at rollover, so the range filter is a safety
 * net rather than the retention policy — but it stays: between a missed rollover
 * and a page load, stale entries must still never render.
 *
 * Artist and title are derived per row rather than read: they are not stored,
 * because they are a pure function of the credit stored beside them.
 * A consequence worth knowing before it is reported as a bug: correcting the
 * parser improves rows recorded earlier the same day on the next render.
 *
 * Three ways to end up with no rows, all of them normal health states rather
 * than exceptions. The page must degrade to a state, not a stack trace, and the
 * next request retries; the tracker takes the opposite position on the same file
 * because it would be the one overwriting it.
 */
export function playsToday(): PlayView[] {
  if (!existsSync(playsFile)) return []; // tracker has not written yet
  let state: { version?: unknown; plays?: RawPlay[] };
  try {
    state = JSON.parse(readFileSync(playsFile, "utf8"));
  } catch {
    return [];
  }
  // A file from another release is readable but not ours. Rendering its rows
  // under the shape we expect would put wrong or empty text on the page, which
  // is worse than an honest "nothing yet" while a staggered deploy finishes.
  if (state.version !== STATE_VERSION) return [];
  if (!Array.isArray(state.plays)) return [];

  const { startIso, endIso } = todayRangeUtc();
  const out: PlayView[] = [];
  for (const p of state.plays) {
    if (p.detectedAt < startIso || p.detectedAt >= endIso) continue;
    const { artist, title } = parseUnit(p.credit);
    out.push({ detectedAt: p.detectedAt, artist, title });
  }
  return out;
}

/**
 * The tracker's liveness flag, or null when the file is absent — which is what
 * "nothing has been heard from the tracker yet" looks like on disk.
 */
export function liveFlag(): LiveFlag | null {
  try {
    const { mtime } = statSync(flagFile);
    return { streamLive: readFileSync(flagFile, "utf8").trim() === "1", updatedAt: mtime };
  } catch {
    return null;
  }
}

/**
 * When the tracker last READ the marquee as still showing the newest logged
 * play, or null when it never has.
 *
 * Null is not an error state and must not be treated as one: it is what a
 * tracker older than this file looks like, and what the first seconds of a
 * fresh state directory look like. `deriveState` falls back to the play's age
 * in that case, so the page degrades to its previous behaviour rather than to
 * a wrong one.
 *
 * The file has no content — the mtime is the whole of it, exactly as with
 * `live.flag`, because the filesystem already stores a timestamp and a second
 * copy inside the file could disagree with it.
 */
export function confirmedAt(): Date | null {
  try {
    return statSync(confirmedFile).mtime;
  } catch {
    return null;
  }
}
