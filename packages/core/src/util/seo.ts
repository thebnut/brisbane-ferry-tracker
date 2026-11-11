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
