import { CONFIG } from "./config";
import { run } from "./proc";

/**
 * Cached HLS stream URL, re-resolved once the cache passes `urlMaxAgeMs` — and
 * immediately when a capture fails (`invalidate`).
 *
 * The ~6 h expiry embedded in the URL's signature is a lie, and this comment
 * used to repeat it. `yt-dlp -g` hands back a MEDIA playlist: a snapshot of a
 * sliding window of 2 s segments that stops working after ~25-30 s whatever the
 * signature claims (measured 2026-08-23). Hence 20 s, which has to stay well
 * under the 30 s tick or every tick pays a failed capture before re-resolving.
 */
export class StreamUrl {
  private url: string | null = null;
  private resolvedAt = 0;

  invalidate(): void {
    this.url = null;
  }

  /** Returns the cached URL, resolving via yt-dlp when needed. */
  async get(): Promise<{ url: string; resolved: boolean }> {
    if (this.url && Date.now() - this.resolvedAt < CONFIG.urlMaxAgeMs) {
      return { url: this.url, resolved: false };
    }
    const r = await run(["yt-dlp", "-g", CONFIG.livePageUrl], CONFIG.resolveTimeoutMs);
    const url = r.stdout.trim().split("\n")[0] ?? "";
    if (r.code !== 0 || url.length === 0) {
      throw new Error(`yt-dlp failed (exit ${r.code}): ${r.stderr.trim().slice(0, 300)}`);
    }
    this.url = url;
    this.resolvedAt = Date.now();
    return { url, resolved: true };
  }
}
