import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

/**
 * The parse rule must not grow a second implementation.
 *
 * Asserting that both packages produce the same result from the same imported
 * function cannot fail — it is one module agreeing with itself, dressed up as
 * coverage of a risk it does not touch. The risk is that someone cuts a credit
 * on " — " in place rather than importing `parseUnit`, and the visible symptom
 * of that divergence — the tracker and the page disagreeing about where an
 * artist ends — is one no unit test in either package would catch.
 *
 * So this is the test: neither source tree may cut a string on an em-dash, and
 * neither may locate one. `stitch.ts` once held the single allowed `indexOf`,
 * for the fallback that turned one unvoted fragment into a row; that fallback
 * is gone, and with it the exception. `countOccurrences(unit, " — ")` remains
 * a shape check on the stitcher's own input and takes no position on where an
 * artist ends.
 */

const REPO = join(import.meta.dir, "..", "..");
const ROOTS = ["tracker/src", "tracker/tracker.ts", "web/src"];
const SCANNED = new Set([".ts", ".tsx", ".astro", ".mjs", ".js"]);

const emDashArg = String.raw`\s*\(\s*(["'\`][^"'\`\n]*—[^"'\`\n]*["'\`]|\/[^/\n]*—[^/\n]*\/)`;
/** Cutting a string apart on an em-dash: the reimplementation itself. */
const CUTS_ON_EM_DASH = new RegExp(
  String.raw`\.\s*(split|match|matchAll|replace|replaceAll|search)${emDashArg}`,
);
/** Locating an em-dash: fine as a shape check, the first half of a parse otherwise. */
const LOCATES_EM_DASH = new RegExp(String.raw`\.\s*(indexOf|lastIndexOf)${emDashArg}`);

function sourceFiles(entry: string): string[] {
  const path = join(REPO, entry);
  if (extname(path) !== "") return [relative(REPO, path)];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile() && SCANNED.has(extname(d.name)))
    .map((d) => relative(REPO, join(d.parentPath, d.name)));
}

const FILES = ROOTS.flatMap(sourceFiles);
const read = (f: string) => readFileSync(join(REPO, f), "utf8");

describe("the parse rule has exactly one implementation", () => {
  test("neither tracker/src nor web/src cuts a string on an em-dash", () => {
    expect(FILES.filter((f) => CUTS_ON_EM_DASH.test(read(f)))).toEqual([]);
  });

  test("no source file outside shared/ even locates one", () => {
    expect(FILES.filter((f) => LOCATES_EM_DASH.test(read(f)))).toEqual([]);
  });

  test("the scan reaches the files it claims to, and would catch a parser", () => {
    // A guard that silently walks an empty tree passes forever, and one whose
    // pattern does not match a real parser is worse than none.
    expect(FILES).toContain("tracker/tracker.ts");
    expect(FILES).toContain(join("tracker", "src", "state.ts"));
    expect(FILES).toContain(join("web", "src", "lib", "state.ts"));
    expect(FILES).not.toContain(join("shared", "src", "parse.ts"));
    expect(LOCATES_EM_DASH.test(read(join("shared", "src", "parse.ts")))).toBe(true);
    expect(CUTS_ON_EM_DASH.test(`const [artist, title] = credit.split(" — ");`)).toBe(true);
  });
});
