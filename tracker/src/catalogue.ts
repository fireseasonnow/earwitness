/**
 * Credits whose spelling has been checked by hand, and the one rule that uses
 * them: a stitched unit close enough to one of these IS that credit.
 *
 * The day's first reading of a song becomes its spelling for the whole day
 * (`resolveCredit`), so one misread OCR glyph is on the page until midnight and
 * comes back the next morning in whatever form that morning's first burst reads.
 * Voting over the day does not help when the misreading is the majority:
 * tesseract reads "Ol'" in this font as "O1'" far more often than not. Between
 * 2026-09-24 and 2026-10-08 the two Ol' Burger Beats credits were stored as
 * sixteen different strings, with "O1'", "01'", "0O1'", "Burgr", "Winer" and
 * "Witer" among them. The only correct two came from fixing plays.json by hand.
 *
 * The stream loops one playlist, so a credit checked once stays right. Add a
 * credit only after reading it off the stream yourself. This is a list of
 * spellings, not a log: it records no plays and no times, and the page's
 * today-only rule is untouched.
 */

import { rotationDistance } from "./fingerprint";
import { editDistance, normalize } from "./normalize";

export const KNOWN_CREDITS: readonly string[] = [
  "Ol' Burger Beats — Ella G",
  "Ol' Burger Beats — Winter Night",
];

/**
 * Fixed and small, NOT the dedup budget. A noisy stitch earns a wider budget
 * for matching today's own rows, up to a fifth of its length. That is safe
 * when the candidates are songs actually heard today. It is not safe here,
 * where a wide budget could give one Ol' Burger Beats title the other's name.
 * Three covers every misreading observed, including "0O1' … Witer Night".
 */
export const KNOWN_CREDIT_MAX_EDITS = 3;

/**
 * The known credit `unit` is a reading of, or `unit` unchanged.
 *
 * Rotation-aware, like the dedup it feeds: a unit cut at the wrong loop point
 * is still the same credit. Closest match wins, so two near-identical known
 * credits never depend on list order.
 */
export function knownSpelling(
  unit: string,
  known: readonly string[] = KNOWN_CREDITS,
  maxEdits: number = KNOWN_CREDIT_MAX_EDITS,
): string {
  const norm = normalize(unit);
  let best: { credit: string; distance: number } | null = null;
  for (const credit of known) {
    const target = normalize(credit);
    const distance = Math.min(
      editDistance(norm, target),
      rotationDistance(norm, target, maxEdits),
    );
    if (distance <= maxEdits && (best === null || distance < best.distance)) {
      best = { credit, distance };
    }
  }
  return best?.credit ?? unit;
}
