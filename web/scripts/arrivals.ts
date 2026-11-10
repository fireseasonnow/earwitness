/**
 * The read side of the `arrival` lines `middleware.ts` writes to the journal.
 *
 *   journalctl -o cat --user-unit <web-unit> | bun run arrivals
 *
 * `--user-unit` when the units are user units, `-u` when they are system units:
 * the wrong one returns nothing at all rather than an error.
 *
 * Reads stdin, ignores every line that is not an arrival, and prints the span,
 * the human/bot split, readers per Amsterdam day, and the share of each bucket.
 * Bots are counted and then left out of everything after the split.
 *
 * Shares, not totals, are the answer: the lines are a sample of cache misses —
 * see the header of `src/lib/arrival.ts` — and the totals are Cloudflare's.
 */

// A module, so top-level `await` typechecks.
export {};

const FIELDS = ["ref", "via", "country", "tz", "device", "ua"] as const;
const TOP = 10;

type Row = Record<string, string> & { ts: string };

/** `<ISO ts> arrival k=v …`, split the way `formatArrival` promises it splits. */
function parse(line: string): Row | null {
  const [ts, event, ...rest] = line.split(" ");
  if (event !== "arrival" || ts === undefined) return null;
  const row: Row = { ts };
  for (const kv of rest) {
    const i = kv.indexOf("=");
    if (i > 0) row[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return row;
}

function amsterdamDay(ts: string): string {
  return new Date(ts).toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

function count(values: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const rows = (await Bun.stdin.text())
  .split("\n")
  .map(parse)
  .filter((r): r is Row => r !== null);

if (rows.length === 0) {
  console.log("No arrival lines on stdin. Wrong unit flag? See the header of this script.");
  process.exit(0);
}

const readers = rows.filter((r) => r.bot !== "1");
const pct = (n: number) => `${((100 * n) / readers.length).toFixed(1).padStart(5)}%`;

console.log(`span      ${rows[0]!.ts} → ${rows.at(-1)!.ts}`);
console.log(`arrivals  ${rows.length} — ${readers.length} readers, ${rows.length - readers.length} bots`);

console.log("\nreaders per Amsterdam day");
for (const [day, n] of count(readers.map((r) => amsterdamDay(r.ts))).sort((a, b) =>
  a[0].localeCompare(b[0]),
)) {
  console.log(`  ${day}  ${String(n).padStart(5)}`);
}

for (const field of FIELDS) {
  console.log(`\n${field}`);
  for (const [value, n] of count(readers.map((r) => r[field] ?? "-")).slice(0, TOP)) {
    console.log(`  ${String(n).padStart(5)}  ${pct(n)}  ${value}`);
  }
}
