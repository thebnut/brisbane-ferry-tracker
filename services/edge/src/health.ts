/**
 * The realtime freshness rule shared by /v1/health and the watchdog cron, so they agree on what "stale" means.
 */
import type { HealthReason } from '@bft/core'
import type { Logger } from './log.ts'
import type { HubStatus } from './rt/hub-core.ts'

/** Health is ok only while TransLink's header time (ageS) and the hub's last build (buildAgeS) are this fresh. */
export const HEALTH_MAX_AGE_S = 120

export type { HealthReason }

export interface RtAges {
  /** Now minus TransLink's header time behind the snapshot (s), or null when there is none. */
  ageS: number | null
  /** Now minus when the hub built that snapshot (s), or null. */
  buildAgeS: number | null
}

export function rtAges(
  h: { sourceTimestamp: number | null; fetchedAt: number | null } | null | undefined,
  nowMs: number,
): RtAges {
  return {
    ageS: h?.sourceTimestamp != null ? Math.round((nowMs - h.sourceTimestamp * 1000) / 100) / 10 : null,
    buildAgeS: h?.fetchedAt != null ? (nowMs - h.fetchedAt) / 1000 : null,
  }
}

/** The reasons a check fails, in a fixed order; empty when healthy. */
export function healthReasons(manifestOk: boolean, { ageS, buildAgeS }: RtAges): HealthReason[] {
  const out: HealthReason[] = []
  if (!manifestOk) out.push('manifest')
  if (ageS == null || ageS >= HEALTH_MAX_AGE_S) out.push('source-age')
  if (buildAgeS == null || buildAgeS >= HEALTH_MAX_AGE_S) out.push('build-age')
  return out
}

/**
 * /v1/health's reasons when the isolate has no realtime status at all, even after waiting `waitedMs` for one: a plain
 * `unavailable` rather than `source-age` and `build-age` with no ages (THE-111). The watchdog keeps `healthReasons`.
 */
export function unavailableReasons(manifestOk: boolean): HealthReason[] {
  return manifestOk ? ['unavailable'] : ['manifest', 'unavailable']
}

/**
 * The request log's failure detail: each reason with its age, e.g. `source-age 446s,build-age 130s`, or how long
 * health waited for a status, e.g. `status unavailable (waited 3000ms)`.
 */
export function healthDetail(
  reasons: HealthReason[],
  { ageS, buildAgeS }: RtAges,
  waitedMs?: number,
): string {
  const age = (v: number | null) => (v == null ? 'none' : `${Math.round(v)}s`)
  return reasons
    .map((r) =>
      r === 'source-age'
        ? `${r} ${age(ageS)}`
        : r === 'build-age'
          ? `${r} ${age(buildAgeS)}`
          : r === 'unavailable'
            ? `status unavailable (waited ${Math.round(waitedMs ?? 0)}ms)`
            : r,
    )
    .join(',')
}

/**
 * Watchdog check of the hub status readers see (the published pointer, as /v1/health reads it), after the alarm
 * re-arm: a hub whose cycles run but whose source or build is older than health allows logs `rt stale` every minute
 * until it recovers. That covers an upstream freeze (source-age) and a status that stopped reaching readers (a lost
 * pointer write: build-age), neither of which `lastCycleAt` shows. A failed read is logged as itself.
 */
export async function checkPublished(
  read: () => Promise<HubStatus | null>,
  nowMs: number,
  log: Logger,
  hub?: { sourceTimestamp: number | null; fetchedAt: number | null },
): Promise<HealthReason[] | null> {
  let status: HubStatus | null
  try {
    status = await read()
  } catch (e) {
    log.warn('rt stale check failed', { error: e instanceof Error ? e.message : String(e) })
    return null
  }
  const ages = rtAges(status, nowMs)
  const reasons = healthReasons(true, ages)
  if (reasons.length > 0) {
    log.warn('rt stale', {
      reasons,
      ...ages,
      seq: status?.seq ?? null,
      sourceTimestamp: status?.sourceTimestamp ?? null,
      fetchedAt: status?.fetchedAt ?? null,
      lastError: status?.lastError ?? null,
      // The hub's own view: fresh here but stale above means the status isn't reaching readers.
      ...(hub ? { hubAges: rtAges(hub, nowMs) } : {}),
    })
  }
  return reasons
}
