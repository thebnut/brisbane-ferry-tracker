/**
 * Per-feed watch on TransLink's own header timestamp (R14-RT1, staging 20 Oct). The hub counts any decoded 200 as a
 * changed feed, so an upstream that keeps answering while its header time stands still rebuilt every poll, logged
 * nothing, and showed up only as /v1/health 503s and boards gone "delayed". This makes such a freeze one `warn` line
 * per feed and episode (`rt source stale`), and its end one more (`rt source recovered`, with how long it lasted).
 *
 * A feed is stale once its header time has not advanced for SOURCE_STALE_MIN_POLLS successful polls in a row (200 or
 * 304) and is older than staleAfterMs(cycle): 90 s, or three polls at a slower cadence. That is under health's 120 s,
 * so the line comes before the 503s, and well over TransLink's normal lag (10 to 25 s behind on staging, with the
 * header moving in 10 s steps). Failed fetches don't count either way: they are already logged as `rt cycle partial`.
 */
import type { Logger } from '../log.ts'

export const SOURCE_STALE_MIN_POLLS = 3
export const SOURCE_STALE_MIN_MS = 90_000

/** How old a feed's header time must be (with SOURCE_STALE_MIN_POLLS unchanged polls) to count as stale. */
export const staleAfterMs = (cycleMs: number) =>
  Math.max(SOURCE_STALE_MIN_MS, SOURCE_STALE_MIN_POLLS * cycleMs)

interface FeedWatch {
  /** Header time (s) last seen, and when (ms) the hub first saw it. */
  ts: number
  seenAt: number
  /** Successful polls since the header time last advanced. */
  polls: number
  /** When this episode was logged as stale, or null. */
  staleAt: number | null
}

export class SourceWatch {
  private readonly feeds = new Map<string, FeedWatch>()
  private readonly afterMs: number

  constructor(
    private readonly log: Logger,
    cycleMs: number,
  ) {
    this.afterMs = staleAfterMs(cycleMs)
  }

  /**
   * One successful poll of `feed` whose header time is `ts` (seconds; 0 or less: the feed has no header time, and is
   * not judged). `seq` is the hub's snapshot seq, for the log line.
   */
  observe(feed: string, ts: number, nowMs: number, seq: number): void {
    if (!(ts > 0)) return
    const w = this.feeds.get(feed)
    if (!w || ts > w.ts) {
      if (w?.staleAt != null) {
        this.log.info('rt source recovered', {
          feed,
          sourceTimestamp: ts,
          staleS: Math.round((nowMs - w.seenAt) / 1000),
          polls: w.polls,
          seq,
        })
      }
      this.feeds.set(feed, { ts, seenAt: nowMs, polls: 0, staleAt: null })
      return
    }
    w.polls++
    const ageMs = nowMs - w.ts * 1000
    if (w.staleAt == null && w.polls >= SOURCE_STALE_MIN_POLLS && ageMs > this.afterMs) {
      w.staleAt = nowMs
      this.log.warn('rt source stale', {
        feed,
        sourceTimestamp: w.ts,
        ageS: Math.round(ageMs / 1000),
        polls: w.polls,
        seq,
      })
    }
  }

  /** Feeds currently in a stale episode (tests, and the hub status). */
  stale(): string[] {
    return [...this.feeds].filter(([, w]) => w.staleAt != null).map(([k]) => k)
  }
}
