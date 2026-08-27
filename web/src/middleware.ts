import type { APIContext, MiddlewareNext } from "astro";
import { describeArrival, formatArrival, isPageView } from "./lib/arrival";

/**
 * One journal line per arrival. The whole of the traffic telemetry.
 *
 * What the rules are and why each field is a bucket: `lib/arrival.ts`. How to
 * read the lines back: the README's Traffic section.
 *
 * The tracker's line format, mirrored deliberately — `<ISO timestamp> <event>
 * <detail>` — so that `journalctl -o cat -u <web-unit> -u <tracker-unit>`
 * interleaves arrivals and plays into one readable timeline. Mirrored rather than
 * shared for the reason `freshness.ts` gives about the tick: `shared/` holds what
 * the two processes must AGREE on, and a log format is not one of those things.
 */
function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}

export async function onRequest(context: APIContext, next: MiddlewareNext): Promise<Response> {
  const response = await next();
  try {
    if (isPageView(context.request.method, response.status, response.headers.get("content-type"))) {
      // Null is a refresh of a page this reader already has, and it is logged as
      // nothing at all: absence is the signal, the same way the tracker's
      // unstamped confirmation flag is.
      const arrival = describeArrival(context.url, context.request.headers);
      if (arrival !== null) log(formatArrival(arrival));
    }
  } catch {
    // Telemetry may never cost a render. The page's contract is that it degrades
    // to a state rather than a stack trace, and a counted visit is worth less
    // than the visit.
  }
  return response;
}
