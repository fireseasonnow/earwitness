/**
 * Amsterdam day arithmetic. Plays are stored in UTC; the retention boundary is
 * a domain rule pinned to Europe/Amsterdam, so it must not follow the host
 * clock's zone — a VPS in any region prunes the same day as a laptop here.
 *
 * Deliberately duplicated from `web/src/lib/time.ts`: the tracker and the web
 * app are separate Bun packages with no shared module, and the two copies are
 * ~20 lines of `Intl` arithmetic with no dependencies. Do NOT replace the
 * solver below with a fixed 24-hour offset — Amsterdam has 23- and 25-hour
 * days twice a year and the prune boundary would land inside the wrong day.
 */
const TZ = "Europe/Amsterdam";

const dateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
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

/** Amsterdam calendar date (YYYY-MM-DD) of a UTC instant. */
export function amsDateOf(instant: Date): string {
  return dateFmt.format(instant); // en-CA formats as YYYY-MM-DD
}

export function todayAms(): string {
  return amsDateOf(new Date());
}

/** Amsterdam wall clock of a UTC instant, encoded as a UTC ms value. */
function amsWallMs(utcMs: number): number {
  const parts = wallFmt.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
}

/** UTC instant of Amsterdam midnight starting `dateStr` (DST-safe). */
export function amsMidnightUtc(dateStr: string): Date {
  const want = Date.parse(`${dateStr}T00:00:00Z`);
  let guess = want;
  for (let i = 0; i < 4; i++) {
    const diff = amsWallMs(guess) - want;
    if (diff === 0) break;
    guess -= diff;
  }
  return new Date(guess);
}
