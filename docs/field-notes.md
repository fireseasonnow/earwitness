# Field notes

Commands and measurements that cost something to obtain and are not recoverable
from the source. Everything that justifies a constant lives beside that constant
— this file points at them, it does not restate them.

## Capture

All capture constants live in `tracker/src/config.ts`, including the derivation
of `crop` and the burst timings.

```bash
# resolve the stream URL (the ~6 h embedded expiry is a lie: the media playlist
# is a sliding window and dies after ~25-30 s). `head -1` because yt-dlp hands
# back video AND audio; the tracker takes the same first line (`resolve.ts`).
URL=$(yt-dlp -g 'https://www.youtube.com/@claude/live' | head -1)

# single tick by hand: one cropped frame + OCR
ffmpeg -loglevel error -i "$URL" -frames:v 1 -vf "crop=520:46:1390:42" -y tick.png \
  && tesseract tick.png stdout --psm 7

# burst: two full marquee loops (stitcher input, as the tracker takes it)
ffmpeg -loglevel error -t 30 -i "$URL" -vf "crop=520:46:1390:42,fps=2" -y tick_%02d.png

# fair A/B of any filter change: record once, apply filters to identical frames
ffmpeg -loglevel error -t 12 -i "$URL" -c copy -y sample.ts

# long watch (transitions, drift): 8 min @ 0.5 fps
ffmpeg -loglevel error -t 480 -i "$URL" -vf "crop=520:46:1390:42,fps=1/2" -y t_%03d.png
```

**If the overlay ever moves or is redesigned**, grab a full frame, re-locate the
ticker, and update `crop` in `tracker/src/config.ts`:

```bash
ffmpeg -loglevel error -i "$URL" -frames:v 1 -y frame.png
```

**Row profile — where the glyphs sit, and where the terrain reaches.** The crop
has two bounds to satisfy, and neither is guessable from a screenshot: it must
contain every glyph, and it must exclude the scene's drifting halftone terrain.
Collapse each frame to one column of row averages and read both off it. Do this
on the LAPTOP against a recorded sample, not on the server — 300 tesseract calls
will starve the tracker on a four-core box.

```bash
ffmpeg -loglevel error -t 150 -i "$URL" -c copy -y sample.ts   # record once
ffmpeg -loglevel error -i sample.ts -vf "crop=520:200:1390:0,fps=2,format=gray,scale=1:200:flags=area" -f rawvideo -pix_fmt gray -y rows.raw
python3 - <<'EOF'
d = open("rows.raw", "rb").read(); H = 200
tops, bots, terrain = [], [], []
for i in range(len(d) // H):
    p = d[i * H:(i + 1) * H]
    glyph = [y for y in range(40, 105) if p[y] < 250]
    below = [y for y in range(95, 200) if p[y] < 250]
    if glyph: tops.append(min(glyph)); bots.append(max(glyph))
    if below: terrain.append(min(below))
print("glyphs   y", min(tops), "..", max(bots))
print("terrain reaches y", min(terrain))
EOF
```

## Stitching

The marquee scrolls one credit on a loop, so no single frame holds the whole
thing. A burst is 30 s at 2 fps and `tracker/src/stitch.ts` recovers the credit
from it: align the fragments on a shared column axis by best overlap, vote per
column, detect the loop's repeat period, fold the votes modulo that period,
rotate the cyclic result to the loop boundary, then check that cut back against
the raw frames. The six steps are numbered in `stitchAligned`; the forensics for
each — the period bounds, the separator-width collision, the split heuristic —
are at the constants they justify.

## Re-sampling the palette

A scene redesign is the only reason to. Count the colours of a frame rather than
eyedropping one: the scene animates, and a dot halfway through a fade is not a
palette entry. `web/test/palette.test.ts` holds the provenance record and
refuses a colour that is not sampled, blended or shaded.

```bash
URL=$(yt-dlp -g 'https://www.youtube.com/@claude/live' | head -1)
ffmpeg -loglevel error -i "$URL" -vf fps=1/15 -frames:v 20 -y f%03d.png  # ~5 min
ffmpeg -loglevel error -i f001.png -f rawvideo -pix_fmt rgb24 -y frame.raw
python3 - <<'EOF'
from collections import Counter
import colorsys
d = open("frame.raw", "rb").read()
c = Counter(d[i:i + 3] for i in range(0, len(d), 3))
hsv = lambda px: colorsys.rgb_to_hsv(*[q / 255 for q in px])
show = lambda px, n: print("  #%02x%02x%02x %8d  H%.0f S%.2f V%.2f"
                          % (*px, n, hsv(px)[0] * 360, hsv(px)[1], hsv(px)[2]))
print("ground"); [show(px, n) for px, n in c.most_common(1)]
print("ink");    [show(px, n) for px, n in Counter({px: n for px, n in c.items()
                                                   if hsv(px)[2] < 0.2}).most_common(3)]
print("props");  [show(px, n) for px, n in c.most_common()[:400]
                  if hsv(px)[1] > 0.3 and 0.3 < hsv(px)[2] < 0.98 and n > 300]
# the halftone's line, the claim the neutrals rest on
grey = [(px, n) for px, n in c.items() if hsv(px)[1] < 0.3]
on = sum(n for px, n in grey if px[1] - px[0] == -2 and px[2] - px[0] == -8)
print("neutrals on the paper-ink line: %.1f%%" % (100 * on / sum(n for _, n in grey)))
EOF
```

