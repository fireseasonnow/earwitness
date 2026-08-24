/**
 * Code both processes must agree on, and nothing else.
 *
 * The tracker writes `plays.json`; the web app reads it. They deploy from one
 * checkout but run as two systemd units, so anything they must agree about is an
 * unenforced contract unless it has exactly one definition. Two such agreements
 * exist: where the state directory is, and how a credit splits into artist and
 * title. Both live here.
 *
 * Scope is deliberately narrow — pure functions and constants. No filesystem, no
 * I/O, no config loading. A module that reads anything would make this a third
 * process's worth of behaviour rather than a shared definition.
 */
export { parseUnit } from "./src/parse";
export type { ParsedUnit } from "./src/parse";
export { DEFAULT_STATE_DIR, resolveStateDir } from "./src/state-dir";
