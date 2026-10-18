/**
 * Service-day time arithmetic in Australia/Brisbane (ADR-0007). Never uses the device timezone.
 *
 * GTFS times are "noon minus 12h" offsets from the service date and can exceed 24:00:00. A trip at 25:10
 * on service date D departs at 01:10 on D+1. Brisbane has no DST, but we still resolve through the tz
 * database rather than hard-coding +10, so a future rule change cannot silently shift every time.
 */
import { TZDate } from '@date-fns/tz'

export const TIMEZONE = 'Australia/Brisbane'

/** Parse a GTFS HH:MM:SS (HH may be >= 24) into seconds. Returns null for empty or malformed input. */
export function gtfsTimeToSeconds(t: string | undefined | null): number | null {
  if (!t) return null
  const m = /^\s*(\d{1,3}):(\d{2}):(\d{2})\s*$/.exec(t)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

export function secondsToGtfsTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const dayStartCache = new Map<string, number>()

/**
 * Epoch seconds of "noon minus 12h" on a service date (YYYYMMDD) in Brisbane.
 * Memoised per date: merges call this for every stop event, and building a TZDate each time cost ~12 µs per call,
 * which alone blew the Workers Free 10 ms CPU budget for a busy stop.
 */
export function serviceDayStartEpoch(serviceDate: string): number {
  const hit = dayStartCache.get(serviceDate)
  if (hit !== undefined) return hit
  const v = computeServiceDayStart(serviceDate)
  if (dayStartCache.size > 64) dayStartCache.clear()
  dayStartCache.set(serviceDate, v)
  return v
}

function computeServiceDayStart(serviceDate: string): number {
  const y = Number(serviceDate.slice(0, 4))
  const mo = Number(serviceDate.slice(4, 6)) - 1
  const d = Number(serviceDate.slice(6, 8))
  // Noon is never in a DST gap; subtracting 12h gives the GTFS reference even on transition days.
  const noon = new TZDate(y, mo, d, 12, 0, 0, TIMEZONE)
  return Math.floor(noon.getTime() / 1000) - 12 * 3600
}

/** Epoch seconds for a GTFS time offset on a service date. */
export function gtfsToEpoch(serviceDate: string, seconds: number): number {
  return serviceDayStartEpoch(serviceDate) + seconds
}

/** The Brisbane calendar date (YYYYMMDD) of an epoch-ms instant. */
export function brisbaneDate(epochMs: number): string {
  const z = new TZDate(epochMs, TIMEZONE)
  return `${z.getFullYear()}${String(z.getMonth() + 1).padStart(2, '0')}${String(z.getDate()).padStart(2, '0')}`
}

/** Seconds since Brisbane midnight for an epoch-ms instant. */
export function brisbaneSecondsOfDay(epochMs: number): number {
  const z = new TZDate(epochMs, TIMEZONE)
  return z.getHours() * 3600 + z.getMinutes() * 60 + z.getSeconds()
}

export function addDays(serviceDate: string, days: number): string {
  const y = Number(serviceDate.slice(0, 4))
  const mo = Number(serviceDate.slice(4, 6)) - 1
  const d = Number(serviceDate.slice(6, 8))
  const dt = new Date(Date.UTC(y, mo, d + days))
  return `${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`
}

/** 0 = Sunday ... 6 = Saturday, for a YYYYMMDD date. */
export function dayOfWeek(serviceDate: string): number {
  const y = Number(serviceDate.slice(0, 4))
  const mo = Number(serviceDate.slice(4, 6)) - 1
  const d = Number(serviceDate.slice(6, 8))
  return new Date(Date.UTC(y, mo, d)).getUTCDay()
}

/**
 * Service dates whose trips can still be departing at `epochMs`. GTFS times run up to about 30:00, so a query
 * at 00:30 must also look at yesterday's service day (Codex finding 6). Returns [yesterday, today] in order.
 */
export function overlappingServiceDates(epochMs: number, maxGtfsHours = 30): string[] {
  const today = brisbaneDate(epochMs)
  const secs = brisbaneSecondsOfDay(epochMs)
  const out: string[] = []
  if (secs + 24 * 3600 < maxGtfsHours * 3600) out.push(addDays(today, -1))
  out.push(today)
  return out
}

/** The "current" service date for display: before 03:00 Brisbane, yesterday's service day is still running. */
export function currentServiceDate(epochMs: number, rolloverHour = 3): string {
  const today = brisbaneDate(epochMs)
  return brisbaneSecondsOfDay(epochMs) < rolloverHour * 3600 ? addDays(today, -1) : today
}
