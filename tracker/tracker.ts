/**
 * Earwitness tracker — logs every song played on the stream into plays.json.
 *
 * Loop (every 30 s): grab one cropped ticker frame → OCR → fingerprint
 * against the current song. Mismatch → 18 s burst → stitch → resolve the credit
 * → append play. Ambiguity is reported, never guessed.
 *
 * Abnormal conditions go to stdout only. There is no stored trail, so a log
 * line is the only record: a stitch failure MUST carry its raw OCR fragments,
 * because nothing else can reconstruct them afterwards.
 */
import { parseUnit } from "@earwitness/shared";
import { CONFIG } from "./src/config";
import { captureBurst, captureTickFrame, ocrFrame } from "./src/capture";
import {
  StateUnreadableError,
  ensureStateDir,
  pruneToDay,
  readState,
  recordPlay,
  writeLiveFlag,
} from "./src/state";
import { isSameSong } from "./src/fingerprint";
import { log } from "./src/log";
import { normalize } from "./src/normalize";
import { StreamUrl } from "./src/resolve";
import { bestFragmentUnit, stitch } from "./src/stitch";
import { amsMidnightUtc, todayAms } from "./src/time";

/**
 * One play, as a log line. Artist and title are derived here from the credit
 * that was stored, through the same parser the page uses — the
 * state layer no longer returns them, because it no longer keeps them.
 */
function playLine(credit: string, suffix: string): string {
  const { artist, title } = parseUnit(credit);
  return `play: ${artist.length > 0 ? artist : "?"} — ${title}${suffix}`;
}

function checkBinaries(): void {
  const missing = ["yt-dlp", "ffmpeg", "tesseract"].filter((b) => Bun.which(b) === null);
  if (missing.length > 0) {
    console.error(
      `Missing required binaries: ${missing.join(", ")}. Install them (brew install ${missing.join(" ")}) and retry.`,
    );
    process.exit(1);
  }
}

ensureStateDir(CONFIG.stateDir);
// Read once before the loop starts. A file that exists but will not parse must
// stop the tracker here rather than at the first write, which would put empty
// state over whatever is actually in there.
try {
  readState(CONFIG.stateDir);
} catch (e) {
  console.error(`${String(e)}\nRefusing to start: move or repair the file, then restart.`);
  process.exit(1);
}
const streamUrl = new StreamUrl();
let currentUnit: string | null = null;
let emptyStreak = 0;
let captureFailStreak = 0;
let failedStitchStreak = 0;
let burstCooldownTicks = 0;
// null until the first tick, so a tracker that starts having last run yesterday
// prunes immediately instead of waiting for a live midnight boundary (D3).
let lastAmsDate: string | null = null;
// Optimistic: no resolution has failed yet. A first tick reporting "off air"
// before yt-dlp has even been asked would be a lie in the other direction.
let streamLive = true;
let staleUrlRetries = 0;

async function getUrl(): Promise<string> {
  try {
    const { url, resolved } = await streamUrl.get();
    if (resolved) log("stream URL resolved");
    streamLive = true;
    return url;
  } catch (e) {
    streamLive = false;
    throw e;
  }
}

/**
 * Retain only today, and re-establish the current song across the boundary.
 *
 * Clearing `currentUnit` sends the next tick down the burst path (the startup
 * path), so the song crossing midnight becomes the new day's first play instead
 * of staying invisible until the next genuine track change. The
 * backoff counters go with it — a cooldown carried over from last night must not
 * delay that first burst.
 */
function rolloverIfNeeded(): void {
  const today = todayAms();
  if (today === lastAmsDate) return;
  pruneToDay(CONFIG.stateDir, amsMidnightUtc(today));
  currentUnit = null;
  failedStitchStreak = 0;
  burstCooldownTicks = 0;
  if (lastAmsDate !== null) log(`rollover to ${today} — previous days pruned`);
  lastAmsDate = today;
}

/**
 * Dedup budget for a unit we do not trust. Confident stitches jitter by a
 * couple of chars; a pathological-OCR song stitches a different garbage variant
 * every burst, so the budget has to scale with length or every burst records a
 * new song.
 */
function noisyBudget(unit: string): number {
  return Math.max(3, Math.round(0.2 * normalize(unit).length));
}

/**
 * Tick capture with one failure-triggered re-resolve + retry.
 *
 * The retry is reported, not swallowed. On 2026-08-22 a stale cached URL made
 * every first attempt burn the whole capture timeout before the retry quietly
 * succeeded; because the retry reset the failure streak, the tracker produced
 * nothing for 28 minutes while reporting itself healthy. One log line per retry
 * makes that visible in journald, which is the only record now.
 */
async function captureTickWithRetry(): Promise<string> {
  const url = await getUrl();
  try {
    return await captureTickFrame(url);
  } catch (e) {
    staleUrlRetries++;
    // Unthrottled by intent: this line is what made the 2026-08-22 silent stall
    // visible, and it is already truncated rather than full error output.
    log(`tick capture failed on cached URL, re-resolving (retry ${staleUrlRetries}): ${String(e).slice(0, 140)}`);
    streamUrl.invalidate();
    const fresh = await getUrl(); // throws if yt-dlp fails too
    return await captureTickFrame(fresh);
  }
}

