import { describe, expect, test } from "bun:test";
import {
  classifyClient,
  countryCode,
  describeArrival,
  formatArrival,
  isPageView,
  refererSource,
  timeZone,
  viaTag,
} from "../src/lib/arrival";
import { ORIGIN } from "../src/lib/metadata";

/**
 * Three separate things are pinned here, and only the first is about counting:
 *
 *   the ARRIVAL rule    a refresh is not an arrival, so the record is not a
 *                       count of tab-hours
 *   the ANONYMITY rule  no raw user-agent, no IP, no city, ever, whatever a
 *                       client sends
 *   the LINE format     one event and seven space-free fields, because the
 *                       README's `awk` queries are the read side of this module
 *
 * The second and third have no other guard. A field that starts carrying a
 * client's own text, or a space, breaks a promise the README makes in prose,
 * and nothing else in the build would notice.
 */

/**
 * The unit tests below name their own host rather than the real one: the rule is
 * about a referrer matching a name we answer to, not about which name that is.
 * The `describeArrival` cases use the deployed hostname, because composing the
 * list of our own names is that function's job.
 */
const SELF = "earwitness.example";
const SELVES = [SELF];
const CANONICAL = new URL(ORIGIN).hostname;

/** Real-world strings, trimmed of nothing: the classifier's whole input. */
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  samsungPhone:
    "Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
  ipadModern:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  windowsEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  linuxFirefox: "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0",
  iosFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  googlebot:
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/126.0.0.0 Safari/537.36",
  bingbotMobile:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 7_0 like Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Version/7.0 Mobile/11A465 Safari/9537.53 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
  curl: "curl/8.6.0",
  headless:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36",
};

/** A request as it reaches the origin through the tunnel. */
function request(
  path: string,
  headers: Record<string, string> = {},
  host = CANONICAL,
): { url: URL; headers: Headers } {
  return { url: new URL(`https://${host}${path}`), headers: new Headers(headers) };
}

describe("refererSource — what counts as an arrival", () => {
  test("our own host is not an arrival: that is the 30 s meta refresh", () => {
    // The rule the whole record rests on. Without it a single tab left open all
    // day reports 2,880 arrivals from ourselves.
    expect(refererSource(`https://${SELF}/`, SELVES)).toBeNull();
    expect(refererSource(`https://${SELF}/?via=hn`, SELVES)).toBeNull();
  });

  test("host matching ignores case", () => {
    expect(refererSource(`https://EarWitness.Example/`, SELVES)).toBeNull();
  });

  test("any name we answer to counts as ourselves", () => {
    // The canonical hostname AND the host this request arrived on: one is what a
    // browser reports whatever the tunnel did to `Host`, the other is what makes
    // a refresh on localhost a refresh.
    const selves = [CANONICAL, "localhost"];
    expect(refererSource(`https://${CANONICAL}/`, selves)).toBeNull();
    expect(refererSource("http://localhost:4321/", selves)).toBeNull();
    expect(refererSource("https://elsewhere.example/", selves)).toBe("elsewhere.example");
  });

  test("a different host keeps hostname and path", () => {
    expect(refererSource("https://news.ycombinator.com/item?id=123", SELVES)).toBe(
      "news.ycombinator.com/item",
    );
    expect(refererSource("https://www.reddit.com/r/webdev/comments/abc/title/", SELVES)).toBe(
      "www.reddit.com/r/webdev/comments/abc/title/",
    );
  });

  test("the referring query string is dropped, always", () => {
    // It belongs to the referring site and can carry somebody's session token.
    expect(refererSource("https://mail.example/read?token=SECRET&id=9", SELVES)).toBe(
      "mail.example/read",
    );
  });

  test("a root path collapses to the bare hostname", () => {
    expect(refererSource("https://bsky.app/", SELVES)).toBe("bsky.app");
  });

  test("no referrer at all is `direct`, and so is junk", () => {
    // Same bucket on purpose: both mean the client told us nothing usable.
    expect(refererSource(null, SELVES)).toBe("direct");
    expect(refererSource("", SELVES)).toBe("direct");
    expect(refererSource("   ", SELVES)).toBe("direct");
    expect(refererSource("not a url", SELVES)).toBe("direct");
    expect(refererSource("/relative/only", SELVES)).toBe("direct");
  });

  test("an app referrer is a real source and is kept", () => {
    // What Android mail and chat clients send. The scheme is not the point; the
    // app is.
    expect(refererSource("android-app://com.google.android.gm/", SELVES)).toBe(
      "com.google.android.gm",
    );
  });

  test("a scheme with no host carries no source", () => {
    // `about:blank` parses, and its pathname would otherwise be logged as if it
    // were a hostname.
    expect(refererSource("about:blank", SELVES)).toBe("direct");
    expect(refererSource("data:text/html,<a href=x>", SELVES)).toBe("direct");
  });

  test("a hostile referrer cannot write a line of its own", () => {
    const forged = refererSource(
      "https://evil.example/x\n2026-08-27T09:41:12.000Z play Forged — Row",
      SELVES,
    );
    expect(forged).not.toContain("\n");
    expect(forged).not.toContain(" ");
  });

  test("an oversized referrer is bounded", () => {
    const long = refererSource(`https://evil.example/${"a".repeat(9000)}`, SELVES);
    expect(long!.length).toBeLessThanOrEqual(120);
  });
});

