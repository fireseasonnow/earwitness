import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `tracker.ts` can't be imported here: loading it checks for binaries and starts
 * the loop. So the wiring `state.test.ts` can't see is asserted on the source.
 */
const src = readFileSync(join(import.meta.dir, "..", "tracker.ts"), "utf8");
const tickBody = src.slice(src.indexOf("async function tick()"));

/** The first statement of `tick`, comments skipped. */
function firstStatement(body: string): string {
  const inner = body.slice(body.indexOf("{") + 1);
  return inner
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*"))!;
}

test("every tick prunes first, before anything that can return early", () => {
  // A tick returns early on a failed capture, an empty frame or a cooldown, so
  // a prune placed after any of those would skip exactly when the stream is
  // off air and the file is ageing.
  expect(firstStatement(tickBody)).toBe("pruneExpired(CONFIG.stateDir);");
});

test("nothing else in the loop prunes, or prunes by another rule", () => {
  expect(src.match(/prune\w*\(/g)).toEqual(["pruneExpired("]);
});

test("the guard reads the function it claims to", () => {
  expect(tickBody.startsWith("async function tick(): Promise<void> {")).toBe(true);
  expect(firstStatement("async function tick() {\n  // note\n  writeLiveFlag(x);\n")).toBe("writeLiveFlag(x);");
});
