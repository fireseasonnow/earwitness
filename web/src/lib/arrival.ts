/**
 * What the journal records about an arrival, and the rules that keep the record
 * anonymous.
 *
 * Traffic telemetry obeys the rule the failure counts obey: a reader cannot act
 * on it, so it goes to the journal where the operator is — never onto the page,
 * and never into `$EARWITNESS_STATE`, which holds one day of plays and nothing
 * about whoever read them.
 *
 * **These lines are a sample, by construction.** Only origin renders reach this
 * code, and `EDGE_TTL_SECONDS` bounds those at roughly six a minute per colo
 * however large the audience. Whether a given request is the one that misses the
 * cache is independent of where it came from, so PROPORTIONS stay honest ("a
 * third of arrivals came from HN") while absolute counts do not. The totals live
 * in Cloudflare's own edge counters, which see every request and cost nothing.
 *
 * **Every field is a bucket, never a value:** a browser family rather than a
 * version, a country and a timezone rather than a city, no IP and no raw
 * user-agent string anywhere. A bucket describes a population; the raw values,
 * joined on one timestamped line, describe a person. This module is the only
 * place a request header is read, and it returns unions and validated tokens
 * rather than passing text through — so the anonymity is a property of the type
 * signatures, not of a convention someone has to remember.
 */

import { ORIGIN } from "./metadata";

/** Absent, unusable, or rejected. One token, so a column is never missing. */
const NONE = "-";

/**
 * The name this site answers to, from the one place that states it.
 *
 * Taken from `ORIGIN` rather than from the request, for the same reason the
 * canonical URL is: the host the origin process sees is whatever the tunnel
 * forwarded, and `cloudflared --http-host-header` is enough to make every
 * refresh look like a stranger arriving. The request's own hostname is still
 * honoured beside this one — see `describeArrival` — because that is what makes a
 * refresh on `localhost` a refresh during development.
 */
const CANONICAL_HOSTNAME = new URL(ORIGIN).hostname;

export type Device = "mobile" | "tablet" | "desktop";

/** A rendering-engine family rather than a brand — see `browserFamily`. */
export type Browser = "chrome" | "firefox" | "safari" | "other";

export interface Client {
  device: Device;
  ua: Browser;
  bot: boolean;
}

export interface Arrival extends Client {
  /** Referring `hostname/path`, or `direct`. */
  ref: string;
  /** The `?via=` tag of a link we posted ourselves, or `-`. */
  via: string;
  country: string;
  tz: string;
}

/**
 * Printable ASCII, no spaces, bounded.
 *
 * The shape of a log line must not be a client's choice. A referrer is the one
 * field here an untrusted party gets to write, and an 8 KB header full of
 * whitespace would otherwise become several convincing lines of its own.
 */
function printable(value: string, maxLen: number): string {
  const kept = value.replace(/[^\x21-\x7e]/g, "").slice(0, maxLen);
  return kept === "" ? NONE : kept;
}

/**
 * Where this request came from — or null when it is not an arrival at all.
 *
 * Null is the same-host case, and it is most of the traffic: the page
 * meta-refreshes every 30 s and a refresh sends the page's own URL as the
 * referrer, so without this test every line would be a self-referral and the
 * count would measure tab-hours. A reader who leaves the tab open all day is
 * 2,880 requests and, correctly, one arrival.
 *
 * `direct` means the client told us nothing usable: a typed URL, a bookmark, an
 * app webview, a referrer policy that strips cross-origin referrers, or junk. It
 * is an upper bound on "found it on their own", not a measurement of it — which
 * is why `viaTag` exists.
 *
 * Hostname and path, no query string: the query of a referring URL is the
 * referring site's business and can carry somebody's session token, while the
 * path is what tells Hacker News from a subreddit.
 *
 * The scheme is dropped rather than checked, which keeps `android-app://` and
 * the other non-web referrers Android mail and chat clients send — those are
 * real sources, and their hostname is the app. A referrer with no hostname at all
 * (`about:blank`, `data:`) carries no source and joins `direct`.
 *
 * `selfHostnames` is every name this site answers to at once, because "a
 * referrer pointing back at us" is one idea however many hostnames reach the
 * process.
 */
