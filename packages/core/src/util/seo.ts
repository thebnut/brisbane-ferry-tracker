/**
 * Snippet lengths for page titles and meta descriptions, shared by the mode apps' seo.ts. Search engines show about
 * 50–60 characters of a title and 150–160 of a description; longer ones are cut mid-word. Each page offers its
 * candidates longest-first and keeps the first that fits, so useful place names stay and the trimmings go.
 */

/** BrisbaneTransit's site name in og:site_name, JSON-LD and title suffixes on its pages. */
export const TRANSIT_SITE_NAME = 'Brisbane Transit'

export const TITLE_MAX = 60
export const DESCRIPTION_MAX = 160

/** The first candidate of at most `max` characters, else the shortest candidate. */
export function fitText(max: number, ...candidates: string[]): string {
  const fit = candidates.find((c) => c.length <= max)
  if (fit !== undefined) return fit
  return candidates.reduce((a, b) => (b.length < a.length ? b : a), candidates[0] ?? '')
}

export const fitTitle = (...candidates: string[]) => fitText(TITLE_MAX, ...candidates)
export const fitDescription = (...candidates: string[]) => fitText(DESCRIPTION_MAX, ...candidates)

/** "a", "a and b", "a, b and c". */
export const listText = (items: readonly string[]) =>
  items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`

/**
 * A data file's generation from the start of its raw text (`{"schemaVersion":1,"mode":"bus","generation":"…"`), without
 * parsing the whole file. Null when it isn't there.
 */
export function generationOfText(text: string): string | null {
  return /"generation":"([^"\\]{1,200})"/.exec(text.slice(0, 512))?.[1] ?? null
}

/**
 * The sitemap `<lastmod>` for pages built from a data generation: the GTFS feed's start date, the first part of the
 * generation (`20261110-20270109-a0e837e2-…`, pipeline feedVersionOf), as YYYY-MM-DD. The stop names, routes and
 * timetables on those pages change only with a new feed. Null unless it is a real calendar date no later than `today`
 * (YYYY-MM-DD): no invented or future dates.
 */
export function feedDate(generation: string | null | undefined, today: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})-/.exec(generation ?? '')
  if (!m) return null
  const [, y, mo, d] = m
  const date = `${y}-${mo}-${d}`
  const t = Date.UTC(Number(y), Number(mo) - 1, Number(d))
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== date) return null
  return date <= today ? date : null
}