async function tick(): Promise<void> {
  rolloverIfNeeded();
  // Stamped BEFORE any capture: a burst tick can legitimately run for over a
  // minute, and stamping on completion would make a healthy tracker look stale
  // during exactly the interesting moments. The failure streaks stay
  // in memory — they drive log throttling and burst backoff below, and a viewer
  // has no action to take on them.
  writeLiveFlag(CONFIG.stateDir, streamLive);

  let framePath: string;
  try {
    framePath = await captureTickWithRetry();
    captureFailStreak = 0;
  } catch (e) {
    captureFailStreak++;
    // Throttled: a persistent fault must not bury the surrounding log.
    if (captureFailStreak === 1 || captureFailStreak % 10 === 0) {
      log(`anomaly resolve_failure (streak ${captureFailStreak}): ${String(e).slice(0, 200)}`);
    }
    return;
  }

  let text = "";
  try {
    text = await ocrFrame(framePath);
  } catch {
    text = ""; // an OCR crash behaves like an empty frame: retry next tick
  }

  if (text.length < CONFIG.minTickTextLen) {
    emptyStreak++;
    // transitions are instant text swaps — empty OCR is a hiccup, not a change
    if (emptyStreak === CONFIG.emptyOcrThreshold) {
      log(`anomaly empty_ocr (${emptyStreak} consecutive empty ticks)`);
    }
    return;
  }
  emptyStreak = 0;

  if (currentUnit !== null && isSameSong(text, currentUnit, CONFIG.fuzzyMaxEdits)) {
    failedStitchStreak = 0;
    burstCooldownTicks = 0;
    return; // the ~85% path: same song, sleep
  }

  // After failed stitches, back off instead of re-bursting every tick —
  // pathological-OCR songs would otherwise burst and log on every tick.
  if (burstCooldownTicks > 0) {
    burstCooldownTicks--;
    return;
  }

  // Burst path: mismatch (or startup with no current song).
  const url = await getUrl();
  const framePaths = await captureBurst(url);
  const fragments: string[] = [];
  for (const p of framePaths) {
    try {
      const t = await ocrFrame(p);
      if (t.trim().length > 0) fragments.push(t);
    } catch {
      // one bad frame must not kill the burst
    }
  }

  const res = stitch(fragments);
  if (res.unit === null) {
    failedStitchStreak++;
    burstCooldownTicks = Math.min(6, 2 ** failedStitchStreak); // 2, 4, 6, 6…
    if (failedStitchStreak === 1) {
      // The fragments are the only evidence of WHY the stitcher failed, and
      // nothing stores them now — so they go in the line.
      log(
        `anomaly low_confidence_stitch (${res.reason}) — keeping current song` +
          ` fragments=${JSON.stringify(fragments)} tickText=${JSON.stringify(text)}`,
      );
    } else {
      log(`stitch failed again (${res.reason}), streak ${failedStitchStreak} — backing off`);
    }
    if (failedStitchStreak === 2) {
      // A song is playing that we repeatedly cannot stitch. Record it once
      // from the best single fragment — never silently absent. The uncertainty
      // is in the log line above, not on the row.
      const fallback = bestFragmentUnit(fragments);
      if (fallback !== null) {
        const { credit, inserted } = recordPlay(CONFIG.stateDir, fallback, noisyBudget(fallback));
        currentUnit = fallback; // what the marquee looks like NOW
        if (inserted) log(playLine(credit, " [best-fragment fallback]"));
      }
    }
    return;
  }
  failedStitchStreak = 0;
  burstCooldownTicks = 0;

  // Resolve the credit first, then let the resolved identity decide whether this
  // is a new play — never a string comparison against `currentUnit`.
  const dedupBudget = res.confident ? CONFIG.creditDedupMaxEdits : noisyBudget(res.unit);
  const { credit, isNew, inserted } = recordPlay(CONFIG.stateDir, res.unit, dedupBudget);
  currentUnit = res.unit; // what the marquee looks like NOW
  if (!inserted) {
    log("burst re-confirmed current song (no new play)");
    return;
  }

  // The stitcher's confidence is not stored: nothing reads it back, and the
  // page deliberately shows no confidence marker (a viewer cannot act on one).
  // It still sets the dedup budget above, and it is reported here in full —
  // reason AND fragments — because the journal is the forensic record (D9).
  if (!res.confident) {
    log(
      `anomaly low_confidence_stitch (${res.reason})` +
        ` fragments=${JSON.stringify(fragments)} consensus=${JSON.stringify(res.unit)}`,
    );
  }
  // The credit, not `res.unit`: a burst that resolved to a song already playing
  // today is stored under that song's spelling, and that is the one on the page.
  if (!parseUnit(credit).ok) {
    log(`anomaly parse_failure: "${credit}"`);
  }
  log(playLine(credit, isNew ? " [new song]" : ""));
}

checkBinaries();
log(`tracker started (state: ${CONFIG.stateDir})`);
while (true) {
  try {
    await tick();
  } catch (e) {
    // Unreadable state cannot be retried out of: every subsequent tick would
    // fail the same way, and the loop would spin logging forever.
    if (e instanceof StateUnreadableError) {
      log(`fatal: ${String(e)}`);
      process.exit(1);
    }
    log(`tick error: ${String(e).slice(0, 300)}`);
  }
  await Bun.sleep(CONFIG.tickIntervalMs);
}
