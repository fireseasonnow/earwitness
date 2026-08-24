/**
 * One log-line format, in one place.
 *
 * Abnormal conditions and events go to stdout and nowhere else: journald is the
 * project's only forensic record. The state layer has to report a version
 * mismatch as it renames the
 * file aside, so the format cannot live in `tracker.ts` alone.
 */
export function log(msg: string): void {
  console.log(`${new Date().toISOString()} ${msg}`);
}
