/**
 * Active services per date from calendar.txt plus calendar_dates.txt (ADR-0007).
 * Lifted from schedule-processor/process-schedule.js getActiveServiceIds, with string date comparison
 * (no Date objects, so no device-timezone dependency).
 */
import { dayOfWeek } from '../time/index.ts'

export interface CalendarRow {
  service_id: string
  monday: string
  tuesday: string
  wednesday: string
  thursday: string
  friday: string
  saturday: string
  sunday: string
  start_date: string
  end_date: string
}

export interface CalendarDateRow {
  service_id: string
  date: string
  exception_type: string
}

const DAY_FIELDS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

export class ServiceCalendar {
  private readonly calendar: CalendarRow[]
  private readonly exceptions = new Map<string, { added: Set<string>; removed: Set<string> }>()

  constructor(calendar: CalendarRow[], calendarDates: CalendarDateRow[]) {
    this.calendar = calendar
    for (const row of calendarDates) {
      let e = this.exceptions.get(row.date)
      if (!e) {
        e = { added: new Set(), removed: new Set() }
        this.exceptions.set(row.date, e)
      }
      if (row.exception_type === '1') e.added.add(row.service_id)
      else if (row.exception_type === '2') e.removed.add(row.service_id)
    }
  }

  /** Active service_ids on a YYYYMMDD date. */
  activeServices(date: string): Set<string> {
    const field = DAY_FIELDS[dayOfWeek(date)] as (typeof DAY_FIELDS)[number]
    const out = new Set<string>()
    for (const row of this.calendar) {
      if (row.start_date <= date && date <= row.end_date && row[field] === '1') out.add(row.service_id)
    }
    const e = this.exceptions.get(date)
    if (e) {
      for (const s of e.removed) out.delete(s)
      for (const s of e.added) out.add(s)
    }
    return out
  }

  /** True when calendar_dates removes this service on the date (an explained, planned closure). */
  isExplicitlyRemoved(serviceId: string, date: string): boolean {
    return this.exceptions.get(date)?.removed.has(serviceId) ?? false
  }
}
