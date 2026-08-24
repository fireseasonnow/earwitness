import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the tracker's state directory lives when `EARWITNESS_STATE` is unset.
 *
 * The state outlives the checkout: it holds the current day and a redeploy must
 * not clobber it, so the default lives outside the deployment directory.
 * EARWITNESS_STATE names a DIRECTORY, not a file — it holds plays.json and
 * live.flag. On a host, point it at
 * persistent storage: a mounted volume if containerized.
 *
 * It lives here because both processes must agree on it and they have no other
 * channel: a divergent default is a silent split-brain, each process right about
 * a different empty directory. It used to be a copy in each package under a
 * comment asking the next editor to keep them in step.
 */
export const DEFAULT_STATE_DIR = join(homedir(), ".local", "share", "earwitness");

/** The state directory in force: the environment's, or the default above. */
export function resolveStateDir(env: string | undefined = process.env.EARWITNESS_STATE): string {
  return env ?? DEFAULT_STATE_DIR;
}
