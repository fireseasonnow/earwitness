import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "./config";
import { run } from "./proc";

function ensureFrameDir(): void {
  mkdirSync(CONFIG.frameDir, { recursive: true });
}

/** One cropped ticker frame — the cheap ~85% path. */
export async function captureTickFrame(url: string): Promise<string> {
  ensureFrameDir();
  const out = join(CONFIG.frameDir, "tick.png");
  const r = await run(
    ["ffmpeg", "-loglevel", "error", "-i", url, "-frames:v", "1", "-vf", CONFIG.crop, "-y", out],
    CONFIG.captureTimeoutMs,
  );
  if (r.code !== 0) {
    throw new Error(`ffmpeg tick capture failed (exit ${r.code}): ${r.stderr.trim().slice(0, 300)}`);
  }
  return out;
}

/** 14 s at 1 fps with the same crop — covers one full ~11 s marquee loop. */
export async function captureBurst(url: string): Promise<string[]> {
  ensureFrameDir();
  for (const f of readdirSync(CONFIG.frameDir)) {
    if (/^burst_\d+\.png$/.test(f)) rmSync(join(CONFIG.frameDir, f), { force: true });
  }
  const pattern = join(CONFIG.frameDir, "burst_%02d.png");
  const r = await run(
    [
      "ffmpeg",
      "-loglevel",
      "error",
      "-t",
      String(CONFIG.burstSeconds),
      "-i",
      url,
      "-vf",
      `${CONFIG.crop},fps=${CONFIG.burstFps}`,
      "-y",
      pattern,
    ],
    CONFIG.burstTimeoutMs,
  );
  if (r.code !== 0) {
    throw new Error(`ffmpeg burst capture failed (exit ${r.code}): ${r.stderr.trim().slice(0, 300)}`);
  }
  return readdirSync(CONFIG.frameDir)
    .filter((f) => /^burst_\d+\.png$/.test(f))
    .sort()
    .map((f) => join(CONFIG.frameDir, f));
}

/** Native tesseract on the raw crop — no preprocessing (verified best). */
export async function ocrFrame(path: string): Promise<string> {
  const r = await run(["tesseract", path, "stdout", "--psm", "7"], 20_000);
  if (r.code !== 0) {
    throw new Error(`tesseract failed (exit ${r.code}): ${r.stderr.trim().slice(0, 200)}`);
  }
  return r.stdout.trim();
}
