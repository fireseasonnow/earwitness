export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** How long a timed-out process gets to act on SIGTERM before SIGKILL. */
const TERM_GRACE_MS = 2_000;

/** How long after SIGKILL to wait for the process's pipes to close. */
const KILL_GRACE_MS = 1_000;

/**
 * Run a subprocess with a hard timeout (HLS reads can hang forever).
 *
 * The timeout has to end the wait however the child behaves, because nothing
 * else in the loop can. SIGTERM alone did not: on 2026-10-31 an ffmpeg stuck
 * reading HLS never acted on it, this function waited for its exit, and the
 * tracker logged nothing for 8 days while its unit reported active.
 *
 * SIGKILL ends the child but not a grandchild, which inherits the pipes and
 * keeps them open, so past that the wait is abandoned rather than continued.
 */
export async function run(cmd: string[], timeoutMs: number): Promise<RunResult> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const killedNote = `[killed after ${timeoutMs} ms]`;
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let abandonTimer: ReturnType<typeof setTimeout> | undefined;
  let abandon: () => void = () => {};
  const abandoned = new Promise<null>((resolve) => {
    abandon = () => resolve(null);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
    killTimer = setTimeout(() => {
      proc.kill("SIGKILL");
      abandonTimer = setTimeout(abandon, KILL_GRACE_MS);
    }, TERM_GRACE_MS);
  }, timeoutMs);
  try {
    const finished = Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const result = await Promise.race([finished, abandoned]);
    if (result === null) {
      return { code: 1, stdout: "", stderr: killedNote };
    }
    const [stdout, stderr, code] = result;
    if (timedOut) {
      return { code: code === 0 ? 1 : code, stdout, stderr: `${stderr}\n${killedNote}` };
    }
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
    clearTimeout(killTimer);
    clearTimeout(abandonTimer);
  }
}
