# Earwitness

[Claude FM](https://www.youtube.com/@claude/live), Anthropic's 24/7 stream, names
the song it is playing in exactly one place: a credit ticker scrolling through a
corner of the video. Nothing publishes it as text, and each name is gone as soon
as it scrolls off.

Earwitness reads it anyway. Every 30 s it OCRs one cropped frame; on a song change
it captures a 30 s burst at 2 fps and stitches the ~60 fragments — each a partial,
half-misread slice of the marquee — back into one canonical `Artist — Title`. An
independent project, unofficial and not affiliated with Anthropic.

**On air at [earwitness.fyi](https://earwitness.fyi)** — what the stream has played
**today**, and nothing older.

![The page on air — hero, health line, and the day's log](docs/screenshot-1440.png)

Two supervised processes on one host, no AI calls.

- `tracker/` — Bun + TypeScript: the loop above, and what it does when the loop
  is not sure. A stitch it cannot vouch for goes to the journal with its
  fragments, not onto the row. It also stamps a heartbeat every tick, records
  that the marquee still reads as the song already logged, and prunes at the
  Amsterdam day boundary.
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

## Running it locally

`bun`, `yt-dlp`, `ffmpeg` and `tesseract` on PATH, plus `deno` for `yt-dlp`.

```bash
bun install                                  # once, at the ROOT: it is a workspace
cd tracker && bun run tracker.ts             # terminal 1
cd web     && bun run dev                    # terminal 2 → localhost:4321
```

Install at the workspace root: inside one package instead, Vite resolves
`server.fs.allow` to `web/` alone and refuses to read `@earwitness/shared`.

`EARWITNESS_STATE` is the **directory** holding the state files, default
`~/.local/share/earwitness/` — outside the checkout, so a redeploy cannot discard
the current day. Both processes must run on the **same host** and resolve the
**same** directory: the atomic rename the state layer needs is unreliable across
a network filesystem, and a divergent path is a silent split-brain.

Field commands and the measurements behind the capture constants:
[docs/field-notes.md](docs/field-notes.md).

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
