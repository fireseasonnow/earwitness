/**
 * What the page says about itself where it is not the page: a browser tab, a
 * search result, a chat unfurl.
 *
 * One page means one title and one description, so they are constants and not a
 * function of anything. They live here because they are WORDS — the same split
 * `presentation.ts` keeps from `health.ts`: a copy edit happens in this file and
 * touches nothing that decides behaviour.
 *
 * The Anthropic disclaimer is in the description on purpose. A shared link is
 * read by people who have not opened the page, so the unfurl is the first place
 * the "independent, not Anthropic's" claim has to appear; the footer is the
 * second, and the README's own opening line is the third.
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
 * process at all — which is also what keeps the edge to one cache entry per
 * render rather than one per hostname. The absolute canonical this builds is now
 * the backstop under that rule, not the only thing making the claim.
 *
 * The rest of the deployment stays out of the repo by design — "Deploying it"
 * in the README — but a public URL is not deployment config: it is what the
 * page has to be able to say about itself while being read somewhere else.
 */
export const ORIGIN = "https://earwitness.fyi";

/** A path on this site as the absolute URL a scraper or a crawler needs. */
export function absolute(path: string): string {
  return new URL(path, ORIGIN).href;
}

/**
 * The tab, the search result's first line, the card's heading.
 *
 * The wordmark and the tagline the header already shows, joined by the ` — `
 * that joins an artist to a title everywhere else on the page.
 */
export const PAGE_TITLE = `${SITE_NAME} — play log for Claude FM`;

/**
 * How much of the description is actually read. Google renders ~155–160
 * characters and an unfurl is tighter still, so a sentence past this is written
 * for someone who will never see it — and a clause cut in half reads worse than
 * a shorter one that finished. The number is a judgement call; the test holds
 * the line rather than the value.
 */
export const DESCRIPTION_BUDGET = 160;

export const PAGE_DESCRIPTION =
  "What Claude FM has played today, read off the stream's own credit ticker as it " +
  "scrolls. An independent project, not affiliated with Anthropic.";

/**
 * The social card. `docs/og-card.svg` is the source and the README has the
 * command that renders it; this is the artifact platforms fetch.
 *
 * 1200×630 because that is the frame every unfurl crops to, and the numbers are
 * declared in the head so a scraper can lay out the card before the image
 * arrives — which means they have to be the PNG's own dimensions, and
 * `test/metadata.test.ts` reads the file to check that they are.
 *
 * It draws the mark, the wordmark and the tagline, and deliberately no song and
 * no state: platforms cache a card for days, so anything it said about the air
 * would be a stale claim in someone else's timeline.
 *
 * The filename carries a version because that cache is keyed by URL and nothing
 * else: Slack, X, Facebook and iMessage each hold the card they first fetched,
 * and a `?v=` query is normalised away by enough scrapers not to be a bust. A
 * redraw is therefore a NEW path — bump the number, re-render, delete the old
 * file — and until the number changes, everyone who has already shared a link
 * keeps seeing the card from before the edit. `test/metadata.test.ts` holds the
 * shape of the name so a redraw cannot quietly reuse the URL.
 */
export const CARD = {
  path: "/og-card-2.png",
  width: 1200,
  height: 630,
  alt: "The Earwitness mark and wordmark on the stream's paper ground.",
} as const;
