import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..", "src");
const dayViewSrc = readFileSync(join(WEB, "components", "DayView.astro"), "utf8");
const heroSrc = readFileSync(join(WEB, "components", "Hero.astro"), "utf8");

/**
 * Heading level is invisible: an `h1` on the hero renders pixel-for-pixel like
 * one on the wordmark, so no screenshot shows it — and moving it to the biggest
 * type on the page is what tidying this markup looks like. The hero says a
 * different thing every render and cannot be the document's top heading.
 *
 * Two files, one regression. Not proof the outline is whole.
 */
test("the h1 is the wordmark, and the hero is not one", () => {
  expect(heroSrc).not.toMatch(/<h1[\s>]/);
  expect([...dayViewSrc.matchAll(/<h1[\s>]/g)].length).toBe(1);
  const h1 = dayViewSrc.slice(dayViewSrc.indexOf("<h1"), dayViewSrc.indexOf("</h1>"));
  expect(h1).toMatch(/Earwitness/);
});

/** A claim, not copy — which is why it is the only footer sentence held here.
    `metadata.test.ts` holds the same denial in the description. */
test("the footer denies the affiliation", () => {
  const footer = dayViewSrc.slice(dayViewSrc.indexOf("<footer"));
  expect(footer).toMatch(/not affiliated with Anthropic/);
});
