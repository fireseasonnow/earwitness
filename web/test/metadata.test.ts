import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  absolute,
  CARD,
  DESCRIPTION_BUDGET,
  ORIGIN,
  PAGE_DESCRIPTION,
  PAGE_TITLE,
  SITE_NAME,
} from "../src/lib/metadata";

/**
 * The head is the only part of this page a stranger reads before deciding
 * whether to open it, and nothing else in the build looks at it: a description
 * that never reaches the markup renders exactly like one that does, and no
 * screenshot at any width would show the difference.
 *
 * Five things are held here:
 *
 *   the BUDGET     a description longer than a result or an unfurl will show is
 *                  a sentence finished for nobody
 *   the DISCLAIMER the unfurl reaches people who never open the page, so it
 *                  names the station and denies the affiliation like the footer
 *   the CARD       the dimensions in the head are the PNG's own, or a scraper
 *                  lays out a frame the image does not fill — and its URL
 *                  carries the version that is the only cache bust platforms
 *                  honour
 *   the WELCOME    `robots.txt` blocks nobody, which is a decision, and a stray
 *                  `Disallow: /` would delist the site invisibly
 *   the CALL SITES the words and the origin are in `lib/metadata.ts`, or the
 *                  head and the config quietly grow copies of them
 */

const PACKAGE = join(import.meta.dir, "..");
const WEB = join(PACKAGE, "src");
const layoutSrc = readFileSync(join(WEB, "layouts", "Layout.astro"), "utf8");
const indexSrc = readFileSync(join(WEB, "pages", "index.astro"), "utf8");
const configSrc = readFileSync(join(PACKAGE, "astro.config.mjs"), "utf8");

/**
 * This site's hostname typed into a file instead of taken from `ORIGIN`, `www.`
 * or not. Built from `ORIGIN` so the guard has no copy of the domain either, and
 * narrow to this host on purpose: the footer's GitHub link and the font CDN are
 * absolute URLs that belong where they are.
 */
const HOSTNAME_LITERAL = new RegExp(
  `https?://[\\w.-]*${new URL(ORIGIN).hostname.replaceAll(".", "\\.")}`,
);

describe("the description is written for where it is read", () => {
  test("it fits what a search result and an unfurl will show", () => {
    expect(PAGE_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_BUDGET);
  });

  /** Truncation aside, a fragment reads as a mistake wherever it lands. */
  test("it is whole sentences", () => {
    expect(PAGE_DESCRIPTION.trim()).toBe(PAGE_DESCRIPTION);
    expect(PAGE_DESCRIPTION.endsWith(".")).toBe(true);
  });

  /**
   * The footer's two claims, in the one place a reader meets before the page.
   * The station, because "play log" alone says nothing; the denial, because the
   * name in the sentence above it is Anthropic's.
   */
  test("it names the station and denies the affiliation", () => {
    expect(PAGE_DESCRIPTION).toContain("Claude FM");
    expect(PAGE_DESCRIPTION).toContain("not affiliated with Anthropic");
  });
});

describe("the title says whose log this is", () => {
  test("it carries the wordmark and the station", () => {
    expect(PAGE_TITLE).toContain(SITE_NAME);
    expect(PAGE_TITLE).toContain("Claude FM");
  });
});

/**
 * A card is fetched by a scraper, from an absolute URL, over the scheme this
 * site actually serves — three things the request cannot supply, so they come
 * from `ORIGIN` and are checked here rather than discovered in a debugger.
 */
describe("the origin is absolute, https, and stated once", () => {
  test("it is an https origin and nothing more", () => {
    const url = new URL(ORIGIN);
    expect(url.protocol).toBe("https:");
    expect(url.pathname).toBe("/");
    // A trailing slash or a path would make `absolute` build a URL under it.
    expect(ORIGIN.endsWith("/")).toBe(false);
  });

  test("absolute() puts a path on it", () => {
    expect(absolute("/")).toBe(`${ORIGIN}/`);
    expect(absolute(CARD.path)).toBe(`${ORIGIN}${CARD.path}`);
  });

  /** Two copies of a domain is how one of them goes stale. */
  test("astro.config.mjs takes `site` from here rather than repeating it", () => {
    expect(configSrc).toContain("ORIGIN");
    expect(configSrc).toContain("site: ORIGIN");
    expect(HOSTNAME_LITERAL.test(configSrc)).toBe(false);
    expect(HOSTNAME_LITERAL.test(layoutSrc)).toBe(false);
  });
});

