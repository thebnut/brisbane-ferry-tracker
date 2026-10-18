/**
 * Display lines. TransLink's rail route_short_names are origin-destination codes (BRSP "Brisbane City - Springfield",
 * CASP "Caboolture - Springfield"), so people's "lines" (Springfield line, Ipswich/Rosewood line) are derived here
 * from where a pattern is heading: its headsign when that is a line terminus, otherwise the outer end of the route.
 */

/** Places that name a line (outer termini and their route-name forms). */
const LINE_OF_PLACE: Record<string, string> = {
  airport: 'Airport',
  'domestic airport': 'Airport',
  'international airport': 'Airport',
  beenleigh: 'Beenleigh',
  'varsity lakes': 'Gold Coast',
  caboolture: 'Caboolture',
  nambour: 'Sunshine Coast',
  'gympie north': 'Sunshine Coast',
  cleveland: 'Cleveland',
  doomben: 'Doomben',
  'ferny grove': 'Ferny Grove',
  ipswich: 'Ipswich/Rosewood',
  rosewood: 'Ipswich/Rosewood',
  'redcliffe peninsula': 'Redcliffe Peninsula',
  'kippa-ring': 'Redcliffe Peninsula',
  shorncliffe: 'Shorncliffe',
  springfield: 'Springfield',
  'springfield central': 'Springfield',
}

/** TransLink's official line colours (route_color), used when a line's routes disagree. */
export const LINE_COLOURS: Record<string, string> = {
  Airport: 'FFC425',
  'Gold Coast': 'FFC425',
  Beenleigh: 'D53E45',
  'Ferny Grove': 'D53E45',
  Caboolture: '27855A',
  'Sunshine Coast': '27855A',
  'Ipswich/Rosewood': '27855A',
  Cleveland: '4778B2',
  Shorncliffe: '4778B2',
  Doomben: '9B60A6',
  'Redcliffe Peninsula': '6CC6E9',
  Springfield: '6CC6E9',
  City: '666D8E',
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s+(railway\s+|train\s+)?station$/, '')
    .trim()

export const lineOfPlace = (place: string): string | null => LINE_OF_PLACE[norm(place)] ?? null

/**
 * The display line of a stopping pattern: the headsign's line when it heads for a line terminus; otherwise the
 * route's destination end (unless that is Brisbane City), then its origin end; "City" for city-only shuttles.
 */
export function lineNameFor(routeLong: string | undefined, headsign: string): string {
  const byHeadsign = lineOfPlace(headsign)
  if (byHeadsign) return byHeadsign
  const [from = '', to = ''] = (routeLong ?? '').split(/\s+-\s+/)
  return lineOfPlace(to) ?? lineOfPlace(from) ?? 'City'
}

/** "Springfield line", "Ipswich/Rosewood line". */
export const lineLabel = (name: string) => (name === 'City' ? 'City trains' : `${name} line`)
