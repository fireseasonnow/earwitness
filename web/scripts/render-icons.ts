/**
 * The raster icons, drawn from `public/favicon.svg` so they cannot drift from it.
 *
 * This exists because the first raster set was made by hand and shipped BLANK:
 * `favicon-96.png` and `favicon.ico` were 96x96 of pure RGBA(0,0,0,0), which is
 * a valid PNG, a correct content type and a 200 — every check a deploy makes,
 * passed by an empty square. Google showed the placeholder circle for two days.
 * `test/icons.test.ts` is the half that notices; this is the half that draws.
 *
 * No dependency and no SVG engine, because the mark does not need one: it is 21
 * axis-aligned 2x2 blocks on a 24-unit grid, so the "rasteriser" is integer
 * rectangle fill. That is also what makes it exact — `shape-rendering=
 * "crispEdges"` in the SVG asks for no antialiasing, and arithmetic on integers
 * is the only way to be sure nobody's smoothing crept in.
 *
 * **Sizes must be multiples of 12.** The grid is 12 blocks across (24 units of
 * 2), so a block is `size / 12` pixels and only a multiple of 12 leaves that a
 * whole number. 48, 96 and 180 qualify; 16 and 32 do NOT, which is why the .ico
 * carries 48 and 96 and lets the browser downscale for the tab strip. Google's
 * own requirement — a multiple of 48 — is satisfied by both entries.
 *
 * Run with `bun run icons` in `web/`.
 */

import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PUBLIC = join(import.meta.dir, "..", "public");

/**
 * The background for the two icons that are composited by someone else.
 *
 * iOS composites a transparent touch icon onto BLACK. Google composites a
 * transparent favicon onto a colour of its own choosing, and picked this one —
 * the page's `theme-color` — when it built the cached icon for the https URL.
 * Handing both an opaque raster takes the choice away from them.
 *
 * `favicon.ico` stays transparent: it is read by browser chrome, whose tab strip
 * is dark as often as light, and a paper square there is worse than no square.
 */
const PAPER = "#f5f3ed";

interface Mark {
  /** Edge of the square viewBox, in SVG units. */
  extent: number;
  fill: [number, number, number];
  rects: { x: number; y: number; w: number; h: number }[];
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * The mark, read off the SVG rather than restated here.
 *
 * Restating it would be a second copy to keep in step, and the whole failure
 * this file answers is two representations of one mark disagreeing in silence.
 */
function readMark(): Mark {
  const svg = readFileSync(join(PUBLIC, "favicon.svg"), "utf8");
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const fill = /<svg[^>]*\sfill="(#[0-9a-fA-F]{6})"/.exec(svg);
  if (viewBox === null || fill === null) throw new Error("favicon.svg: no viewBox or root fill");
  if (viewBox[1] !== viewBox[2]) throw new Error("favicon.svg: viewBox is not square");
  const rects = [...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g)].map(
    (m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }),
  );
  if (rects.length === 0) throw new Error("favicon.svg: no rects");
  return { extent: +viewBox[1], fill: parseHex(fill[1]), rects };
}

/** RGBA pixels, `background` null for transparent. */
function draw(mark: Mark, size: number, background: string | null): Uint8Array {
  if (size % 12 !== 0) throw new Error(`size ${size} is not a multiple of 12 — blocks would blur`);
  const scale = size / mark.extent;
  const px = new Uint8Array(size * size * 4);
  if (background !== null) {
    const [r, g, b] = parseHex(background);
    for (let i = 0; i < size * size; i++) px.set([r, g, b, 255], i * 4);
  }
  const [r, g, b] = mark.fill;
  for (const rect of mark.rects) {
    for (let y = rect.y * scale; y < (rect.y + rect.h) * scale; y++) {
      for (let x = rect.x * scale; x < (rect.x + rect.w) * scale; x++) {
        px.set([r, g, b, 255], (y * size + x) * 4);
      }
    }
  }
  return px;
}

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(body.length + 8, crc32(out.subarray(4, body.length + 8)));
  return out;
}

/**
 * `alpha` false drops the channel rather than writing it opaque, because
 * `metadata.test.ts` reads colour type 4 and 6 as "this icon has transparency"
 * and iOS composites any such touch icon onto black. An all-255 alpha channel
 * would be honest about the pixels and still fail the reader it is written for.
 */
function encodePng(px: Uint8Array, size: number, alpha: boolean): Uint8Array {
  const ch = alpha ? 4 : 3;
  // Filter byte 0 (None) on every scanline: the image is flat colour, so a
  // predictor would buy nothing that deflate does not already take.
  const raw = new Uint8Array(size * (size * ch + 1));
  for (let y = 0; y < size; y++) {
    const at = y * (size * ch + 1);
    raw[at] = 0;
    for (let x = 0; x < size; x++) {
      raw.set(px.subarray((y * size + x) * 4, (y * size + x) * 4 + ch), at + 1 + x * ch);
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr.set([8, alpha ? 6 : 2, 0, 0, 0], 8); // 8-bit, RGBA/RGB, deflate, adaptive, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}

/** PNG-in-ICO, which every browser that still reads .ico has understood for years. */
function encodeIco(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = 6 + images.length * 16;
  const total = images.reduce((n, i) => n + i.png.length, header);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true); // type 1 = icon
  view.setUint16(4, images.length, true);
  let offset = header;
  images.forEach((img, i) => {
    const at = 6 + i * 16;
    out[at] = img.size === 256 ? 0 : img.size;
    out[at + 1] = img.size === 256 ? 0 : img.size;
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, img.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.length;
  });
  return out;
}

const mark = readMark();
const png = (size: number, bg: string | null) =>
  encodePng(draw(mark, size, bg), size, bg === null);

/**
 * `icon-96.png` and not `favicon-96.png`, which it replaces.
 *
 * The bytes at that path had already been fixed and redeployed, and Google went
 * on serving the placeholder: its favicon cache is keyed by URL, so a file that
 * changes underneath a path it has already fetched is a file it has no reason to
 * fetch again. A name it has never seen is the only part of this that Google
 * cannot ignore. Renaming again later would mean the same thing went wrong twice
 * — check the cache first: t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&
 * url=https%3A%2F%2Fearwitness.fyi&size=64 returns what Google will actually draw.
 */
const wrote: [string, Uint8Array][] = [
  ["icon-96.png", png(96, PAPER)],
  ["favicon.ico", encodeIco([48, 96].map((size) => ({ size, png: png(size, null) })))],
  ["apple-touch-icon.png", png(180, PAPER)],
];

for (const [name, bytes] of wrote) {
  writeFileSync(join(PUBLIC, name), bytes);
  console.log(`${name.padEnd(22)} ${String(bytes.length).padStart(6)} B`);
}
