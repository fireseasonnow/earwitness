import { describe, expect, test } from "bun:test";
import { run } from "../src/proc";

/** Long enough that a run() still waiting on the child fails the test's own bound. */
const CHILD_LIFETIME_S = 30;

async function elapsed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = Date.now();
  const value = await fn();
  return [value, Date.now() - started];
}

describe("run", () => {
  test("returns a finished command's output and exit code", async () => {
    const r = await run(["sh", "-c", "echo out; echo err >&2; exit 3"], 5_000);
    expect(r).toEqual({ code: 3, stdout: "out\n", stderr: "err\n" });
  });

  test("stops a command that honours SIGTERM at the timeout", async () => {
    const [r, ms] = await elapsed(() => run(["sleep", String(CHILD_LIFETIME_S)], 100));
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain("[killed after 100 ms]");
    expect(ms).toBeLessThan(1_500);
  });

  // The 2026-10-31 outage: an ffmpeg that never acted on SIGTERM held the tracker
  // for 8 days while every unit reported active.
  test(
    "force-kills a command that ignores SIGTERM",
    async () => {
      const [r, ms] = await elapsed(() =>
        run(["sh", "-c", `trap '' TERM; exec sleep ${CHILD_LIFETIME_S}`], 100),
      );
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("[killed after 100 ms]");
      expect(ms).toBeLessThan(6_000);
    },
    10_000,
  );

  // SIGKILL reaches only the direct child. A grandchild inherits the pipes and
  // keeps them open, so waiting for their end would hang all over again.
  test(
    "gives up on a killed command whose pipes stay open",
    async () => {
      const [r, ms] = await elapsed(() =>
        run(["sh", "-c", `trap '' TERM; sleep ${CHILD_LIFETIME_S} & wait`], 100),
      );
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain("[killed after 100 ms]");
      expect(ms).toBeLessThan(6_000);
    },
    10_000,
  );
});
