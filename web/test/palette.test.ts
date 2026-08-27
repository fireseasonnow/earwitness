import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toneMark, toneText } from "../src/lib/presentation";

/**
 * The palette claims to be the stream's own. This is what makes the claim
 * checkable.
 *
 * Every colour in the theme must SAY where it came from, in its own trailing
 * comment, and the arithmetic here must agree:
 *
 *   - `sampled`      — a pixel counted off a live frame, listed in SAMPLED below
 *   - `N% ink`       — N parts ink over paper in sRGB, the halftone's own line
 *   - `shade step N` — N steps down the scene's shading multiply
 *   - a `var()` alias, which inherits its family from what it points at
 *
 * A colour that declares nothing fails, so the next hand-mixed grey has to
 * either land on the stream's ramp or argue with this file. The contrast ratios
 * written next to the tokens are checked too: a comment that drifts from its
 * value is a comment that will be believed.
 *
 * Re-sampling the frames is a manual job with a live stream in it — see
 * "Design" in the README for the command. What runs here is pure arithmetic.
 */

const WEB = join(import.meta.dir, "..");
const css = readFileSync(join(WEB, "src", "styles", "global.css"), "utf8");

const PAPER = "#f5f3ed";
const INK = "#2a2822";
/** Clawd's shaded side. Not in the theme: the favicon is its only call site. */
const SHADED_SIDE = "#bf684d";

/**
 * Pixels, with what they are in the scene. The provenance record: a colour is
 * allowed to call itself sampled only if it is in here.
 */
const SAMPLED: Record<string, string> = {
  [PAPER]: "the ground — 62% of the frame by area",
  [INK]: "the halftone dots",
  "#d97757": "Clawd's lit side (the frame reads #d87756) · Claude's brand orange",
  [SHADED_SIDE]: "Clawd's shaded side — the blocks turned away from the light",
  "#efb154": "the basket weave",
  "#915c1b": "the shadow under the basket",
};