Reading the output: the ground is one flat colour, the ink comes out as a cluster
around #2a2822 because the dots are drawn antialiased, and the props carry their
own antialiasing too — the entry is the one with the count, the neighbours within
a unit or two are its edges. Run it on several of the 20 frames: a colour that
survives across scenes is a palette entry, one that appears in a single scene is
a prop, and a prop stays out. The scene has a blue that comes and goes and the
page has no role for it; carrying it anyway is how a palette starts to drift.

## Rendering the cards and icons

**The social card.** Bump `CARD.path` in `web/src/lib/metadata.ts` to the next
number FIRST — the cache is keyed by URL and nothing else, so a redraw is a new
path, not new bytes at an old one. The command takes the name from `CARD`, so the
version has one definition:

```bash
CARD=$(bun -e 'import {CARD} from "./web/src/lib/metadata"; process.stdout.write(CARD.path)')
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot="web/public$CARD" "file://$PWD/docs/og-card.svg"
```

Then `git rm` the card it replaced: the old URL is dead the moment the constant
moves, and two PNGs in `public/` is one of them going stale unnoticed.

**The icons.** `web/public/icon.svg` is the source for all four:

```bash
cd web && bun run icons
```

Not headless Chrome, which is what this used to say and which shipped a **blank
icon set** — `--default-background-color=00000000` returned a 96×96 of pure
RGBA(0,0,0,0): valid PNG, right dimensions, no mark in it. Google's favicon cache
is keyed by URL, so fixing the bytes under an existing path changes nothing;
rename every file a stale render could have come from, not just the likeliest.
`metadata.test.ts` counts the SVG's 21 blocks of ink in each raster.

Before renaming anything again, look at what Google actually holds — it is public.
The buckets disagree, and the variant a search result draws is the one that hid a
broken render for five days:

```bash
for s in 16 32 64; do
  curl -s "https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fearwitness.fyi&size=$s" -o "/tmp/g-$s.png"
done
```

A paper-coloured square with about **1% ink** is the bad render; the mark fills
**14.6%**. A blue-grey globe is Google's generic fallback, meaning it holds
nothing for that bucket.

**The repository's card** is a different file — GitHub's social preview is
uploaded by hand under Settings → General → Social preview and has no URL to be
cached by. `docs/github-card.svg` is the same drawing at GitHub's 1280×640:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1280,640 --virtual-time-budget=5000 \
  --screenshot="docs/github-card.png" "file://$PWD/docs/github-card.svg"
```

The two SVGs are one drawing in two frames, so an edit to either is a divergence
until it is made in both. Roboto Mono is fetched from the CDN while Chrome runs —
check the face in the output; the platform mono fallback renders without
complaining.

## State files

Three plain files in `$EARWITNESS_STATE`, written by `tracker/src/state.ts`.
The write rates are measured, and appear nowhere in code:

```
plays.json      ~50 KB   ~400 writes/day   temp file + rename
live.flag        1 byte  ~2880 writes/day  content 0|1, mtime = heartbeat
confirmed.flag   0 bytes ~2450 writes/day  no content, mtime = last confirmation
```

At ~400 plays a day, `plays.json` costs about 113 B per play.

## Redrawing the screenshot

`docs/screenshot-1440.png` is committed and shown in the README, so it has to be
a real capture: run the tracker locally until the day's log has some depth, or
forward the deployment's port (`ssh -N -L 4321:127.0.0.1:4321 HOST`). Seeded
plays are not an option — invented songs read as a claim about what the stream
played. Serve the BUILT app (`bun run build && bun run start`), never `astro
dev`: the dev toolbar sits in the bottom of the frame.

```bash
chrome --headless --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1440,952 --screenshot=docs/screenshot-1440.png http://localhost:4321/
```

The desktop width is the only one committed; 834 and 390 are checked and thrown
away. Checking the phone width takes one trick: headless Chrome will not open a
window narrower than 500px, so a 390px render has to happen inside a 390px-wide
`<iframe>` — media queries follow the frame. Screenshotting a 390px window
instead silently renders at 500 and crops, which reads as an overflow bug that is
not there.

## Type checking

`bun run build` does not typecheck — Astro transpiles `.astro` components without
checking them. The components are covered only by:

```bash
cd web && bun run check   # astro check: components, pages, lib and tests
```

`typescript` is held at `^6` in `web/package.json` and the major is the part that
matters: TypeScript 7 is a native rewrite that does not yet expose the
programmatic API `astro check` calls, so it fails outright rather than degrading
quietly. The caret takes 6.x fixes and stops short of that. Track
[withastro/roadmap#1321](https://github.com/withastro/roadmap/discussions/1321)
before widening it.
