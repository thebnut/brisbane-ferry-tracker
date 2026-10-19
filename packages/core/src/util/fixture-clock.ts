/**
 * Fixture mode only: `?fixtureNow=<epoch ms>` renders the fixtures at that instant instead of the real clock, so a
 * test (the transit first-load budget) measures the same server HTML at any time of day. Callers read it only when
 * fixture mode is on, which production never allows; an absent or malformed value is the real clock.
 */
export function fixtureNow(
  url: { searchParams: { get(name: string): string | null } },
  realNow: number = Date.now(),
): number {
  const raw = url.searchParams.get('fixtureNow')
  if (raw == null || !/^\d{12,14}$/.test(raw)) return realNow
  return Number(raw)
}