/** The scene shades by multiplying: the shaded side is the lit side once over. */
const SHADE_MULTIPLY = 0.8845;

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function hex(c: Rgb): string {
  return "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}

/** N parts ink over paper, in sRGB — the line every neutral pixel sits on. */
function inkOverPaper(percent: number): string {
  const [p, i] = [rgb(PAPER), rgb(INK)];
  return hex(p.map((v, n) => v - (v - i[n]!) * (percent / 100)) as Rgb);
}

function shadeStep(from: string, steps: number): Rgb {
  return rgb(from).map((v) => Math.round(v * SHADE_MULTIPLY ** steps)) as Rgb;
}

/** WCAG 2.x relative luminance and contrast, so the comments can be audited. */
function luminance(hexValue: string): number {
  const [r, g, b] = rgb(hexValue).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(one: string, other: string): number {
  const [a, b] = [luminance(one), luminance(other)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function contrastOnPaper(hexValue: string): number {
  return contrast(hexValue, PAPER);
}

/**
 * Every source under `web/src` that can spend a colour: utilities in markup,
 * `var()` in CSS. Kept by file so a failure can name the one to open.
 */
const SOURCES = new Map(
  [...new Bun.Glob("**/*.{astro,ts,css}").scanSync({ cwd: join(WEB, "src") })].map(
    (file) => [file, readFileSync(join(WEB, "src", file), "utf8")] as const,
  ),
);

interface Token {
  name: string;
  /** As written: a hex literal or a `var(--color-…)` alias. */
  value: string;
  /** The trailing comment on the declaration's own line, where the claims are. */
  note: string;
}

/** The palette section only: `--text-*`, `--tracking-*` and the rest are sizes. */
function paletteTokens(source: string): Token[] {
  return [...source.matchAll(/^\s*--color-([a-z-]+):\s*([^;]+);(.*)$/gm)].map((m) => ({
    name: m[1]!,
    value: m[2]!.trim(),
    note: m[3]!.trim(),
  }));
}

const TOKENS = paletteTokens(css);

function resolve(value: string, tokens: Token[] = TOKENS): string {
  const alias = /^var\(--color-([a-z-]+)\)$/.exec(value);
  if (alias === null) return value;
  const target = tokens.find((t) => t.name === alias[1]);
  if (target === undefined) throw new Error(`--color-${alias[1]} does not exist`);
  return resolve(target.value, tokens);
}

/** What a token says it is, or `null` when it says nothing. */
function provenance(token: Token): string | null {
  if (/^var\(/.test(token.value)) return "alias";
  if (/\bsampled\b/.test(token.note)) return "sampled";
  if (/\b(\d+)% ink\b/.test(token.note)) return "blend";
  if (/\bshade step (\d+)\b/.test(token.note)) return "shade";
  return null;
}

describe("palette — every colour comes from the stream", () => {
  test("the theme has colours to check", () => {
    // A regex that stops matching would otherwise pass every test below.
    expect(TOKENS.length).toBeGreaterThanOrEqual(10);
    expect(TOKENS.map((t) => t.name)).toContain("paper");
  });

  test("each token declares where it came from", () => {
    const silent = TOKENS.filter((t) => provenance(t) === null);
    expect(silent.map((t) => t.name)).toEqual([]);
  });

  test("every value is a hex literal or an alias of one", () => {
    for (const t of TOKENS) {
      expect(resolve(t.value), `--color-${t.name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("a colour calling itself sampled is one of the pixels", () => {
    for (const t of TOKENS.filter((t) => provenance(t) === "sampled")) {
      expect(Object.keys(SAMPLED), `--color-${t.name}`).toContain(resolve(t.value));
    }
  });

  test("a blend is exactly the ink-over-paper mix it claims", () => {
    const blends = TOKENS.filter((t) => provenance(t) === "blend");
    expect(blends.length).toBeGreaterThan(0);
    for (const t of blends) {
      const percent = Number(/\b(\d+)% ink\b/.exec(t.note)![1]);
      expect(resolve(t.value), `--color-${t.name} at ${percent}% ink`).toBe(
        inkOverPaper(percent),
      );
    }
  });

  test("a shade step is that many steps down a sampled colour", () => {
    const shades = TOKENS.filter((t) => provenance(t) === "shade");
    expect(shades.length).toBeGreaterThan(0);
    for (const t of shades) {
      const steps = Number(/\bshade step (\d+)\b/.exec(t.note)![1]);
      const value = rgb(resolve(t.value));
      // ±1 per channel: the multiply lands between two 8-bit values, and the
      // scene's own shaded side rounds down where this rounds up.
      const near = Object.keys(SAMPLED).some((from) =>
        shadeStep(from, steps).every((v, i) => Math.abs(v - value[i]!) <= 1),
      );
      expect(near, `--color-${t.name} is ${steps} steps below no sampled colour`).toBe(true);
    }
  });
});

describe("palette — the ratios written next to the tokens", () => {
  const documented = TOKENS.map((t) => ({
    token: t,
    ratio: /(\d+\.\d+):1/.exec(t.note)?.[1],
  })).filter((d) => d.ratio !== undefined);

  /** The convention in `global.css`: the true ratio, rounded to one decimal. */
  function written(hexValue: string): string {
    return (Math.round(contrastOnPaper(hexValue) * 10) / 10).toFixed(1);
  }

  test("every documented ratio is the ratio", () => {
    expect(documented.length).toBeGreaterThan(5);
    for (const { token, ratio } of documented) {
      expect(written(resolve(token.value)), `--color-${token.name} says ${ratio}:1`).toBe(ratio!);
    }
  });

  /**
   * The `-text` suffix is the enforcement mechanism for "this tier may set
   * type", and the one exception is the accent: the live orange runs at a single
   * tier so the mark and the wordmark match, and the 2.8:1 that costs is a
   * decision recorded in `global.css`, not an oversight to be found later.
   */
  test("a -text tier clears 4.5:1, except the accepted accent", () => {
    const tiers = TOKENS.filter((t) => t.name.endsWith("-text"));
    expect(tiers.map((t) => t.name)).toEqual(["terra-text", "ochre-text"]);
    for (const t of tiers) {
      const ratio = contrastOnPaper(resolve(t.value));
      if (t.name === "terra-text") expect(ratio).toBeCloseTo(2.8, 1);
      else expect(ratio, `--color-${t.name}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

/**
 * The health tones are the only colours the page picks at runtime, so they are
 * the only ones a rename can leave pointing at nothing. Tailwind generates no
 * CSS for a class outside the theme and raises nothing either: the tone would
 * quietly render as body ink.
 */
describe("palette — the tones name colours that exist", () => {
  const names = TOKENS.map((t) => t.name);

  test("every tier in the tone maps is a token in the theme", () => {
    for (const [tone, className] of [
      ...Object.entries(toneMark),
      ...Object.entries(toneText),
    ]) {
      expect(names, `${className} (${tone})`).toContain(className.replace(/^text-/, ""));
    }
  });

  test("the check would notice a tone pointing at nothing", () => {
    expect(names).not.toContain("ochre");
  });
});

/**
 * A palette rots by accumulation: a colour loses its last call site, stays in
 * the theme, and the next reader treats it as a choice. Every token has to be
 * spent somewhere under `web/src`.
 */
describe("palette — no colour without a call site", () => {
  const CALL_SITES = [...SOURCES.values()]
    // The palette's own declarations are not call sites.
    .map((source) => source.replace(/^\s*--color-[a-z-]+:[^;]+;.*$/gm, ""))
    .join("\n");

  /** A utility ending in the token name (`text-muted`, `hover:text-terra-hover`,
      `border-rule`) or a `var()` reference to it. */
  function isSpent(name: string): boolean {
    return (
      new RegExp(`(?<![\\w-])[a-z]+-${name}(?![\\w-])`).test(CALL_SITES) ||
      CALL_SITES.includes(`var(--color-${name})`)
    );
  }

  test("every colour in the theme is used", () => {
    expect(TOKENS.filter((t) => !isSpent(t.name)).map((t) => t.name)).toEqual([]);
  });

  test("the check would notice a colour nobody spends", () => {
    expect(CALL_SITES.length).toBeGreaterThan(1000);
    expect(isSpent("cobalt")).toBe(false);
    // The light ochre was removed for failing exactly this: the scene has a
    // basket weave, the page had nothing to fill with it.
    expect(isSpent("ochre")).toBe(false);
  });
});

/**
 * Two colours cannot reference the theme — a `<meta>` value and a standalone
 * SVG — so they are literals, and literals drift.
 */
describe("palette — the two literals outside the theme", () => {
  const layout = readFileSync(join(WEB, "src", "layouts", "Layout.astro"), "utf8");
  const favicon = readFileSync(join(WEB, "public", "favicon.svg"), "utf8");

  test("the theme-color meta tag is paper", () => {
    const value = /name="theme-color"\s+content="(#[0-9a-f]{6})"/.exec(layout)?.[1];
    expect(value).toBe(resolve("var(--color-paper)"));
  });

  test("the favicon carries the shaded side of the mark's orange", () => {
    // Darker than the header mark on purpose: 16px of orange on unknown browser
    // chrome, and the scene has a tier for exactly that.
    expect(/fill="(#[0-9a-f]{6})"/.exec(favicon)?.[1]).toBe(SHADED_SIDE);
    expect(Object.keys(SAMPLED)).toContain(SHADED_SIDE);
  });
});

/**
 * A guard whose checks cannot fail passes forever. These are the regressions it
 * exists to catch, with the palette's own history as the fixtures: the greys it
 * replaced were off the halftone's line, warm by up to 8/255 in blue.
 */
describe("palette — the guard would catch a drifting colour", () => {
  const off: Token = { name: "muted", value: "#6c6863", note: "/* labels · 70% ink 5.0:1 */" };

  test("an off-line grey is not the mix it claims", () => {
    expect(provenance(off)).toBe("blend");
    expect(resolve(off.value, [off])).not.toBe(inkOverPaper(70));
  });

  test("a hand-mixed colour declaring nothing is refused", () => {
    expect(provenance({ name: "hover", value: "#85381e", note: "/* link hover 7.3:1 */" })).toBe(
      null,
    );
  });

  test("a colour cannot call itself sampled without being a pixel", () => {
    expect(Object.keys(SAMPLED)).not.toContain("#8a5f22"); // the old hand-darkened ochre
  });

  test("a ratio off by one decimal is caught", () => {
    // 5.0460 is 5.0 to one decimal, and the ochre's old comment said 5.1.
    expect(Math.round(contrastOnPaper("#915c1b") * 10) / 10).not.toBe(5.1);
  });
});
