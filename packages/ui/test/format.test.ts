import { describe, expect, it } from 'vitest'
import {
  countdownTone,
  dayMarker,
  delayText,
  formatAge,
  formatClock,
  formatCountdown,
  formatDistance,
  formatDuration,
  minutesUntil,
  statusNote,
  vesselName,
} from '../src/format.ts'

// 2026-10-18 19:38:00 Brisbane (UTC+10) = 09:38 UTC
const NOW = Date.UTC(2026, 9, 18, 9, 38, 0)
const at = (h: number, m: number, dayOffset = 0) => Date.UTC(2026, 9, 18 + dayOffset, h - 10, m) / 1000

describe('countdown rules', () => {
  it('truncates minutes toward zero like differenceInMinutes', () => {
    expect(minutesUntil(NOW / 1000 + 59, NOW)).toBe(0)
    expect(minutesUntil(NOW / 1000 + 61, NOW)).toBe(1)
    expect(minutesUntil(NOW / 1000 - 30, NOW)).toBe(0)
  })
  it('bands: <1 departing, ≤5 soon, ≤15 near, later', () => {
    expect(countdownTone(0)).toBe('departing')
    expect(countdownTone(-1)).toBe('departing')
    expect(countdownTone(1)).toBe('soon')
    expect(countdownTone(5)).toBe('soon')
    expect(countdownTone(6)).toBe('near')
    expect(countdownTone(15)).toBe('near')
    expect(countdownTone(16)).toBe('later')
  })
  it('text: Departing, in 1 min, in N mins, none over an hour', () => {
    expect(formatCountdown(0)).toBe('Departing')
    expect(formatCountdown(1)).toBe('in 1 min')
    expect(formatCountdown(4)).toBe('in 4 mins')
    expect(formatCountdown(60)).toBe('in 60 mins')
    expect(formatCountdown(61)).toBeNull()
  })
})

describe('durations', () => {
  it('formats minutes and hours like the legacy modal', () => {
    expect(formatDuration(1)).toBe('1 min')
    expect(formatDuration(12)).toBe('12 mins')
    expect(formatDuration(60)).toBe('1 hr')
    expect(formatDuration(120)).toBe('2 hrs')
    expect(formatDuration(88)).toBe('1 hr 28 mins')
    expect(formatDuration(61)).toBe('1 hr 1 min')
  })
})

describe('clock and next-day marker', () => {
  it('shows Brisbane time regardless of device zone', () => {
    expect(formatClock(at(19, 42))).toBe('7:42 pm')
    expect(formatClock(at(5, 5))).toBe('5:05 am')
  })
  it('marks a later Brisbane calendar day as (DD/MM)', () => {
    expect(dayMarker(at(23, 59), NOW)).toBeNull()
    expect(dayMarker(at(0, 10, 1), NOW)).toBe('(19/10)')
  })
  it('uses the Brisbane date, not UTC: 9:30 am Brisbane is the previous UTC day', () => {
    const early = Date.UTC(2026, 9, 18, 23, 30) // 09:30 on 19 Oct Brisbane
    expect(dayMarker(at(9, 40, 1), early)).toBeNull()
  })
})

describe('status line', () => {
  it('follows the legacy priority', () => {
    expect(statusNote(false, at(19, 42), null)).toBeNull()
    expect(statusNote(true, at(19, 42), at(19, 42) + 20)).toBe('Sched Dept: 7:42 pm')
    expect(statusNote(true, at(19, 46), at(19, 49))).toBe('Scheduled: 7:46 pm')
    expect(statusNote(true, at(19, 46), null)).toBe('Sched Dept: 7:46 pm')
  })
  it('delay text', () => {
    expect(delayText(at(19, 46), at(19, 49))).toBe('3 min late')
    expect(delayText(at(19, 46), at(19, 44))).toBe('2 min early')
    expect(delayText(at(19, 46), at(19, 46) + 20)).toBeNull()
    expect(delayText(at(19, 46), null)).toBeNull()
  })
  it('age', () => {
    expect(formatAge(NOW / 1000 - 12, NOW)).toBe('updated 12 s ago')
    expect(formatAge(NOW / 1000 - 180, NOW)).toBe('updated 3 min ago')
    expect(formatAge(null, NOW)).toBeNull()
  })
  it('vessel names keep Roman numerals', () => {
    expect(vesselName('a1b2_MOOROOLBIN II')).toBe('Mooroolbin II')
    expect(vesselName('x_neville bonner')).toBe('Neville Bonner')
    expect(vesselName('1234')).toBeNull()
  })
})

describe('formatDistance', () => {
  it('rounds to 10 m under a kilometre, else one decimal km', () => {
    expect(formatDistance(4)).toBe('10 m')
    expect(formatDistance(123)).toBe('120 m')
    expect(formatDistance(1890)).toBe('1.9 km')
  })
})