export function refererSource(
  referer: string | null,
  selfHostnames: readonly string[],
): string | null {
  if (referer === null || referer.trim() === "") return "direct";
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return "direct";
  }
  if (url.hostname === "") return "direct";
  const host = url.hostname.toLowerCase();
  if (selfHostnames.some((self) => self.toLowerCase() === host)) return null;
  const path = url.pathname === "/" ? "" : url.pathname;
  return printable(`${url.hostname}${path}`, 120);
}

/**
 * The channel tag from a link we posted ourselves: `/?via=hn`.
 *
 * The half of attribution that survives referrer policy. Bluesky, Discord,
 * Mastodon clients and mail readers routinely send no referrer at all, so a
 * `direct` line and a link we placed by hand are otherwise indistinguishable.
 *
 * A tag costs the edge nothing: the page's cache key carries the route alone —
 * the same decision the canonical in `metadata.ts` rests on — so every tag shares
 * one entry instead of fragmenting the cache, and a tagged arrival is sampled
 * exactly like any other. The tag is read off this request's own URL, which the
 * origin always receives in full whatever the cache key ignores.
 *
 * Rejected rather than scrubbed: a tag is something WE chose, so a value outside
 * `[a-z0-9_-]` is not a mangled tag, it is a stranger's input, and it is not
 * going to appear in the record at all.
 */
export function viaTag(raw: string | null): string {
  if (raw === null) return NONE;
  const tag = raw.toLowerCase();
  return /^[a-z0-9_-]{1,16}$/.test(tag) ? tag : NONE;
}

/**
 * `cf-ipcountry`, which Cloudflare sends as soon as IP geolocation is on.
 *
 * Two characters and not always letters: `XX` is unknown and `T1` is Tor, both
 * of which are answers rather than errors.
 */
export function countryCode(raw: string | null): string {
  if (raw === null) return NONE;
  const code = raw.toUpperCase();
  return /^[A-Z0-9]{2}$/.test(code) ? code : NONE;
}

/**
 * `cf-timezone`, from the **Add visitor location headers** managed transform —
 * free on every plan, and off until switched on.
 *
 * The geography field this project has a use for, and the reason city is not
 * collected. The page is Amsterdam-locked twice over: the times it prints, and
 * the midnight at which the whole day is dropped. So the question with an action
 * behind it is what share of readers meet that rollover in the middle of their
 * own afternoon and find a nearly empty log. Roughly 35 zones survive the cache
 * sampling above; a thousand-bucket city tail would not, IP-to-city is wrong in
 * a mobile-carrier-shaped way, and a city beside a device and a referrer on one
 * timestamped line stops describing a population and starts describing a person.
 */
export function timeZone(raw: string | null): string {
  if (raw === null) return NONE;
  return /^[A-Za-z0-9\/_+-]{1,40}$/.test(raw) ? raw : NONE;
}

/**
 * A filter, not a taxonomy.
 *
 * Free-plan edge analytics counts "legitimate user requests as well as crawlers
 * and threats" with no user-agent dimension to separate them, so this flag is the
 * only thing that keeps every other number on the line from being contaminated.
 * It does not have to be right about WHICH crawler, and a miss costs one line
 * filed as a reader.
 *
 * `bot` as a bare substring also catches the Cubot phones. Twenty entries that
 * cover the traffic are worth more here than a regex database to maintain.
 */
const BOT_MARKERS = [
  "bot",
  "crawl",
  "spider",
  "slurp",
  "scrapy",
  "curl",
  "wget",
  "python-requests",
  "httpx",
  "go-http-client",
  "java/",
  "libwww",
  "headlesschrome",
  "phantomjs",
  "facebookexternalhit",
  "embedly",
  "feedfetcher",
  "uptimerobot",
  "pingdom",
  "monitoring",
];

/**
 * Form factor, which is the question the two breakpoints ask.
 *
 * `Mobi` for a phone is the heuristic the vendors themselves recommend, and an
 * Android tablet is an Android that omits it. One known undercount, unfixable
 * from a user-agent string: iPadOS Safari has reported a desktop Mac UA by
 * default since iPadOS 13, so most iPads land in `desktop`. It costs the tablet
 * share, not the mobile-versus-desktop split the type scale is chosen on.
 */
