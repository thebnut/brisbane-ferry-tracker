/**
 * Time formatting shared by every app. Always Brisbane time, never the device timezone.
 * Rules follow the live ferry app (AGENTS.md "Countdown Timer Logic", "Status Display Priority", "Date Display for
 * Tomorrow's Departures") and the round-2 countdown chip spec.
 */
export const TIMEZONE = 'Australia/Brisbane'

const clockFormat = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIMEZONE,
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})
const dateKeyFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE })
const dayMonthFormat = new Intl.DateTimeFormat('en-AU', {
  timeZone: TIMEZONE,
  day: '2-digit',
  month: '2-digit',
})

/** "7:42 pm" (Brisbane). */
export function formatClock(epochS: number): string {
  // Some ICU builds emit a narrow no-break space before am/pm; normalise to a plain space.
  return clockFormat.format(epochS * 1000).replace(/\s/g, ' ')
}

/** Brisbane calendar date, YYYY-MM-DD. */
export function brisbaneDateKey(epochMs: number): string {
  return dateKeyFormat.format(epochMs)
}

/** "(19/10)" when the time falls on a later Brisbane calendar day than `nowMs`, else null. */
export function dayMarker(epochS: number, nowMs: number): string | null {
  if (brisbaneDateKey(epochS * 1000) <= brisbaneDateKey(nowMs)) return null
  return `(${dayMonthFormat.format(epochS * 1000)})`
}

/** Whole minutes until a departure, truncated toward zero like date-fns differenceInMinutes. */
export function minutesUntil(epochS: number, nowMs: number): number {
  return Math.trunc((epochS * 1000 - nowMs) / 60000) + 0
}

export type CountdownTone = 'departing' | 'soon' | 'near' | 'later'

/** Chip colour band: <1 min departing, ≤5 soon, ≤15 near, otherwise later. */
export function countdownTone(mins: number): CountdownTone {
  if (mins < 1) return 'departing'
  if (mins <= 5) return 'soon'
  if (mins <= 15) return 'near'
  return 'later'
}

/** Countdown chip text, or null when the departure is more than an hour away (no chip, the clock time says it). */
export function formatCountdown(mins: number): string | null {
  if (mins > 60) return null
  if (mins < 1) return 'Departing'
  if (mins === 1) return 'in 1 min'
  return `in ${mins} mins`
}

/**
 * Bus board countdown (B-Departures): "Now" under a minute, "4 min" up to an hour, then null (the clock time is the
 * hero instead).
 */
export function formatBusCountdown(mins: number): string | null {
  if (mins > 60) return null
  if (mins < 1) return 'Now'
  return `${mins} min`
}

/** Durations: "12 mins", "1 min", "1 hr", "2 hrs", "1 hr 28 mins". */
export function formatDuration(totalMins: number): string {
  const m = Math.max(0, Math.round(totalMins))
  if (m < 60) return `${m} min${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60)
  const rest = m % 60
  const hrs = `${h} hr${h > 1 ? 's' : ''}`
  return rest === 0 ? hrs : `${hrs} ${rest} min${rest > 1 ? 's' : ''}`
}

/** "in 1 hr 28 mins" style relative time with no 60-minute cut-off (detail views). */
export function formatRelative(mins: number): string {
  if (mins < 1) return 'now'
  return `in ${formatDuration(mins)}`
}

/**
 * The status line under a live departure (AGENTS.md "Status Display Priority"):
 *  - scheduled only: null
 *  - live and at least a minute off schedule: "Scheduled: 7:46 pm"
 *  - live and on time: "Sched Dept: 7:42 pm"
 */
export function statusNote(live: boolean, schedDepS: number, estDepS: number | null): string | null {
  if (!live) return null
  if (estDepS != null && Math.abs(estDepS - schedDepS) >= 60) return `Scheduled: ${formatClock(schedDepS)}`
  return `Sched Dept: ${formatClock(schedDepS)}`
}

/** "+3 min late" / "2 min early" / null when within a minute. */
export function delayText(schedDepS: number, estDepS: number | null): string | null {
  if (estDepS == null) return null
  const d = Math.round((estDepS - schedDepS) / 60)
  if (d >= 1) return `${d} min late`
  if (d <= -1) return `${-d} min early`
  return null
}

/** "updated 12 s ago" / "updated 3 min ago" from an epoch-seconds source timestamp. */
export function formatAge(sourceS: number | null, nowMs: number): string | null {
  if (sourceS == null) return null
  const s = Math.max(0, Math.round(nowMs / 1000 - sourceS))
  if (s < 60) return `updated ${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `updated ${m} min ago`
  return `updated ${formatDuration(m)} ago`
}

/** Vessel name from a GTFS-RT vehicle id ("abc_MOOROOLBIN II" → "Mooroolbin II"). */
export function vesselName(vehicleId: string | null | undefined): string | null {
  if (!vehicleId) return null
  const parts = vehicleId.split('_')
  if (parts.length < 2) return null
  const name = parts[parts.length - 1] as string
  return name
    .split(' ')
    .map((w) =>
      /^[IVX]+$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join(' ')
}

/** "120 m", "1.9 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`
  return `${(m / 1000).toFixed(1)} km`
}
