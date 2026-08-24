// Plays are stored in UTC; everything the user sees is Europe/Amsterdam,
// including the day boundary. Intl handles DST (23/25-hour days) for free.
// Mirrored in `tracker/src/time.ts` — see the note there.
const TZ = "Europe/Amsterdam";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
// 12-hour with AM/PM. `hour: "2-digit"` is load-bearing rather than cosmetic:
// with "numeric" a single-digit hour renders "9:41 AM" at seven characters
// instead of eight, and the log's fixed-width time column stops lining up.
const timeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hour: "2-digit",
  minute: "2-digit",
  hour12: true,
});
const wallFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
// The header date is compact — "Fri 22 Aug" — beside the timezone. The year is
// noise on a page that only ever shows today.
const headerFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** Current Amsterdam calendar date, YYYY-MM-DD. */
export function todayAms(): string {
  return dateFmt.format(new Date()); // en-CA formats as YYYY-MM-DD
}

/** HH:MM in Amsterdam for a stored UTC ISO timestamp. */
export function amsTime(playedAtIso: string): string {
  return timeFmt.format(new Date(playedAtIso));
}

/** Header date for today, e.g. "Sat 22 Aug". */
export function todayDisplay(): string {
  return headerFmt.format(new Date());
}

/** Amsterdam wall clock of a UTC instant, encoded as a UTC ms value. */
function amsWallMs(utcMs: number): number {
  const parts = wallFmt.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
}

/** UTC instant of Amsterdam midnight starting `dateStr` (DST-safe). */
function amsMidnightUtc(dateStr: string): Date {
  const want = Date.parse(`${dateStr}T00:00:00Z`);
  let guess = want;
  for (let i = 0; i < 4; i++) {
    const diff = amsWallMs(guess) - want;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`); // noon avoids date-line edges
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** UTC ISO range [start, end) covering the current Amsterdam day. */
export function todayRangeUtc(): { startIso: string; endIso: string } {
  const today = todayAms();
  return {
    startIso: amsMidnightUtc(today).toISOString(),
    endIso: amsMidnightUtc(nextDay(today)).toISOString(),
  };
}
