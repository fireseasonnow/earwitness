/**
 * Every moment the page prints, rendered in one time zone: Amsterdam on the
 * server, the reader's own zone in the browser (`localize.ts`).
 *
 * Self-contained by contract: the page serialises it into an inline script with
 * `Function.prototype.toString`, so it may reference nothing outside its own
 * body. Omit `timeZone` for the runtime's own zone.
 */
export function clock(timeZone?: string) {
  const fmt = (locale: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone });

  const dateFmt = fmt("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
  // `hour: "2-digit"` keeps every reading eight characters, which the log's
  // fixed-width time column depends on.
  const timeFmt = fmt("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
  const dayFmt = fmt("en-GB", { weekday: "short", day: "numeric", month: "short" });
  const zoneFmt = fmt("en-US", { timeZoneName: "long" });
  const wallFmt = fmt("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  /** Wall clock of a UTC instant in this zone, encoded as a UTC ms value. */
  const wallMs = (utcMs: number): number => {
    const parts = wallFmt.formatToParts(new Date(utcMs));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  };

  /** YYYY-MM-DD. */
  const date = (at: Date | string): string => dateFmt.format(new Date(at));
  /** "09:41 AM". */
  const time = (at: Date | string): string => timeFmt.format(new Date(at));
  /** "Sat 22 Aug". */
  const day = (at: Date | string): string => dayFmt.format(new Date(at));

  return {
    date,
    time,
    day,

    /** "Pacific Standard Time", following daylight saving. Empty if unnamed. */
    zone(at: Date | string): string {
      return zoneFmt.formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? "";
    },

    /** The time alone on `now`'s date, with the day in front otherwise. */
    stamp(at: Date | string, now: Date): string {
      return date(at) === date(now) ? time(at) : `${day(at)}, ${time(at)}`;
    },

    /**
     * The instant `now`'s day began. A named zone is solved by stepping from
     * midnight-read-as-UTC by the wall-clock error; never a fixed 24-hour
     * offset, since days run 23 and 25 hours twice a year.
     */
    dayStart(now: Date): Date {
      if (timeZone === undefined) {
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      }
      const target = date(now);
      const want = Date.parse(`${target}T00:00:00Z`);
      let guess = want;
      for (let i = 0; i < 4; i++) {
        const diff = wallMs(guess) - want;
        if (diff === 0) break;
        guess -= diff;
      }
      // Where clocks skip midnight itself (Havana, the Azores), the day begins
      // at the end of the gap, and the solver can settle just before it.
      if (date(new Date(guess)) !== target) guess += want - wallMs(guess);
      return new Date(guess);
    },
  };
}

export type Clock = ReturnType<typeof clock>;

export const AMSTERDAM = clock("Europe/Amsterdam");
