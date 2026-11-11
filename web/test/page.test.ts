import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RETENTION_MS } from "@earwitness/shared";
import { dev } from "astro";
import { AMSTERDAM } from "../src/lib/time";

/**
 * The server's half of the local-time contract, on the real page: Astro's dev
 * server renders it from a scratch state directory. `localize.test.ts` covers
 * the browser's half against the marks checked here.
 */

const DIR = mkdtempSync(join(tmpdir(), "earwitness-page-test-"));
process.env.EARWITNESS_STATE = DIR;

const NOW = Date.now();
const DAY_START = AMSTERDAM.dayStart(new Date(NOW)).getTime();
const MIN = 60_000;

const PLAYS = [
  { detectedAt: new Date(NOW - RETENTION_MS - MIN).toISOString(), credit: "Expired — Gone" },
  { detectedAt: new Date(DAY_START - 30 * MIN).toISOString(), credit: "Last Night — Hidden" },
  { detectedAt: new Date(DAY_START + MIN).toISOString(), credit: "This Morning — Shown" },
  { detectedAt: new Date(NOW - MIN).toISOString(), credit: "Just Now — Shown" },
].filter((p) => Date.parse(p.detectedAt) <= NOW - MIN); // the third, just after midnight

let server: Awaited<ReturnType<typeof dev>>;
let html: string;

beforeAll(async () => {
  writeFileSync(join(DIR, "plays.json"), JSON.stringify({ version: 2, plays: PLAYS }));
  writeFileSync(join(DIR, "live.flag"), "1");
  writeFileSync(join(DIR, "confirmed.flag"), "");
  server = await dev({
    root: join(import.meta.dir, ".."),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
    // Its source-location attributes would sit inside every tag checked below.
    devToolbar: { enabled: false },
  });
  // A same-site referrer reads as a refresh, which the arrival log skips.
  const origin = `http://127.0.0.1:${server.address.port}`;
  const res = await fetch(`${origin}/`, { headers: { referer: `${origin}/` } });
  html = await res.text();
}, 60_000);

afterAll(async () => {
  await server?.stop();
  rmSync(DIR, { recursive: true, force: true });
});

const rows = () => [...html.matchAll(/<li data-at="([^"]+)"( hidden)?[^>]*>([\s\S]*?)<\/li>/g)];

describe("the page as the server renders it", () => {
  test("every play in the window is a row, and nothing older", () => {
    const inWindow = PLAYS.map((p) => p.detectedAt).filter((at) => Date.parse(at) >= NOW - RETENTION_MS);
    expect(rows().map((r) => r[1])).toEqual(inWindow.reverse());
  });

  test("rows before Amsterdam midnight are hidden, the rest are not", () => {
    for (const [, at, hidden] of rows()) {
      expect(hidden !== undefined, at).toBe(Date.parse(at!) < DAY_START);
    }
  });

  test("hidden beats the rows' flex layout", () => {
    // The rows carry `flex`; only this preflight rule, with its !important,
    // keeps a hidden one from rendering.
    expect(html).toMatch(/\[hidden\]:where\(:not\(\[hidden="until-found"\]\)\)\s*\{\s*display:\s*none\s*!important/);
  });

  test("the count is the shown rows", () => {
    const shown = rows().filter((r) => r[2] === undefined).length;
    expect(html).toContain(`data-count>${shown}<`);
  });

  test("every row's time is marked and printed in Amsterdam", () => {
    for (const [, at, , body] of rows()) {
      expect(body).toContain(`<time datetime="${at}" data-time>${AMSTERDAM.time(at!)}</time>`);
    }
  });

  test("the hero's moment is a stamp", () => {
    const newest = PLAYS[PLAYS.length - 1]!.detectedAt;
    expect(html).toContain(`Since <time datetime="${newest}" data-stamp>${AMSTERDAM.stamp(newest, new Date(NOW))}</time>`);
  });

  test("the header and footer carry their Amsterdam text and the marks to replace it", () => {
    expect(html).toContain(`data-today datetime="${AMSTERDAM.date(new Date(NOW))}">${AMSTERDAM.day(new Date(NOW))}<`);
    expect(html).toMatch(/data-zone>Amsterdam time</);
    expect(html).toMatch(/data-local="Times follow the time zone your browser reports[^"]*">The log holds one Amsterdam day/);
  });

  test("the inline script comes after every mark, and survives the build's transform", () => {
    const script = /<script>(\(function localize[\s\S]*?)<\/script>/.exec(html)?.[1];
    expect(script).toBeDefined();
    expect(html.indexOf("(function localize")).toBeGreaterThan(html.indexOf("data-local="));
    // Helpers a bundler injects would be undefined in the browser.
    expect(script).not.toMatch(/__vite|__name\(|__require|import\(/);
    // Run as served, not as Bun would transpile it: Bun inlines module-scope
    // constants into the function, so only Vite's output shows a borrowed one.
    const empty = { querySelectorAll: () => [], querySelector: () => null };
    expect(() => new Function("document", script!)(empty)).not.toThrow();
  });
});
