/**
 * Persistent state: two plain files in one directory.
 *
 *   plays.json   the day's plays, and nothing else
 *   live.flag    one byte; its mtime is the tracker's heartbeat
 *
 * There is no database. After the health and anomaly tables were dropped, every
 * relational feature left was unused — the index covered at most ~480 rows a
 * day, `UNIQUE(raw_unit)` was unreachable because dedup scans by edit distance
 * before inserting, and the foreign key existed only to order the prune. What
 * SQLite genuinely provided was atomic uncorruptible writes, and `writeState`
 * below is the replacement.
 *
 * A play stores the observation and nothing derived from it: the
 * clock at the moment of resolution, and the stitched credit. Artist and title
 * are `parseUnit(credit)` and are derived by each reader at the point of use.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "./config";
import { rotationDistance } from "./fingerprint";
import { log } from "./log";
import { editDistance, normalize } from "./normalize";

export const STATE_VERSION = 2;
const PLAYS_FILE = "plays.json";
const FLAG_FILE = "live.flag";

export interface Play {
  /**
   * UTC ISO-8601: the moment the tracker RESOLVED the play, which lags the
   * song's actual start by up to a burst. Appended in order, so array order is
   * chronological and nothing sorts it.
   */
  detectedAt: string;
  /**
   * Canonical stitched reading of the ticker for this song — the first spelling
   * seen today. Dedup compares against this, and every reader parses it.
   */
  credit: string;
}

export interface State {
  version: number;
  plays: Play[];
}

/**
 * Thrown when `plays.json` exists but cannot be trusted. The tracker must exit
 * on this rather than continue, because continuing means writing empty state
 * over a file that may hold the whole day.
 *
 * A version MISMATCH is deliberately not this error: that file is perfectly
 * readable and merely old, and exiting on it would crash-loop a forward deploy
 * until the next Amsterdam midnight. It is renamed aside instead.
 */
export class StateUnreadableError extends Error {}

export function playsPath(dir: string = CONFIG.stateDir): string {
  return join(dir, PLAYS_FILE);
}

export function flagPath(dir: string = CONFIG.stateDir): string {
  return join(dir, FLAG_FILE);
}

export function emptyState(): State {
  return { version: STATE_VERSION, plays: [] };
}

export function ensureStateDir(dir: string = CONFIG.stateDir): void {
  mkdirSync(dir, { recursive: true });
}

let tmpCounter = 0;

/**
 * The ONLY function permitted to write `plays.json`.
 *
 * `writeFileSync(target, …)` truncates before writing, so a crash mid-write
 * destroys the day — the one failure mode SQLite used to rule out. Writing a
 * temp file in the SAME directory and renaming over the target is atomic on a
 * POSIX filesystem: a concurrent reader sees the whole old file or the whole new
 * one. Same directory matters; a rename across filesystems is a copy.
 *
 * Not fsync'd, so a power cut can still lose the last write. That is the
 * accepted trade: at most one play from a day-scoped log.
 */