/**
 * The card the platforms fetch is a rendered artifact, not source, so nothing in
 * the build would notice it missing, stale in size, or replaced by a crop.
 */
describe("the card in the head is the card on disk", () => {
  const png = readFileSync(join(PACKAGE, "public", CARD.path));

  test("it is a PNG of the dimensions the head declares", () => {
    // IHDR: width and height are the two big-endian words after the signature.
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(CARD.width);
    expect(png.readUInt32BE(20)).toBe(CARD.height);
  });

  /**
   * 1.91:1 is the frame every unfurl crops to. A card at another ratio is not
   * broken, it is cropped — which takes the wordmark off centre and is the kind
   * of thing nobody sees until it is on someone else's timeline.
   */
  test("it is the ratio the platforms crop to", () => {
    // 1200x630 is 1.905, which is the frame as everyone ships it.
    expect(Math.abs(CARD.width / CARD.height - 1.91)).toBeLessThan(0.01);
  });

  /**
   * Every platform caches a card under the URL it first fetched, so new bytes at
   * an old path reach nobody who has already shared a link. The version in the
   * name IS the cache bust, which makes the shape of the name load-bearing — and
   * a redraw that overwrites the current file in place passes every other test
   * in this file while reaching no existing reader.
   */
  test("the name carries a version, so a redraw is a new URL", () => {
    expect(CARD.path).toMatch(/^\/og-card-\d+\.png$/);
  });

  /**
   * The card a bump replaced is unreferenced from the moment `CARD.path` moves,
   * and an unreferenced 20 KB PNG beside the live one is how the wrong card gets
   * re-rendered a year later.
   */
  test("only the current card ships", () => {
    const shipped = readdirSync(join(PACKAGE, "public")).filter((f) =>
      f.startsWith("og-card-"),
    );
    expect(shipped).toEqual([CARD.path.slice(1)]);
  });

  test("the head declares it whole: URL, both numbers, and alt text", () => {
    expect(layoutSrc).toContain('property="og:image" content={absolute(CARD.path)}');
    expect(layoutSrc).toContain('property="og:image:width" content={String(CARD.width)}');
    expect(layoutSrc).toContain('property="og:image:height" content={String(CARD.height)}');
    expect(layoutSrc).toContain('property="og:image:alt" content={CARD.alt}');
    // The large card is the point of having one at all.
    expect(layoutSrc).toContain('name="twitter:card" content="summary_large_image"');
    expect(CARD.alt.length).toBeGreaterThan(20);
  });
});

/**
 * The one file here that no build step reads, no type checker sees and no
 * screenshot at any width would show — while hiding the largest failure
 * available on this site: a stray `Disallow: /` delists the page outright and
 * leaves it looking perfect from every other angle.
 *
 * It blocks nobody, AI crawlers included, and the file itself carries the
 * reasoning. This is the decision written down where a regression trips over it.
 */
describe("robots.txt lets everyone in", () => {
  const directives = readFileSync(join(PACKAGE, "public", "robots.txt"), "utf8")
    .split("\n")
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);

  /** A bare `Disallow:` is the allow-everything spelling; a path is a block. */
  const BLOCK = /^Disallow:\s*\S/i;

  test("it allows every crawler and blocks none", () => {
    expect(directives).toContain("User-agent: *");
    expect(directives).toContain("Allow: /");
    expect(directives.filter((d) => BLOCK.test(d))).toEqual([]);
  });

  /**
   * One SSR route: `@astrojs/sitemap` would emit an empty urlset, and the only
   * URL it could name is the homepage every crawler starts from. A `<lastmod>`
   * is the one thing a sitemap would add, and a page that changes every 30 s and
   * empties at Amsterdam midnight has no honest value to put in it.
   */
  test("it names no sitemap, because there is none to name", () => {
    expect(directives.filter((d) => /^Sitemap:/i.test(d))).toEqual([]);
  });

  test("the guard would catch a block that arrived later", () => {
    expect(BLOCK.test("Disallow: /")).toBe(true);
    expect(BLOCK.test("Disallow: /og-card-1.png")).toBe(true);
    expect(BLOCK.test("Disallow:")).toBe(false);
  });
});

/**
 * Every test above passes while the head carries a literal of its own, or
 * carries nothing at all, which is the whole failure this file exists to
 * prevent — so both sources are asserted directly.
 */
