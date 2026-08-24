export interface ParsedUnit {
  artist: string;
  title: string;
  /** false → parse failure: store the unit as the title, log it, never guess. */
  ok: boolean;
}

/**
 * Split a canonical unit on the FIRST " — " (space, em-dash, space).
 * Titles may carry a numeric prefix ("02 - Boundless Horizons") which is
 * stripped for display; the caller keeps the raw unit unchanged.
 */
export function parseUnit(rawUnit: string): ParsedUnit {
  const raw = rawUnit.trim();
  const idx = raw.indexOf(" — ");
  if (idx <= 0) {
    return { artist: "", title: raw, ok: false };
  }
  const artist = raw.slice(0, idx).trim();
  let title = raw.slice(idx + 3).trim();
  const stripped = title.replace(/^\d{1,3}\s*-\s+/, "");
  if (stripped.length > 0) title = stripped;
  return { artist, title, ok: artist.length > 0 && title.length > 0 };
}