export function writeState(dir: string, state: State): void {
  ensureStateDir(dir);
  const tmp = join(dir, `.${PLAYS_FILE}.${process.pid}.${tmpCounter++}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, playsPath(dir));
}

function isPlayShaped(v: unknown): v is Play {
  const p = v as Play | null;
  return typeof p === "object" && p !== null && typeof p.detectedAt === "string" && typeof p.credit === "string";
}

/**
 * The version is ASSERTED, not merely typed.
 *
 * The previous shape check tested `typeof version === "number"` and discarded
 * the result, which is why the two processes drifted across a mid-day restart
 * with `version` sitting at 1 throughout. A field whose whole job is to catch
 * that has to be compared against a value.
 */
function isShaped(v: unknown): v is State {
  const s = v as State | null;
  return (
    typeof s === "object" &&
    s !== null &&
    s.version === STATE_VERSION &&
    Array.isArray(s.plays) &&
    s.plays.every(isPlayShaped)
  );
}

/** A parsed file carrying some integer version — ours or another release's. */
function declaredVersion(v: unknown): number | null {
  const s = v as { version?: unknown } | null;
  return typeof s === "object" && s !== null && typeof s.version === "number" ? s.version : null;
}

/**
 * Move a file of the wrong version out of the way, preserving its version in
 * the name and staying in the same directory.
 *
 * This is not a write to `plays.json` — it is a rename away from that name, and
 * the empty state that follows reaches disk through `writeState` like every
 * other write. Nothing is destroyed: the old day is still on disk under the
 * `.bak` name, and journald has its per-play lines either way.
 */
function renameAside(dir: string, version: number): void {
  const from = playsPath(dir);
  const to = join(dir, `${PLAYS_FILE}.v${version}.bak`);
  renameSync(from, to);
  log(`state version mismatch: found v${version}, expected v${STATE_VERSION} — renamed ${from} to ${to}, starting from empty state`);
}

/**
 * Read the state, or an empty one when the file does not exist yet.
 *
 * Three outcomes, and they are deliberately different:
 *
 *   missing              → empty state; this is a first start
 *   wrong version        → renamed aside, empty state, one log line; a deploy
 *                          must be able to come up against yesterday's format
 *   unparseable / wrong  → throws. Returning empty here would send the very
 *   shape at our version   next write straight over whatever is actually in
 *                          there, and a corrupt file is indistinguishable from
 *                          a full day of plays.
 */
export function readState(dir: string = CONFIG.stateDir): State {
  const path = playsPath(dir);
  if (!existsSync(path)) return emptyState();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new StateUnreadableError(`${path} exists but is not valid JSON: ${String(e)}`);
  }
  const version = declaredVersion(parsed);
  if (version !== null && version !== STATE_VERSION) {
    renameAside(dir, version);
    return emptyState();
  }
  if (!isShaped(parsed)) {
    throw new StateUnreadableError(`${path} is valid JSON but not a v${STATE_VERSION} state object`);
  }
  return parsed;
}

export interface ResolvedCredit {
  /** The canonical spelling of this song for today: the first one seen. */
  credit: string;
  /** false → today's plays already contain this song. */
  isNew: boolean;
}

/**
 * Resolve a stitched unit to the canonical credit of a song already in today's
 * plays, or to itself when it is new. Within edit distance ≤ maxEdits of a
 * stored credit it is the same song (OCR jitter), and so is any ROTATION of one
 * within that budget.
 *
 * The rotation clause is not defensive programming. The stitcher recovers a
 * *cyclic* string and then guesses where the loop starts; when the ♪ separator
 * OCRs as a plain space there is nothing in the burst that distinguishes the
 * real boundary from a word gap, so consecutive bursts of one song legitimately
 * cut it at different points. Levenshtein rates a rotation as maximally
 * different — two full copies of the moved text — so plain edit distance filed
 * `Ben Seretan — walls are humming` and `Seretan — walls are humming Ben` as
 * two songs and logged the same song three times running. The tick fingerprint
 * (`isSameSong`) already matched rotations against the doubled unit; this is
 * the dedup path agreeing with it, which is the same class of divergence the
 * fingerprint already closed.
 *
 * Allocates nothing and mutates nothing. Two properties matter:
 *
 * - The scan is over DISTINCT credits in FIRST-OCCURRENCE order. `Set` preserves
 *   insertion order and the scan returns the first match, which is the whole of
 *   "first spelling wins" now that no track row holds it. A sort or a re-keying
 *   here would break the canonical-credit rule silently.
 * - A hit returns the MATCHED credit, never the incoming one, for the same
 *   reason: a later burst is not evidence that its own rotation is the better
 *   reading, and storing it would put one song on the page under two spellings.
 */
export function resolveCredit(
  state: State,
  unit: string,
  maxEdits: number = CONFIG.creditDedupMaxEdits,
): ResolvedCredit {
  const norm = normalize(unit);
  for (const credit of new Set(state.plays.map((p) => p.credit))) {
    const stored = normalize(credit);
    const same =
      editDistance(norm, stored) <= maxEdits || rotationDistance(norm, stored, maxEdits) <= maxEdits;
    if (same) return { credit, isNew: false };
  }
  return { credit: unit, isNew: true };
}

/** Credit of the most recent play, or null when there is none. */
export function lastPlayCredit(state: State): string | null {
  return state.plays.at(-1)?.credit ?? null;
}

export interface RecordedPlay extends ResolvedCredit {
  /** false → suppressed as a consecutive duplicate; nothing was written. */
  inserted: boolean;
}

/**
 * Resolve the unit to a canonical credit FIRST, then suppress the play when it
 * is the same credit as the most recent one.
 *
 * The old guard compared the stitched string against the tracker's in-memory
 * `currentUnit` by edit distance while resolution compared against the stored
 * one. Two stitches can each sit within budget of the stored credit yet
 * more than a budget apart from each other, so the two decisions could
 * disagree — that is how one song was logged twice, 63 s apart. Comparing
 * resolved identity makes divergence impossible.
 *
 * The state is re-read from disk on every call rather than held in memory.
 * That keeps the file the single source of truth, and it is what makes
 * the rule hold across a tracker restart mid-song. A genuine repeat later in the
 * day has a different song between it and its previous play, so it still counts.
 */
export function recordPlay(dir: string, unit: string, maxEdits: number): RecordedPlay {
  const state = readState(dir);
  const resolved = resolveCredit(state, unit, maxEdits);
  if (lastPlayCredit(state) === resolved.credit) return { ...resolved, inserted: false };
  state.plays.push({ detectedAt: new Date().toISOString(), credit: resolved.credit });
  writeState(dir, state);
  return { ...resolved, inserted: true };
}

/**
 * Retain only the current Amsterdam day.
 *
 * One filter over one array. Nothing outside the play array is referenced by a
 * play, so there is no second pass, no ordering between passes to get wrong, and
 * nothing left orphaned by a drop — the property the old track filter existed to
 * maintain.
 *
 * ISO-8601 UTC strings of identical format compare lexicographically in
 * chronological order, so the boundary test needs no date parsing. Only entries
 * strictly before the boundary are dropped, so a play appended later in the same
 * tick is never in range.
 */
export function pruneToDay(dir: string, dayStartUtc: Date): void {
  const state = readState(dir);
  const boundary = dayStartUtc.toISOString();
  writeState(dir, { ...state, plays: state.plays.filter((p) => p.detectedAt >= boundary) });
}

/**
 * Stamp the liveness flag. Called at the START of every tick: a
 * burst tick can legitimately run over a minute, and stamping on completion
 * would make a healthy tracker look stale during exactly the interesting
 * moments. One byte, overwritten in place; the mtime is the heartbeat.
 */
export function writeLiveFlag(dir: string, streamLive: boolean): void {
  ensureStateDir(dir);
  writeFileSync(flagPath(dir), streamLive ? "1" : "0");
}

export interface LiveFlag {
  streamLive: boolean;
  /** File mtime — the heartbeat. */
  updatedAt: Date;
}

/** Read the flag, or null when the tracker has never ticked here. */
export function readLiveFlag(dir: string = CONFIG.stateDir): LiveFlag | null {
  const path = flagPath(dir);
  try {
    const { mtime } = statSync(path);
    return { streamLive: readFileSync(path, "utf8").trim() === "1", updatedAt: mtime };
  } catch {
    return null;
  }
}
