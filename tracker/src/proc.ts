export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a subprocess with a hard timeout (HLS reads can hang forever). */
export async function run(cmd: string[], timeoutMs: number): Promise<RunResult> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (timedOut) {
      return { code: code === 0 ? 1 : code, stdout, stderr: `${stderr}\n[killed after ${timeoutMs} ms]` };
    }
    return { code, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}
