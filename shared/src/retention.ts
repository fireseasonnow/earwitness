/**
 * How long a play is kept. The page cuts the log at each reader's own midnight,
 * so the file must hold the longest current day in any zone: under 24 hours,
 * or 25 on the day a zone falls back.
 */
export const RETENTION_MS = 25 * 60 * 60 * 1000;
