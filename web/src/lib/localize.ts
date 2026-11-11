import type { Clock } from "./time";

/**
 * Re-renders the page in the reader's time zone and cuts the log at their
 * midnight. The server can't: Cloudflare serves one render to every reader in a
 * colo, so it renders Amsterdam and marks what to rewrite:
 *
 *   [data-at]          a log row; removed before the reader's midnight, shown after
 *   time[data-time]    a bare time
 *   time[data-stamp]   a moment in a sentence, which names its day if not today
 *   [data-today]       the header date
 *   [data-zone]        the header's zone label: the zone the browser reports
 *   [data-local]       copy only true in Amsterdam, replaced by the attribute
 *   [data-count]       the row count
 *
 * Without JavaScript the Amsterdam page stands on its own. Self-contained by
 * contract, like `clock`: it is serialised into the page.
 */
export function localize(doc: Document, c: Clock, now: Date): void {
  const start = c.dayStart(now).toISOString();
  for (const row of doc.querySelectorAll<HTMLElement>("[data-at]")) {
    if ((row.dataset.at ?? "") < start) row.remove();
    else row.hidden = false;
  }
  for (const t of doc.querySelectorAll<HTMLTimeElement>("time[data-time]")) {
    t.textContent = c.time(t.dateTime);
  }
  for (const t of doc.querySelectorAll<HTMLTimeElement>("time[data-stamp]")) {
    t.textContent = c.stamp(t.dateTime, now);
  }
  for (const el of doc.querySelectorAll<HTMLElement>("[data-today]")) {
    el.textContent = c.day(now);
  }
  const zone = c.zone(now);
  for (const el of doc.querySelectorAll<HTMLElement>("[data-zone]")) {
    el.textContent = zone.length > 0 ? zone : "your time";
  }
  for (const el of doc.querySelectorAll<HTMLElement>("[data-local]")) {
    el.textContent = el.dataset.local ?? el.textContent;
  }
  const count = doc.querySelector<HTMLElement>("[data-count]");
  if (count !== null) count.textContent = String(doc.querySelectorAll("[data-at]").length);
}

/** The inline script: `localize` in the reader's zone, built from the tested source. */
export function localizeScript(clockFn: (timeZone?: string) => Clock): string {
  return `(${localize.toString()})(document, (${clockFn.toString()})(), new Date());`;
}