describe("the head takes its words from this module", () => {
  /** A title or description typed into the markup instead of imported. */
  const HARDCODED_WORDS = /(?:title|description)="/;

  test("index.astro passes the constants and no words of its own", () => {
    expect(indexSrc).toContain("PAGE_TITLE");
    expect(indexSrc).toContain("PAGE_DESCRIPTION");
    expect(HARDCODED_WORDS.test(indexSrc)).toBe(false);
  });

  test("Layout.astro renders both into the head, and into the unfurl", () => {
    expect(layoutSrc).toContain("<title>{title}</title>");
    expect(layoutSrc).toContain('name="description" content={description}');
    expect(layoutSrc).toContain('property="og:title" content={title}');
    expect(layoutSrc).toContain('property="og:description" content={description}');
    expect(layoutSrc).toContain("SITE_NAME");
  });

  test("the canonical and og:url are the same absolute URL, built here", () => {
    expect(layoutSrc).toContain("absolute(Astro.url.pathname)");
    expect(layoutSrc).toContain('rel="canonical" href={canonical}');
    expect(layoutSrc).toContain('property="og:url" content={canonical}');
  });

  test("the guards would catch either violation", () => {
    // A guard whose pattern cannot match a real regression passes forever.
    expect(HARDCODED_WORDS.test('<Layout title="Earwitness" autoRefresh>')).toBe(true);
    expect(HOSTNAME_LITERAL.test(`site: "${ORIGIN}",`)).toBe(true);
    expect(HOSTNAME_LITERAL.test("site: ORIGIN,")).toBe(false);
  });
});

/**
 * The icons, which are rendered artifacts like the card and just as invisible to
 * the build: a `<link>` pointing at a file that is not there renders exactly
 * like one that is, and the browser quietly falls back to the next candidate or
 * to nothing at all.
 *
 * Three properties, each with a consumer behind it:
 *
 *   they EXIST      a declared icon that 404s is worse than an undeclared one —
 *                   `/favicon.ico` was a 404 here for exactly that reason
 *   they are SQUARE an image crawler wants 1:1, and a search result's icon is
 *                   the only picture of this site most people will ever see
 *   the TOUCH ICON  iOS composites onto black, so an alpha channel there is a
 *                   mark floating on a dark rectangle rather than on paper
 */
describe("the icons in the head are the icons on disk", () => {
  const PUBLIC = join(PACKAGE, "public");
  const declared = [...layoutSrc.matchAll(/<link rel="[^"]*icon[^"]*"[^>]*href="([^"]+)"/g)].map(
    (m) => m[1],
  );

  test("the head declares the raster set, not the SVG alone", () => {
    expect(declared).toContain("/favicon.ico");
    expect(declared).toContain("/favicon.svg");
    expect(declared).toContain("/favicon-96.png");
    expect(declared).toContain("/apple-touch-icon.png");
  });

  test("every declared icon is a file that is actually served", () => {
    for (const href of declared) {
      expect(existsSync(join(PUBLIC, href))).toBe(true);
    }
  });

  test("the rasters are square, and the crawler's one is a multiple of 48", () => {
    for (const href of declared.filter((h) => h.endsWith(".png"))) {
      const png = readFileSync(join(PUBLIC, href));
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect(w).toBe(h);
    }
    const crawler = readFileSync(join(PUBLIC, "favicon-96.png"));
    expect(crawler.readUInt32BE(16)).toBe(96);
    expect(96 % 48).toBe(0);
  });

  /** Colour types 4 and 6 are the two that carry alpha. */
  test("the touch icon is opaque, because iOS composites it onto black", () => {
    const png = readFileSync(join(PUBLIC, "apple-touch-icon.png"));
    expect([4, 6]).not.toContain(png.readUInt8(25));
  });

  test("favicon.ico is a real ICO and not a PNG with the wrong name", () => {
    const ico = readFileSync(join(PUBLIC, "favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0); // at least one image
  });

  /** The source all four are rendered from. A non-square viewBox would letterbox
      every raster below it without changing a single declared dimension. */
  test("the SVG they are all drawn from is square", () => {
    const svg = readFileSync(join(PUBLIC, "favicon.svg"), "utf8");
    const box = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    expect(box).not.toBeNull();
    expect(box![1]).toBe(box![2]);
  });
});
