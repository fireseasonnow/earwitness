/**
 * How stale the page in front of a reader may be, and the single place that
 * decides it.
 *
 * Two mechanisms spend the same budget: the meta refresh that makes the page
 * redraw itself, and the edge cache that lets Cloudflare answer without waking
 * the origin. A reader's worst case is their SUM, so keeping the two numbers in
 * two files is how a freshness promise drifts without anyone editing it. They
 * live here, and the test pins the relationship rather than the values.
 */

/**
 * The tracker's tick, and so the fastest rate at which this page can have
 * anything new to say.
 *
 * Mirrored from `tracker/src/config.ts` deliberately, the same way the Amsterdam
 * day boundary is mirrored in `time.ts`: `shared/` holds the two things the
 * processes must AGREE on, and this is not one of them. A page redrawing
 * off-cadence costs a reader nothing, so the duplication needs no guard — only
 * an origin story, which is this comment.
 */
export const REFRESH_SECONDS = 30;

/**
 * How long Cloudflare may answer for the origin without asking it again.
 *
 * Why cache a page whose whole point is being live: every uncached view pushes
 * ~68 KB of uncompressed HTML up a residential uplink, because the tunnel does
 * not compress the origin hop (the edge brotlis it to ~5 KB afterwards, which
 * helps the reader and not the uplink). A few thousand concurrent readers
 * saturate it, and the casualty is not the page — it is the tracker, which
 * shares the link and needs it to pull the stream. A stale page costs seconds;
 * a starved tracker costs a day that no archive can return. This bounds origin
 * renders at 60 / EDGE_TTL_SECONDS a minute however many people are watching.
 *
 * Why ten and not thirty: the protection is O(1) in readers at EVERY value, so
 * tripling the TTL buys 6 renders a minute down to 2 and costs 20 s of
 * freshness. Ten is where that curve stops being worth paying for.
 *
 * What it costs a reader: a worst case of REFRESH_SECONDS + EDGE_TTL_SECONDS
 * rather than REFRESH_SECONDS. That sits inside the tracker's own detection lag
 * — a song change is not written until its 30 s stitch burst finishes — so it is
 * noise on a signal already coarser than itself. It also cannot delay a health
 * state: the thresholds in `health.ts` are minutes.
 */
export const EDGE_TTL_SECONDS = 10;

/**
 * `max-age=0` keeps browsers revalidating on every refresh, so only the shared
 * edge holds a copy and a reload always gets the newest render the edge has;
 * `s-maxage` is the edge's alone.
 *
 * Cloudflare bypasses HTML caching by default whatever this header says. It
 * takes effect only alongside a Cache Rule marking the page eligible and
 * deferring to the origin's TTL — the rule is the switch, this is the number.
 * Splitting it the other way would put the seconds a reader can be served stale
 * in a dashboard field, where neither this file nor its test can see it.
 */
export const CACHE_CONTROL = `public, max-age=0, s-maxage=${EDGE_TTL_SECONDS}`;
