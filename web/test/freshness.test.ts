import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_CONTROL, EDGE_TTL_SECONDS, REFRESH_SECONDS } from "../src/lib/freshness";

/**
 * What is under test is not the two numbers — they are judgement calls and may
 * be re-judged — but the three things that must survive re-judging:
 *
 *   the RELATION   a reader's staleness is the sum, so the cache may not
 *                  outlast the cadence it is hiding behind
 *   the SPLIT      the edge may hold this page; a browser may not
 *   the SOURCE     both call sites take the numbers from here, or the file
 *                  stops being the single place that decides
 */

const WEB = join(import.meta.dir, "..", "src");
const layoutSrc = readFileSync(join(WEB, "layouts", "Layout.astro"), "utf8");
const indexSrc = readFileSync(join(WEB, "pages", "index.astro"), "utf8");

describe("the freshness budget", () => {
  /**
   * Past this the cache outlives the cadence: a reader's refresh mostly returns
   * the render they already have, and the page's advertised tick becomes
   * fiction while every number above still looks reasonable on its own.
   */
  test("the edge may not hold a page longer than the page's own cadence", () => {
    expect(EDGE_TTL_SECONDS).toBeLessThanOrEqual(REFRESH_SECONDS);
  });

  test("worst-case staleness is the sum, and stays under a minute", () => {
    expect(REFRESH_SECONDS + EDGE_TTL_SECONDS).toBeLessThan(60);
  });

  /**
   * Both are positive: a zero TTL is a cache that does not cache, and a zero
   * cadence is a page that never redraws. Either would pass every other check
   * here.
   */
  test("both are real durations", () => {
    expect(EDGE_TTL_SECONDS).toBeGreaterThan(0);
    expect(REFRESH_SECONDS).toBeGreaterThan(0);
  });
});

describe("Cache-Control gives the page to the edge and not to the browser", () => {
  /**
   * The load-bearing half. With a browser max-age the meta refresh would redraw
   * from the browser's own copy, and a reader would sit in front of a frozen
   * page with no request going anywhere — worse than a stale edge, which at
   * least expires for everyone at once.
   */
  test("browsers revalidate every time", () => {
    expect(CACHE_CONTROL).toContain("max-age=0");
  });

  test("the edge holds it for exactly the declared TTL", () => {
    expect(CACHE_CONTROL).toContain(`s-maxage=${EDGE_TTL_SECONDS}`);
  });

  /** Shared caches may only hold it because nothing here is per-reader. */
  test("it is public, and says so once", () => {
    expect(CACHE_CONTROL.startsWith("public,")).toBe(true);
    expect(CACHE_CONTROL).not.toContain("private");
  });
});

/**
 * Every test above passes while a call site quietly stops asking this module,
 * which is the whole failure this file exists to prevent, so the two call sites
 * are asserted against their own sources.
 */
describe("both call sites read the budget from here", () => {
  /** A refresh interval written as a literal in the markup. */
  const HARDCODED_REFRESH = /http-equiv="refresh"\s+content="\d+"/;
  /** A TTL written as a literal instead of built from EDGE_TTL_SECONDS. */
  const HARDCODED_TTL = /s-maxage=\d+/;

  test("Layout.astro takes the cadence from the constant", () => {
    expect(layoutSrc).toContain("REFRESH_SECONDS");
    expect(HARDCODED_REFRESH.test(layoutSrc)).toBe(false);
  });

  test("index.astro sends the header and inlines no TTL of its own", () => {
    expect(indexSrc).toContain("CACHE_CONTROL");
    expect(indexSrc).toContain("Cache-Control");
    expect(HARDCODED_TTL.test(indexSrc)).toBe(false);
  });

  test("the guard would catch either violation", () => {
    // A guard whose patterns cannot match a real regression passes forever.
    expect(HARDCODED_REFRESH.test('<meta http-equiv="refresh" content="30" />')).toBe(true);
    expect(HARDCODED_TTL.test('"public, max-age=0, s-maxage=10"')).toBe(true);
  });
});
