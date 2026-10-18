/**
 * In-flight promise sharing with last-good fallback (ADR-0007, from the archive's gtfsService.fetchFeed).
 * Concurrent callers share one fetch. Inside the throttle window the last good value is returned, never null.
 */
export class SharedFetch<T> {
  private inflight: Promise<T> | null = null
  private last: { value: T; at: number } | null = null

  constructor(
    private readonly load: () => Promise<T>,
    private readonly maxAgeMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get lastGood(): T | null {
    return this.last?.value ?? null
  }

  async get(): Promise<T> {
    if (this.last && this.now() - this.last.at < this.maxAgeMs) return this.last.value
    if (!this.inflight) {
      this.inflight = this.load()
        .then((value) => {
          this.last = { value, at: this.now() }
          return value
        })
        .catch((err) => {
          if (this.last) return this.last.value
          throw err
        })
        .finally(() => {
          this.inflight = null
        })
    }
    return this.inflight
  }
}
