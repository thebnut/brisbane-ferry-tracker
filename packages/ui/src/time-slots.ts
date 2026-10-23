/**
 * "Depart from" slots (legacy src/utils/timeUtils.js generateTimeSlots): from now + 2 h rounded down to the hour, every
 * 2 h until 10 or 11 pm, then tomorrow from 5 am, at most 10 entries including the "Tomorrow" separator.
 * Brisbane has no DST, so wall-clock maths is a fixed +10 h offset.
 */
const OFFSET_S = 10 * 3600
const HOUR = 3600

export type Slot =
  | { type: 'slot'; at: number; label: string; today: boolean }
  | { type: 'separator'; label: string }

const hourLabel = (atS: number) => {
  const h = Math.floor(((atS + OFFSET_S) % 86400) / HOUR)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}${h < 12 ? 'AM' : 'PM'}`
}

export function generateTimeSlots(nowMs: number): Slot[] {
  const nowS = Math.floor(nowMs / 1000)
  const local = nowS + OFFSET_S
  const dayStart = local - (local % 86400) - OFFSET_S // Brisbane midnight today, epoch s
  const start = Math.floor((nowS + 2 * HOUR + OFFSET_S) / HOUR) * HOUR - OFFSET_S
  const startHour = Math.floor(((start + OFFSET_S) % 86400) / HOUR)
  const endHour = startHour % 2 === 0 ? 22 : 23
  const slots: Slot[] = []
  for (
    let t = start;
    t < dayStart + 86400 && Math.floor(((t + OFFSET_S) % 86400) / HOUR) <= endHour;
    t += 2 * HOUR
  ) {
    slots.push({ type: 'slot', at: t, label: hourLabel(t), today: true })
  }
  if (slots.length > 0 && slots.length < 10) slots.push({ type: 'separator', label: 'Tomorrow' })
  for (let t = dayStart + 86400 + 5 * HOUR; slots.length < 10; t += 2 * HOUR) {
    slots.push({ type: 'slot', at: t, label: hourLabel(t), today: false })
  }
  return slots.slice(0, 10)
}