describe("viaTag — the tag we posted ourselves", () => {
  test("a tag we chose is kept, normalised to lower case", () => {
    expect(viaTag("hn")).toBe("hn");
    expect(viaTag("BSky")).toBe("bsky");
    expect(viaTag("claude-fm_1")).toBe("claude-fm_1");
  });

  test("anything else is rejected rather than scrubbed", () => {
    // A stranger appending to the URL is not a mangled tag of ours.
    expect(viaTag(null)).toBe("-");
    expect(viaTag("")).toBe("-");
    expect(viaTag("hn bsky")).toBe("-");
    expect(viaTag("<script>")).toBe("-");
    expect(viaTag("a".repeat(17))).toBe("-");
  });
});

describe("countryCode and timeZone — the geography that is collected", () => {
  test("a country code is two characters, letters or not", () => {
    expect(countryCode("NL")).toBe("NL");
    expect(countryCode("nl")).toBe("NL");
    expect(countryCode("XX")).toBe("XX"); // Cloudflare's unknown
    expect(countryCode("T1")).toBe("T1"); // Cloudflare's Tor
    expect(countryCode("Netherlands")).toBe("-");
    expect(countryCode(null)).toBe("-");
  });

  test("a zone name is kept whole; a city name would not parse and is not read", () => {
    expect(timeZone("Europe/Amsterdam")).toBe("Europe/Amsterdam");
    expect(timeZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(timeZone("Etc/GMT+5")).toBe("Etc/GMT+5");
    expect(timeZone("New York")).toBe("-"); // a space would break the format
    expect(timeZone(null)).toBe("-");
  });
});

describe("classifyClient — three buckets, then the string is dropped", () => {
  const cases: Array<[string, string, ReturnType<typeof classifyClient>]> = [
    ["iPhone Safari", UA.iphoneSafari, { device: "mobile", ua: "safari", bot: false }],
    ["Android Chrome", UA.androidChrome, { device: "mobile", ua: "chrome", bot: false }],
    ["Android tablet omits Mobi", UA.androidTablet, { device: "tablet", ua: "chrome", bot: false }],
    ["Samsung Internet is Chromium", UA.samsungPhone, { device: "mobile", ua: "chrome", bot: false }],
    ["Edge is Chromium", UA.windowsEdge, { device: "desktop", ua: "chrome", bot: false }],
    ["Windows Chrome", UA.windowsChrome, { device: "desktop", ua: "chrome", bot: false }],
    ["macOS Safari", UA.macSafari, { device: "desktop", ua: "safari", bot: false }],
    ["Linux Firefox", UA.linuxFirefox, { device: "desktop", ua: "firefox", bot: false }],
    ["iOS Firefox", UA.iosFirefox, { device: "mobile", ua: "firefox", bot: false }],
    ["Googlebot", UA.googlebot, { device: "desktop", ua: "chrome", bot: true }],
    ["bingbot wearing an iPhone", UA.bingbotMobile, { device: "mobile", ua: "safari", bot: true }],
    ["curl", UA.curl, { device: "desktop", ua: "other", bot: true }],
    ["headless Chrome", UA.headless, { device: "desktop", ua: "chrome", bot: true }],
  ];

  for (const [name, ua, expected] of cases) {
    test(name, () => expect(classifyClient(ua)).toEqual(expected));
  }

  test("no user agent is filed as a bot", () => {
    // No mainstream browser omits it; scripted clients routinely do.
    expect(classifyClient(null).bot).toBe(true);
    expect(classifyClient("").bot).toBe(true);
  });

  test("a modern iPad reports as desktop, and that is known", () => {
    // iPadOS 13+ sends a Mac user agent by default. Documented in `arrival.ts`:
    // it costs the tablet share, not the split the breakpoints are chosen on.
    expect(classifyClient(UA.ipadModern).device).toBe("desktop");
  });

  test("Chromium is never filed as Safari, though its UA says Safari", () => {
    for (const ua of [UA.androidChrome, UA.windowsChrome, UA.windowsEdge, UA.samsungPhone]) {
      expect(classifyClient(ua).ua).toBe("chrome");
    }
  });
});

describe("describeArrival — the record of one visit", () => {
  test("a Hacker News arrival on a phone, with the location headers on", () => {
    const { url, headers } = request("/", {
      referer: "https://news.ycombinator.com/",
      "user-agent": UA.androidChrome,
      "cf-ipcountry": "nl",
      "cf-timezone": "Europe/Amsterdam",
    });
    expect(describeArrival(url, headers)).toEqual({
      ref: "news.ycombinator.com",
      via: "-",
      country: "NL",
      tz: "Europe/Amsterdam",
      device: "mobile",
      ua: "chrome",
      bot: false,
    });
  });

  test("a tagged link with no referrer keeps its attribution", () => {
    const { url, headers } = request("/?via=bsky", { "user-agent": UA.iphoneSafari });
    const arrival = describeArrival(url, headers)!;
    expect(arrival.ref).toBe("direct");
    expect(arrival.via).toBe("bsky");
  });

  test("a refresh is no record at all, even carrying every other field", () => {
    const { url, headers } = request("/?via=hn", {
      referer: `https://${CANONICAL}/?via=hn`,
      "user-agent": UA.windowsChrome,
      "cf-ipcountry": "NL",
      "cf-timezone": "Europe/Amsterdam",
    });
    expect(describeArrival(url, headers)).toBeNull();
  });

  test("a refresh is a refresh whichever of our names the request arrived on", () => {
    // The canonical name holds when the tunnel rewrites `Host` — the request
    // below arrives as `localhost` and the browser still reports the real one.
    const rewritten = request(
      "/",
      { referer: `https://${CANONICAL}/`, "user-agent": UA.windowsChrome },
      "localhost",
    );
    expect(describeArrival(rewritten.url, rewritten.headers)).toBeNull();

    // And the request's own host holds in development, where the canonical name
    // never appears.
    const dev = request(
      "/",
      { referer: "http://localhost:4321/", "user-agent": UA.windowsChrome },
      "localhost",
    );
    expect(describeArrival(dev.url, dev.headers)).toBeNull();
  });

  test("missing Cloudflare headers degrade to `-`, not to an empty field", () => {
    // What local development and a direct origin hit look like.
    const { url, headers } = request("/", { "user-agent": UA.macSafari });
    const arrival = describeArrival(url, headers)!;
    expect(arrival.country).toBe("-");
    expect(arrival.tz).toBe("-");
  });
});

describe("formatArrival — the line IS the interface", () => {
  test("one event and seven fields, in order", () => {
    const { url, headers } = request("/?via=hn", {
      referer: "https://news.ycombinator.com/item?id=123",
      "user-agent": UA.androidChrome,
      "cf-ipcountry": "NL",
      "cf-timezone": "Europe/Amsterdam",
    });
    expect(formatArrival(describeArrival(url, headers)!)).toBe(
      "arrival ref=news.ycombinator.com/item via=hn country=NL tz=Europe/Amsterdam" +
        " device=mobile ua=chrome bot=0",
    );
  });

  test("eight space-separated tokens, whatever a client sends", () => {
    // The README's `awk` splits on spaces. A field carrying one would shift every
    // column after it and silently corrupt a query rather than fail it.
    const { url, headers } = request("/?via=hn%20bsky", {
      referer: "https://evil.example/a b c?q=d e f",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/1.0 Mobile Safari/537.36",
      "cf-ipcountry": "N L",
      "cf-timezone": "Europe/New York",
    });
    const line = formatArrival(describeArrival(url, headers)!);
    expect(line.split(" ")).toHaveLength(8);
    expect(line.split(" ")[0]).toBe("arrival");
  });

  test("the raw user-agent string never reaches the line", () => {
    // The anonymity claim, mechanically: a version, a device model and an OS
    // build are all in the input and none of them may come out.
    const { url, headers } = request("/", {
      referer: "https://bsky.app/",
      "user-agent": UA.samsungPhone,
    });
    const line = formatArrival(describeArrival(url, headers)!);
    for (const fragment of ["SM-S911B", "23.0", "Android 13", "AppleWebKit", "537.36"]) {
      expect(line).not.toContain(fragment);
    }
  });

  test("a bot arrival is flagged rather than dropped", () => {
    const { url, headers } = request("/", { "user-agent": UA.googlebot });
    expect(formatArrival(describeArrival(url, headers)!)).toContain("bot=1");
  });
});

describe("isPageView — derived from the response, not the path", () => {
  const HTML = "text/html; charset=utf-8";

  test("a rendered page is a page view", () => {
    expect(isPageView("GET", 200, HTML)).toBe(true);
  });

  test("a 404 is not, however HTML it looks", () => {
    // A live domain collects probes for /wp-login.php within hours of going up.
    expect(isPageView("GET", 404, HTML)).toBe(false);
  });

  test("an asset is not, and neither is a non-GET", () => {
    expect(isPageView("GET", 200, "image/svg+xml")).toBe(false);
    expect(isPageView("GET", 200, "text/css")).toBe(false);
    expect(isPageView("GET", 200, null)).toBe(false);
    expect(isPageView("HEAD", 200, HTML)).toBe(false);
    expect(isPageView("POST", 200, HTML)).toBe(false);
  });
});