function deviceKind(ua: string): Device {
  if (/ipad|tablet|playbook|kindle|silk/.test(ua)) return "tablet";
  if (/android/.test(ua) && !/mobi/.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|iemobile|windows phone/.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Family, and `chrome` means the Chromium family — Edge, Opera and Samsung
 * Internet included.
 *
 * That is not laziness about brands: the single action attached to this field is
 * `color-scheme: only light` in `global.css`, which exists because Chromium
 * darkens a light page that declares no scheme. It is a family behaviour, so the
 * family is the bucket. `mobile` + `chrome` is an upper bound on the share that
 * override protects, and an upper bound is enough to decide whether it still
 * earns its place — which is why no `os` field is collected.
 *
 * Order is load-bearing twice: every Chromium UA also says `Safari`, and Edge and
 * Opera also say `Chrome`.
 */
function browserFamily(ua: string): Browser {
  if (/edg|opr\/|opera|samsungbrowser|chrome|chromium|crios/.test(ua)) return "chrome";
  if (/firefox|fxios/.test(ua)) return "firefox";
  if (/safari/.test(ua)) return "safari";
  return "other";
}

/**
 * The three buckets a user-agent string is reduced to, after which the string
 * itself is dropped and never leaves this module.
 *
 * A missing user agent is filed as a bot: no mainstream browser omits it, and
 * scripted clients routinely do. A hardened browser that sends none is
 * misfiled, and that is the cheaper of the two errors.
 */
export function classifyClient(userAgent: string | null): Client {
  if (userAgent === null || userAgent.trim() === "") {
    return { device: "desktop", ua: "other", bot: true };
  }
  const ua = userAgent.toLowerCase();
  return {
    device: deviceKind(ua),
    ua: browserFamily(ua),
    bot: BOT_MARKERS.some((marker) => ua.includes(marker)),
  };
}

/**
 * Everything the journal will know about one arrival, or null when the request
 * is a refresh of a page the same reader already has.
 *
 * Two names count as ourselves: the canonical one, which is what a reader's
 * browser reports whatever the tunnel does to the `Host` header, and the one this
 * request arrived on, which is what covers `localhost` in development and any
 * preview host.
 */
export function describeArrival(url: URL, headers: Headers): Arrival | null {
  const ref = refererSource(headers.get("referer"), [CANONICAL_HOSTNAME, url.hostname]);
  if (ref === null) return null;
  return {
    ref,
    via: viaTag(url.searchParams.get("via")),
    country: countryCode(headers.get("cf-ipcountry")),
    tz: timeZone(headers.get("cf-timezone")),
    ...classifyClient(headers.get("user-agent")),
  };
}

/**
 * One event name and seven `key=value` fields, space-separated, in a fixed
 * order.
 *
 * The format is the interface: the README's `awk` one-liners split on spaces and
 * pick fields by prefix, which is why no field may ever contain a space and why
 * `NONE` fills a gap instead of an empty value. Adding a field is safe; letting
 * one carry a space is not, and a test pins that.
 */
export function formatArrival(a: Arrival): string {
  return (
    `arrival ref=${a.ref} via=${a.via} country=${a.country} tz=${a.tz}` +
    ` device=${a.device} ua=${a.ua} bot=${a.bot ? 1 : 0}`
  );
}

/**
 * Is this response somebody loading the page?
 *
 * Derived from the RESPONSE rather than the request path, which makes one rule
 * cover three exclusions: static assets (a favicon is not an arrival), the bot
 * probes for `/wp-login.php` that a live domain collects within hours (a 404 is
 * not a page view), and anything a future route might serve that is not a
 * document. A second page would be counted correctly without anyone remembering
 * to add it here.
 */
export function isPageView(method: string, status: number, contentType: string | null): boolean {
  if (method !== "GET" || status !== 200) return false;
  return contentType !== null && contentType.toLowerCase().includes("text/html");
}
