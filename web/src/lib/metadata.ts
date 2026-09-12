/**
 * What the page says about itself where it is not the page: a browser tab, a
 * search result, a chat unfurl. These are WORDS — the same split
 * `presentation.ts` keeps from `health.ts`.
 *
 * The Anthropic disclaimer is in the description on purpose. A shared link is
 * read by people who have not opened the page, so the unfurl is the first place
 * the "independent, not Anthropic's" claim has to appear; the footer is the
 * second, and the README's opening line is the third.
 *
 * `og:url`, `og:image` and `rel="canonical"` all have to be absolute, so the
 * origin is here too — it cannot be taken from the request. TLS terminates at
 * the edge and the node adapter reads the scheme off its own socket rather than
 * `X-Forwarded-Proto`, so `Astro.url` says `http://…` for a page served over
 * HTTPS, and a card fetched from a scheme this site does not serve is a card
 * nobody sees.
 */

/** `og:site_name`, and the wordmark the header draws. */
export const SITE_NAME = "Earwitness";

/**
 * Where this site is served, and the one place that says so — `site` in
 * `astro.config.mjs` imports it from here rather than repeating it.
 *
 * The apex, not `www`. A Cloudflare redirect rule 301s `www` here, path and
 * query intact, so the two hostnames are one page before a request reaches this
 * process at all — which also keeps the edge to one cache entry per render
 * rather than one per hostname. The absolute canonical this builds is the
 * backstop under that rule, not the only thing making the claim.
 *
 * Deployment config stays out of the repo by design, but a public URL is not
 * deployment config: it is what the page says about itself while being read
 * somewhere else.
 */
export const ORIGIN = "https://earwitness.fyi";

/** A path on this site as the absolute URL a scraper or a crawler needs. */
export function absolute(path: string): string {
  return new URL(path, ORIGIN).href;
}

/** The tab, the search result's first line, the card's heading — the wordmark
 * and tagline joined by the ` — ` that joins artist to title everywhere else. */
export const PAGE_TITLE = `${SITE_NAME} — play log for Claude FM`;

/**
 * How much of the description is actually read: Google renders ~155–160
 * characters and an unfurl is tighter still. A judgement call; the test holds
 * the line rather than the value.
 */
export const DESCRIPTION_BUDGET = 160;

export const PAGE_DESCRIPTION =
  "What Claude FM has played today, read off the stream's own credit ticker as it " +
  "scrolls. An independent project, not affiliated with Anthropic.";

/**
 * The social card. `docs/og-card.svg` is the source and `docs/field-notes.md`
 * has the command that renders it; this is the artifact platforms fetch.
 *
 * 1200×630 is the frame every unfurl crops to, declared in the head so a scraper
 * can lay the card out before the image arrives — so they must be the PNG's own
 * dimensions, which `test/metadata.test.ts` reads the file to confirm. It carries
 * no song and no state: platforms cache a card for days, and anything it said
 * about the air would be a stale claim in someone else's timeline.
 *
 * The filename carries a version because that cache is keyed by URL and nothing
 * else, and a `?v=` query is normalised away by enough scrapers not to be a bust.
 * A redraw is therefore a NEW path — bump the number, re-render, delete the old
 * file — and everyone who already shared a link keeps the card from before the
 * edit until it changes. `test/metadata.test.ts` holds the shape of the name.
 */
export const CARD = {
  path: "/og-card-2.png",
  width: 1200,
  height: 630,
  alt: "The Earwitness mark and wordmark on the stream's paper ground.",
} as const;
