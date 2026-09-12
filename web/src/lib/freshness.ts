/**
 * How stale the page in front of a reader may be, and the single place that
 * decides it. The meta refresh and the edge cache spend the same budget and a
 * reader's worst case is their SUM — hence both numbers here, with the test
 * pinning the relationship rather than the values.
 */

/** The tracker's tick. Mirrored from `tracker/src/config.ts`: `shared/` holds
 * what the two processes must AGREE on, and redraw cadence is not that. */
export const REFRESH_SECONDS = 30;

/**
 * How long Cloudflare may answer for the origin without asking it again.
 *
 * Why cache a page whose whole point is being live: every uncached view pushes
 * ~68 KB of uncompressed HTML up a residential uplink, and the casualty of
 * saturating it is not the page but the tracker, which shares the link to pull
 * the stream. A stale page costs seconds; a starved tracker costs a day no
 * archive can return.
 */
export const EDGE_TTL_SECONDS = 10;

/**
 * `max-age=0` keeps browsers revalidating, so only the shared edge holds a copy.
 *
 * Cloudflare bypasses HTML caching by default whatever this header says: it
 * applies only alongside a Cache Rule deferring to the origin's TTL — the rule
 * is the switch, this is the number. Splitting it the other way would put the
 * seconds a reader can be served stale in a dashboard field, where neither this
 * file nor its test can see it.
 */
export const CACHE_CONTROL = `public, max-age=0, s-maxage=${EDGE_TTL_SECONDS}`;
