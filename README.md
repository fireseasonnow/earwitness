# Earwitness

An independent play log for [Claude FM](https://www.youtube.com/@claude/live),
Anthropic's 24/7 stream. One always-on page showing what it has played **today**.
Unofficial, and not affiliated with Anthropic.

![The page on air — hero, health line, and the day's log](docs/screenshot-1440.png)

Two supervised processes on one host, no AI calls.

- `tracker/` — Bun + TypeScript loop: every 30 s it OCRs the credit ticker from
  one cropped video frame; on song change it captures a 30 s burst at 2 fps and
  stitches the ~60 marquee fragments into one canonical `Artist — Title` unit. A
  stitch it is not sure of goes to the journal with its fragments, not onto the
  row. It also stamps a heartbeat every tick, records that the marquee still
  reads as the song already logged, and prunes at the Amsterdam day boundary.
- `web/` — Astro + Tailwind, server-rendered on every request: `/` is the only
  page. Times in Europe/Amsterdam, 12-hour with AM/PM (stored in UTC). It also
  logs one anonymous line per arrival to the journal, which is all the traffic
  telemetry there is.
- `shared/` — the two things both processes must agree on and nothing else: how
  a credit splits into artist and title, and where the state directory is. Pure
  functions and constants, no I/O.

**Today only.** At Europe/Amsterdam midnight the tracker drops the previous day's
plays, and there is nothing else to drop — a play references nothing outside its
own array. Then it starts collecting again. There is no archive and no dated
route — by design, not omission. The day boundary is Amsterdam regardless of
where the server or the viewer is.

## Requirements

`bun`, `yt-dlp`, `ffmpeg`, `tesseract` on PATH, plus `deno` for `yt-dlp`:
YouTube extraction without a JavaScript runtime is deprecated, and this tracker
re-resolves the stream URL on every tick. Any runtime yt-dlp supports will do;
deno is the one it looks for by default. Both processes must run on the
**same host**: they share one state directory, and the atomic-rename guarantee
the state layer depends on is not reliable across a network filesystem.

## Configuration

`EARWITNESS_STATE` — the **directory** holding the three state files, resolved by
both processes. Default `~/.local/share/earwitness/`, deliberately outside the
deployment directory so a redeploy cannot discard the current day. On a
containerized host it must point at a mounted volume.

Both processes must resolve the *same* directory; a divergent path is a silent
split-brain where each is right about a different empty directory. The default
therefore has exactly one definition, in `shared/`, and neither package keeps a
copy of it.

## Running it locally

```bash
bun install                                  # once, at the ROOT: it is a workspace
cd tracker && bun run tracker.ts             # terminal 1
cd web     && bun run dev                    # terminal 2 → localhost:4321
```

The root `package.json` declares the three packages as a workspace. Installing
inside one of them instead is not a shortcut: `web/` imports `@earwitness/shared`,
and without a workspace root Vite resolves `server.fs.allow` to `web/` alone and
the dev server refuses to read the file.

The tracker logs one line per event (play, anomaly, URL re-resolve, rollover).
The page renders per request and meta-refreshes every 30 s, so new plays appear
without interaction and without any client-side JavaScript.

## Deploying it

The repo carries no deployment config — supervise the two processes with
whatever the host already runs. They must live on the **same host** and resolve
the **same** `EARWITNESS_STATE` directory, on persistent storage and outside the
checkout so a redeploy cannot discard the current day.

The one deployment fact that is in the repo is the site's public URL, in
`web/src/lib/metadata.ts`: the head has to state it in an absolute form no
request can supply. Serving from another domain means changing that constant —
see "What the head tells a crawler" under Design.

```bash
bun install                  # workspace root: all three packages
cd web && bun run build      # web needs a build; it is SSR
```

Then `bun run tracker.ts` from `tracker/`, and `bun ./dist/server/entry.mjs`
from `web/`. Running the built output under Bun keeps one toolchain across both,
but nothing requires it: the data layer reads three plain files through `node:fs`
and pulls in no native binding or runtime builtin, so `node
./dist/server/entry.mjs` serves the same build identically.

Two things a supervisor has to get right:

- **PATH.** The tracker shells out to `yt-dlp`, `ffmpeg` and `tesseract`. A
  service manager's default PATH typically omits `/usr/local/bin`, which is
  where Bun and yt-dlp usually land.
- **Restart backoff.** Give the tracker roughly 15 s between restarts — long
  enough that a yt-dlp bot challenge or an off-air stream does not become a hot
  restart loop, short enough to recover a crash within one tick.

**Before provisioning, prove the stream resolves from that host:**

```bash
yt-dlp -g 'https://www.youtube.com/@claude/live'
```

YouTube commonly serves a bot challenge to datacenter IP ranges. A failure here
is not a bug to fix later — it reopens the hosting choice (PO-token sidecar,
residential proxy, or capturing from a residential host).

## Design

One responsive page, drawn at 1440, 834 and 390.

The mark is *Pixel Note*, an eighth note on a 12×12 grid: 21 blocks, one
geometry from the header down to the favicon, drawn in `currentColor` so it
inherits the health tone — terracotta on air, grey off air, ochre in trouble.
Type is Roboto Mono, behind the platform monospace stack.

**The palette is the stream's own.** Not "inspired by": every colour in the theme
is a pixel counted off a live frame, a blend of two of them, or a step down the
scene's own shading, and `web/test/palette.test.ts` refuses a fourth kind.

- **Sampled.** Paper #f5f3ed (62% of a frame by area), the halftone ink #2a2822,
  the terracotta of Clawd — Claude's mascot — #d97757, which is also Claude's
  brand orange, the two agreeing to within 1/255, its shaded side #bf684d, and the
  shadow under its picnic basket #915c1b, which is the trouble tone.
- **Blended.** Every neutral pixel in a frame satisfies G = R − 2, B = R − 8: the
  scene's greys are one line through sRGB, from paper to ink. The page's five
  neutrals are points on that line, quoted as a percentage of ink over paper, so
  a grey cannot drift into a hue the stream does not have.
- **Shaded.** The scene shades by a ×0.8845 multiply per step — Clawd's shaded
  blocks are exactly its lit ones once over. Only the link hover needs a step the
  frame does not already contain, and it takes the fourth.

The live orange runs at ONE tier by choice: the mark, the wordmark and the `now`
chip carry the same literal, at a measured 2.8:1 on paper, under the 4.5:1 small
text normally wants. That is the palette's one accessibility compromise, it is
recorded in `global.css`, and the test pins it so a second one cannot arrive
quietly. Elsewhere the `-text` suffix marks the tier that may set type.

The design system *is* Tailwind's theme: `web/src/styles/global.css` declares the
palette, ten type steps, six tracking values and exactly two breakpoints (700px
and 1100px, with the rest of the namespace cleared). Note that a class outside
the theme — an `sm:` variant, a mistyped token — generates no CSS and sits inert
rather than erroring, so changes are checked at the two real widths.

**The same palette at every width.** The breakpoints step the type scale and
nothing else, so the ratios above hold on a phone as they do on a desktop and
there is one palette to audit rather than three; the test fails a colour scoped
to `md:` or `lg:`. The only text over 24px is the hero title, at every width, so
nothing here leans on the large-text 3:1 bar in one place and loses it in
another. Two things a phone does that a desktop does not are handled outright:

- Android Chrome darkens a light page that declares no colour scheme, and an
  algorithmic inversion does not preserve the halftone's line. `:root` therefore
  declares `color-scheme: only light`, which refuses the override rather than
  correcting it afterwards. `theme-color` carries the paper up into the browser
  chrome above the page.
- A touch screen never sends a hover, so the footer links are underlined
  unconditionally: the accent is 1.9:1 against the grey it sits in, under the
  3:1 that lets colour alone mark a link. Hover deepens the colour.

**Re-sampling the palette** — a scene redesign is the only reason to. Count the
colours of a frame rather than eyedropping one: the scene animates, and a dot
halfway through a fade is not a palette entry.

```bash
URL=$(yt-dlp -g 'https://www.youtube.com/@claude/live')
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

Put the new values in `global.css` with their measured contrast, and update
SAMPLED in `web/test/palette.test.ts` — that list is the provenance record, and
nothing may call itself sampled without being in it.

**Redrawing the screenshot** — the committed image is a real capture, so shoot a
page backed by real state: run the tracker locally until the day's log has some
depth, or forward the deployment's port (`ssh -N -L 4321:127.0.0.1:4321 HOST`).
Seeded plays are not an option here — invented songs in the README read as a
claim about what the stream played. Serve the BUILT app
(`bun run build && bun run start`) or the deployment, never `astro dev`: the dev
toolbar sits in the bottom of the frame. Then screenshot the viewport at 1440×952:

```bash
chrome --headless=new --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1440,952 --screenshot=docs/screenshot-1440.png http://localhost:4321/
```

The desktop width is the only one committed; the other two are checked and thrown
away. Checking the phone width takes one trick: headless Chrome will not open a
window narrower than 500px, so a 390px render has to happen inside a 390px-wide
`<iframe>` — media queries follow the frame — or through the DevTools protocol.
Screenshotting a 390px window instead silently renders at 500 and crops, which
reads as an overflow bug that is not there.

Two states the page deliberately does not have:

- **There is no "ticker unreadable" state.** A failure count is operator
  telemetry a viewer cannot act on, so it maps onto the 15-minute silence state
  — same ochre treatment, the silence reported instead of the count. It goes to
  the journal.
- **The log is never truncated.** With no archive and no client-side JavaScript,
  a "172 earlier plays" label leads nowhere, so the day renders in full (a full
  day's ~450 rows is ≈150 KB) and the total stays in the log header.

**What the head tells a crawler.** One page means one title and one description,
and they are words, so they live in `web/src/lib/metadata.ts` and nowhere else —
the same split `presentation.ts` keeps from `health.ts`. The description carries
the Anthropic disclaimer as well as the footer does: a shared link is read by
people who have not opened the page.

`rel="canonical"`, `og:url` and `og:image` are absolute and cannot be built from
the request: TLS terminates at the edge, and the node adapter reads the scheme
off its own socket rather than `X-Forwarded-Proto`, so `Astro.url` says
`http://…` for a page served over HTTPS. The origin is therefore a constant —
`ORIGIN` in `metadata.ts`, which `site` in `astro.config.mjs` imports rather than
repeating, so the domain has one definition. It is the apex, and a Cloudflare
redirect rule 301s `www` onto it with the path and query intact — so the two
hostnames are one page at the edge, one cache entry rather than two, before a
request becomes a render. The canonical is the backstop under that rule. It
carries the path only, so a `?utm_…` or `?via=…` arrival collapses onto the
route, which is also how the edge is told to key its cache.

**Nothing is blocked, and there is no sitemap.** `web/public/robots.txt` allows
every crawler, AI ones included, and says why in the file — the short of it is
that one route is no crawl trap, that load is the edge's problem and not a
voluntary file's, and that a day of public ticker readings is nothing a
`Disallow` would protect. A sitemap would carry the homepage every crawler
already starts from, and `@astrojs/sitemap` would emit an empty urlset anyway
because the route is SSR ([withastro/astro#3682](https://github.com/withastro/astro/issues/3682)).
It is static in `public/` rather than a route: the answer is the same for every
request, so serving it from the origin per request would buy nothing and cost a
render.

Two things about that file are true only at the edge. While the origin had no
`robots.txt`, Cloudflare synthesized one — its Content Signals preamble about
`search`, `ai-input` and `ai-train`, comments and no directives. Once the origin
serves its own it passes through verbatim, signal and all uninjected, so the
synthesized copy is what a zone without this file gets rather than something
layered over it.

The second is the one that bites: `robots.txt` and the card are **static assets
to Cloudflare, cached for four hours, and a 404 caches too**. Fetching either URL
before the deploy that creates it pins a 404 at the edge for the rest of that
window, with the origin serving 200 the whole time. Purge those URLs after a
deploy that adds or renames one, or check them with `?cb=1` on the end — a
different cache key, and so the origin's actual answer.

**The card.** 1200×630 in `web/public/`, the frame every unfurl crops to, from
the source in `docs/og-card.svg`. It is the header drawn large — mark, wordmark,
tagline, the hero's halftone rule — and it names no song and no state: a platform
caches the card for days, so a claim about the air would go stale inside someone
else's timeline. Its colours are literals like the favicon's, and
`palette.test.ts` holds each one to the token it copies. The dimensions are
declared in the head so a scraper can lay the frame out before the image lands,
and the test reads the PNG to keep them the file's own.

That cache is keyed by the URL and nothing else, so **the filename carries a
version** — `CARD.path` in `metadata.ts` — and a redraw is a new path rather than
new bytes at an old one. A `?v=` query is not a substitute; enough scrapers
normalise it away.

**Redrawing the card** — edit the SVG, bump `CARD.path` to the next number, then
render and drop the file it replaced. The command takes the name from `CARD`, so
the version has one definition and the bump is one edit:

```bash
CARD=$(bun -e 'import {CARD} from "./web/src/lib/metadata"; process.stdout.write(CARD.path)')
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --virtual-time-budget=5000 \
  --screenshot="web/public$CARD" "file://$PWD/docs/og-card.svg"
```

Then `git rm` the card it replaced — the old URL is dead the moment the constant
moves, and two PNGs in `public/` is one of them going stale unnoticed.


Roboto Mono is fetched from the CDN while Chrome runs, so check the face in the
output: the platform mono fallback renders without complaining.

## Reading the ticker

The marquee scrolls one credit on a loop, so no single frame holds the whole
thing. A burst is 30 s at 2 fps and the stitcher recovers the credit from it:
align the fragments on a shared column axis by best overlap, vote per column,
detect the loop's repeat period, fold the votes modulo that period, then rotate
the cyclic result to the loop boundary.

Two details are worth knowing before touching any of it, both paid for on
2026-08-26: of that day’s 62 failed bursts, 44 died at period detection with a
readable consensus already in hand, and replaying them against the bounds below
recovered 24.

- **The period bounds are the credit's own length.** `MIN_PERIOD` and
  `MAX_PERIOD` in `stitch.ts` bracket how long a credit may be, and both were
  measured too narrow: `Grabek — three` loops every 15 columns and
  `Ben Seretan — criss cross applesauce right in the stream of the amp` every
  ~70. A credit outside the bracket is not found at all, or is found at a
  multiple of its period. They now run 12–96, and `burstSeconds` has to keep
  covering two loops of the longest — see the note on it in `config.ts`.
- **A fold can come out holding whole copies of the credit.** One copy is then
  the unit, and `collapseRepeats` keeps it; the test is rotation, not a split
  down the middle, because the ♪ separator OCRs at a different width in each
  repetition (`Passport — Reunion` folds as 19 + 21 columns). What must never
  reach the row is the other case — copies that merely resemble each other,
  which is a fold that smeared two readings together and parses perfectly well
  as a credit. `validUnit` refuses anything that still repeats.

Alignment runs twice. The first pass scores each fragment against whatever was
placed before it, so the early ones are judged by a nearly empty tally; the
second scores every fragment against the finished consensus of the first, and is
kept only when it places more of them.

A burst that will not stitch at all is retried on each half, the later one
first — the tracker bursts because the marquee changed, so a burst that straddles
the change holds two credits and nothing explains all of it. A half is weaker
evidence and has to be cleaner: one that could not align a third of its frames
is refused, which is what keeps a fold that came out a period short off the row.
Every result from this path is low-confidence and carries `burst_split` into the
journal.

**Where the burst is cut.** Halving it is only right when the change happens to
sit at the midpoint. `transitionIndex` finds where it actually sits, by scoring
every cut on how little the trigrams before it share with those after: within one
song both sides read the same credit and the score stays high everywhere, so no
transition is reported and the midpoint is used exactly as before. Adjacent-frame
similarity was tried first and is not usable — OCR drops whole frames to noise,
and its minima land mid-song. The cut is then searched a few frames PAST the
transition, because the frames catching the marquee mid-redraw are degenerate and
cost the later half its repeat period.

Of the 62 bursts that failed on 2026-08-26, this all recovers 30, and the
transition-aware cut adds 3 more on that day's 85 recorded failures — including
the 12:03 straddle that lost `Keen Collective — Beginnings`. The rest place
too few frames to span two loops of the marquee — their consensus is usually
readable, which is the standing hint that the next gain is in the OCR (the crop
goes to tesseract unprocessed, over a dotted background) rather than in here.

**When it bursts again after a failure.** A song whose OCR is pathological would
otherwise burst on every tick, so a failed stitch buys a backoff of 2, 4 then 6
ticks. That backoff is owed by one SONG, not by the clock: it holds only while
the marquee still reads as the burst that earned it, and any other text on screen
clears it and bursts immediately. The distinction is the whole point. A blanket
backoff cannot be cleared by the cheap same-song path — that path only recognises
the song already on the row — so a change arriving mid-cooldown left the tracker
blind for one to three minutes, which at ~3 min a song is a whole play lost per
failure, and the next burst then landed mid-transition and failed in turn. On
2026-08-26 that cascade dropped 58 of 233 changes, 32 of them at streak 2 or
worse, and held the tracker blind for 122 minutes of the day.

`marqueeStillReads` makes the distinction against the failed burst's own frames
rather than a unit, because a failed stitch has no unit. Two ticks of one song
30 s apart can share almost nothing — the marquee loops several times in
between — but a 30 s burst at 2 fps holds every phase of the loop, so whatever
phase the tick caught, some frame of that burst saw it too. The budget is a
ratio, and the two errors it can make are not equal: re-bursting a song it could
have skipped costs CPU on the burst path, while mistaking a new song for the old
one costs the play. Measured that day, same-song frames score 0.11-0.26 at the
median and cross-song frames never below 0.43; the default sits at 0.40.

## Health

The tracker writes one byte to `live.flag` at the start of every tick: `1` when
the last stream URL resolution succeeded, `0` when it failed. The file's mtime is
the heartbeat — no timestamp is stored, because the filesystem already keeps one.

The page derives what to say, first match winning. It says it in the hero, which
is also where the current song goes — so good news and bad news land in the same
place and a reader learns where to look once:

| condition | kicker | headline |
| --- | --- | --- |
| `live.flag` absent | Starting up | Tuning in |
| mtime over 3 minutes old | Tracker offline | Nothing heard since HH:MM AM |
| content `0` | Off air | Nothing on the air |
| unconfirmed, newest play over 15 minutes old | Nothing coming through | Nothing new for N minutes |
| confirmed under 3 minutes ago | On air · now playing | *the song's title* |
| confirmed longer ago than that | On air · last logged | *the song's title* |
| otherwise | Listening | No song logged yet |

The hero is *above* the list, never instead of it — a stitching problem must not
hide songs already captured. Only the two states with nothing captured to show,
starting-up and listening, render no list at all.

"Now playing" is the one claim the data has to earn, and it is earned by
`confirmed.flag` rather than inferred from a clock. The tracker stamps it on
every tick whose fingerprint still matches the current song — the ~85% path — so
a track of any length keeps the claim while it is genuinely on the marquee, and
loses it within one tick of changing to something the stitcher cannot read. That
is the case an age window got wrong in both directions: a 7-minute gap with the
song demonstrably still playing was called stale, while a failed stitch left the
page asserting a row that had stopped being true.

A burst that fails to stitch stamps it too, but only when the burst's last ten
seconds still fingerprint-match the song already on the row. An unreadable
marquee and an unstitchable one are not the same thing: the frames of a
`no_repeat_period` failure routinely show the song plainly, and withholding
confirmation there told the page a lie in the other direction. Nothing else may
stamp the flag — absence of a stamp is the signal.

Fresh confirmation also vetoes the 15-minute silence state, because a long track
and a stalled tracker look identical from the play list alone and differ exactly
here — a stalled tracker confirms nothing.

Where the flag has never been stamped — a tracker older than it, or the first
seconds of a fresh state directory — the page falls back to the play's age with
a 10-minute window. The list's `now` badge comes from the same computation, so
the two can never disagree.

`presentation.ts` holds every one of those words and nothing else; `health.ts`
holds the thresholds and the order. A copy edit must not touch the second file.

The heartbeat is stamped at tick *start*, not completion: a burst tick can
legitimately run for over a minute, and the 3-minute threshold clears that.

That threshold only means anything if a tick cannot outlast it, and for a long
time one could. `burstTimeoutMs` bounds the ffmpeg capture but not the OCR after
it: 60 frames at 20 s apiece is twenty minutes, and because no single call
timed out, nothing was raised and nothing was logged. On 2026-08-26 a loaded
host turned one tick into a 7 min 39 s blackout with no line in the journal, and
the song change inside it was reported eight minutes late. `burstOcrBudgetMs`
now caps the OCR phase at 45 s — five times the ~9 s it takes on an idle host —
so capture, budget and the last frame's own timeout come to 155 s and stay
inside the window. Past the budget the loop stitches from the frames it has and
logs `burst_ocr_budget` with the count; a truncated burst that no longer spans
two marquee loops simply fails to stitch, which is the ordinary refusal. Raise
this above ~60 s and the page's "offline" stops distinguishing a dead tracker
from a slow one.

Failure counts, retry streaks and error output are deliberately **not** on the
page. A viewer cannot act on them, and the symptom they can see is the silence
row above. They go to the journal, where the operator is.

## Traffic

The web process writes one line per **arrival** — a page load that did not come
from the page itself — and nothing else. Same rule as the failure counts above:
a reader cannot act on it, so it goes to the journal and never onto the page or
into `$EARWITNESS_STATE`, which holds a day of plays and nothing about whoever
read them. No cookie, no client-side JavaScript, no third party.

```
2026-08-27T09:41:12.000Z arrival ref=news.ycombinator.com/item via=hn country=NL tz=Europe/Amsterdam device=mobile ua=chrome bot=0
```

| field | meaning |
| --- | --- |
| `ref` | referring `hostname/path`, query stripped, or `direct` |
| `via` | the `?via=` tag of a link we posted ourselves, else `-` |
| `country` | `cf-ipcountry`; `XX` unknown, `T1` Tor |
| `tz` | `cf-timezone`, needs the location managed transform (below) |
| `device` | `mobile` / `tablet` / `desktop` |
| `ua` | Chromium / Firefox / WebKit family, no version |
| `bot` | `1` when the user agent looks scripted |

`robots.txt` welcomes every crawler, so this flag is what keeps that welcome from
distorting every other number on the line — filter `bot=1` out before reading any
of them, which the query below does.

**These lines are a sample, and only proportions are honest.** The edge cache
bounds origin renders at ~6 a minute per colo (`lib/freshness.ts`) however large
the audience, and this code runs only on an origin render. Whether a request is
the one that misses the cache has nothing to do with where it came from, so
"a third of arrivals came from HN" holds; "we had 412 arrivals" does not. Totals
and unique visitors come from Cloudflare's own edge counters, which see every
request, cost nothing, and need no code:

```bash
# jq builds the request body: a GraphQL query is multi-line and a JSON string
# may not be, so hand-escaping it is the one step that silently 400s.
Q='{ viewer { zones(filter: {zoneTag: "<ZONE_ID>"}) {
      httpRequests1dGroups(limit: 30, filter: {date_geq: "2026-08-01"},
                           orderBy: [date_ASC]) {
        dimensions { date } uniq { uniques }
        sum { requests cachedRequests bytes cachedBytes } } } } }'

curl -s https://api.cloudflare.com/client/v4/graphql \
  -H "Authorization: Bearer $CF_ANALYTICS_TOKEN" -H 'Content-Type: application/json' \
  --data "$(jq -n --arg q "$Q" '{query: $q}')" | jq .
```

`requests - cachedRequests` and `bytes - cachedBytes` are also the uplink bill
the edge TTL exists to hold down — the same query that reports readers reports
whether that protection is still working. Token scope: Zone → Analytics → Read,
supplied through the environment and never committed. Free-plan retention is
days, so snapshot the daily rollup if a longer series matters; note also that
its days are UTC while a day of plays is Amsterdam, so use
`httpRequests1hGroups` and re-bucket to compare the two.

### Reading the lines

```bash
U=<web-unit>    # systemctl list-units --all | grep -i earwitness
                # user units need --user on every command below

journalctl -u $U -f | grep arrival                  # watch, while posting a link

# today's sources, readers only, ranked. Swap k= for via, country, tz, device, ua
journalctl -u $U --since today -o cat \
  | awk -v k=ref '/ arrival / && !/bot=1/ {
      for (i = 1; i <= NF; i++) if ($i ~ "^" k "=") print substr($i, length(k) + 2)}' \
  | sort | uniq -c | sort -rn
```

One query for every field, which is why each is a space-free `key=value` and an
absent one is `-` rather than empty. `-o cat` drops journald's metadata and
leaves the line's own timestamp, in the tracker's format, so
`journalctl -o cat -u <web-unit> -u <tracker-unit> --since today` interleaves
arrivals and plays into one timeline — the view where "traffic spiked" and "the
tracker went quiet" become one story.

**Where the journal actually is**, before relying on it: `ls /var/log/journal`
— if that directory is missing, journald is running in RAM under
`/run/log/journal` and every line dies at reboot (`Storage=persistent` fixes
it). Retention is size-driven, not time-driven: `SystemMaxUse` defaults to 10%
of the filesystem, and old entries fall off the back silently, so
`journalctl --disk-usage` is the honest answer to "how far back can I look".
Reading another user's system journal needs root or the `systemd-journal` group.
Volume is not a concern — arrivals are thousands a day against journald's
~10,000-per-30 s per-service rate limit — but if `Suppressed N messages` ever
appears, `LogRateLimitBurst=0` in the unit turns the limiter off for it.

### Two things worth doing on the Cloudflare side

- **Turn on the location headers.** `cf-ipcountry` arrives with IP geolocation
  alone; `cf-timezone` needs the **Add visitor location headers** managed
  transform (Rules → Settings → Managed Transforms, or `add_visitor_location_headers`
  through `PATCH /zones/$ZONE_ID/managed_headers`), free on every plan and off by
  default. Without it `tz` is `-` and nothing else changes. Verifying it takes
  patience rather than a flag: the header only ever appears at the origin, and the
  page's cache key ignores the query, so `?cb=1` will not force a render — space
  two requests more than `EDGE_TTL_SECONDS` apart and watch `tz` in the journal.
- **Tag the links you place.** Post `/?via=hn`, `/?via=bsky`. Referrer policy
  strips cross-origin referrers in most browsers and app webviews send none at
  all, so `direct` is an upper bound on "found it on their own" and the tag is
  the only attribution that survives. Tags are free here: the edge keys the
  page's cache on the route alone, so they neither fragment the cache nor add an
  origin render, and the canonical already collapses them onto `/` for crawlers.
  A refresh keeps the tag but is self-referred, so it inflates nothing.

### What is deliberately not collected

No IP, no raw user-agent string, no city. Every field is a bucket, because a
bucket describes a population while the raw values — joined on one timestamped
line — describe a person, and this project's whole state evaporates at midnight.
`lib/arrival.ts` is the only place a request header is read and it returns unions
and validated tokens, so the anonymity is a property of its signatures rather
than a habit; a test asserts a Samsung phone's model and OS build cannot appear
in a line built from its own user agent.

City is available — the same managed transform adds `cf-ipcity` — and is left
off for three stacking reasons: a thousand-bucket long tail does not survive the
cache sampling above, IP-to-city resolves mobile carriers to their egress hub so
the ranking would describe network topology, and city beside device and referrer
is the field that turns a statistic into a person. `tz` answers the question
this page actually has: the day boundary is Amsterdam for everyone, so the
readers worth knowing about are the ones who meet the rollover mid-afternoon.
For a map, the free Cloudflare dashboard already draws requests by country,
unsampled.

Three known distortions, none of them fixable from a user-agent string: iPadOS
Safari reports a desktop Mac UA by default, so most iPads land in `desktop`; a
browser configured to send no referrer at all looks like a fresh `direct`
arrival on every cache miss; and `bot` is a substring filter, not a taxonomy —
it will file a Cubot phone as a crawler and miss a crawler that dresses up as
Chrome. Each costs a share, none moves the mobile-versus-desktop split the two
breakpoints are chosen on.

If sampled proportions stop being enough, the upgrade is Cloudflare Pro rather
than more code here: it reports referer host, device type, browser and a Visits
metric (a page view whose referer is not this hostname — the arrival, defined at
the edge) across every request, with no beacon and nothing on the page.

## Data

Three plain files in `$EARWITNESS_STATE`. No database: with one day retained, every
relational feature was unused — the index covered at most ~480 rows, the unique
constraint was unreachable because dedup scans by edit distance first, and the
foreign key existed only to order the prune. What SQLite did provide, atomic
writes, is `writeState` in `tracker/src/state.ts`.

```
plays.json      ~50 KB   ~400 writes/day   temp file + rename
live.flag        1 byte   ~2880 writes/day  content 0|1, mtime = heartbeat
confirmed.flag   0 bytes  ~2450 writes/day  no content, mtime = last confirmation
```

```json
{ "version": 2,
  "plays": [{ "detectedAt": "2026-08-23T09:41:12.000Z",
              "credit": "Ben Seretan — kokosing" }] }
```

`plays.json` holds the day's plays and nothing else. A play is the observation
and only the observation: `detectedAt`, the clock at the moment the tracker
*resolved* the song — it lags the song's actual start by up to a burst, which is
what the confirmation flag absorbs — and `credit`, the stitched reading of
the ticker. Artist and title are `parseUnit(credit)` and are derived by each
reader at the point of use, so a parser fix improves the morning's rows on the
next render instead of waiting for midnight. 113 B/play, about 50 KB at a full
day's ~450 plays.

Plays are appended chronologically, and that order is what the health state
depends on — the newest play is the last element. The page renders them newest
first. `credit` is what dedup compares against, and it is compared
**rotation-invariantly**: the stitcher guesses where the marquee loop starts, so
two bursts of one song can be cut at different points and Levenshtein alone once
filed those as separate songs. On a match the play stores the credit of the entry
it matched, never the incoming one — that is what keeps one song from appearing
under two spellings, and with no track table left it is the only thing that does.
A play carries no confidence field under any name, and a test in
`tracker/test/state.test.ts` enforces that — the tracker's certainty about a
stitch is in the journal, and nothing reads it back.
Useful checks:

```bash
S=${EARWITNESS_STATE:-~/.local/share/earwitness}

jq '.plays | length' "$S/plays.json"                 # plays so far today

jq -r '.plays[-10:][] | "\(.detectedAt)  \(.credit)"' \
  "$S/plays.json"                                    # last 10 plays

cat "$S/live.flag"                                   # 1 = live, 0 = off air
stat -c %y "$S/live.flag"                            # the heartbeat (mtime);
                                                     # macOS: stat -f %Sm

journalctl -u <tracker-unit> | grep anomaly         # the only forensic record
                                                     # low_confidence_stitch =
                                                     # an uncertain row
```

**One rule when touching the state layer:** `writeFileSync` to `plays.json`
truncates before writing, so a crash mid-write destroys the day. Every write goes
through `writeState` (temp file + rename in the same directory) and there must
never be a second path.

**The version contract.** Both processes assert `version === 2` — the exact
value, not merely that it is a number. The two deploy from one checkout but run
as two systemd units and restart independently, and this field is the only thing
that notices when they disagree about the shape of the file between them.

On a mismatch they diverge, deliberately. The tracker renames the file to
`plays.json.v<n>.bak` in the same directory, logs the rename with both versions,
and continues from empty state — the file is readable and merely old, and exiting
would crash-loop a forward deploy until the next Amsterdam midnight. The web app
renders no plays, which its existing contract shows as a normal health state
rather than an error. A file that will not parse at all is a different case and
is unchanged: the tracker reports it and exits, because it cannot tell a corrupt
file from a whole day of plays.

There is no migration and there will not be one. State lives at most 24 hours by
design, so a format change costs whatever part of one Amsterdam day has
accumulated when the new binary starts.

## Field toolkit

All capture constants live in `tracker/src/config.ts`. Measured facts: crop
`crop=520:46:1390:42` at 1080p (glyphs occupy y 52-82; the scene's dotted
terrain reaches y 106, and the crop stops at 87 to stay clear of it); marquee
scrolls ≈ 4 chars/s with a ~1–2 s hold
at the unit start each loop; the ♪ glyph between loop repetitions OCRs as `C`,
`¢¢`, `dd`, a plain space, or nothing; song transitions are instant text swaps
(empty OCR = capture hiccup, not a transition).

```bash
# resolve the stream URL (the ~6 h embedded expiry is a lie: the media playlist
# is a sliding window and dies after ~25-30 s)
URL=$(yt-dlp -g 'https://www.youtube.com/@claude/live')

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

**If the overlay ever moves or is redesigned**, grab a full frame and
re-locate the ticker, then update `crop` in `tracker/src/config.ts`:

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
ffmpeg -loglevel error -i sample.ts   -vf "crop=520:200:1390:0,fps=2,format=gray,scale=1:200:flags=area"   -f rawvideo -pix_fmt gray -y rows.raw
python3 - <<'"'"'EOF'"'"'
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

## Tests

```bash
bun test                 # all three packages, from the workspace root

cd tracker && bun test   # stitcher, fingerprint, day boundary, prune, dedup,
                         # canonical credit, atomic writes, version contract,
                         # unreadable-state refusal
cd shared  && bun test   # parse, and the guard against a second parser
cd web     && bun test   # health thresholds and their ORDER, the hero's words,
                         # the read side's three no-rows paths, the Amsterdam
                         # day filter, the palette's provenance, contrast and
                         # call sites, the head's words and the budget they are
                         # written to, the card's dimensions against the PNG on
                         # disk and the version in its name, robots.txt blocking
                         # nobody, the arrival rule with its anonymity and its
                         # line format, and the guards keeping words out of
                         # health.ts, the domain to one definition, and the two
                         # day-boundary copies in step
```

Type checking is separate, and `bun run build` does not do it — Astro transpiles
`.astro` components without checking them. The five components are covered only
by:

```bash
cd web && bun run check  # astro check: components, pages, lib and tests
```

It is held at `typescript@^6`, and the major is the part that matters:
TypeScript 7 is a native rewrite that does not yet expose the programmatic API
`astro check` calls, so it fails outright rather than degrading quietly. The
caret takes 6.x fixes and stops short of that. Track
[withastro/roadmap#1321](https://github.com/withastro/roadmap/discussions/1321)
before widening it.

## Licence

MIT — see [LICENSE](LICENSE).

Earwitness is an independent project and is not affiliated with, endorsed by, or
connected to Anthropic. It reads the public credit ticker on a public stream and
records what it sees; it redistributes no audio or video. Track and artist names
belong to their respective owners, and the MIT grant above covers this code
only, not the material it names. The page carries the same disclaimer in its
footer, where a reader will actually see it.

Roboto Mono is Apache-2.0 and is loaded from Google Fonts rather than vendored,
so no font files ship in this repository.
