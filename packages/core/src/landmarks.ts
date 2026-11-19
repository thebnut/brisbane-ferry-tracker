/**
 * Major tourist spots for the journey planners' destination search (ferry and train): a landmark resolves to the stop to
 * get off at ("Get off at Northshore Hamilton for Eat Street"). Only the big ones, not every place in Brisbane; more can
 * be added here. Each entry is its own result row, so a sponsored placement could sit beside them later (none now).
 *
 * Mappings checked 19 Nov 2026 against the bundled ferry terminals (apps/ferry/app/data/terminals.json) and train
 * stations (apps/train/app/data/network.json) by straight-line distance, and against Brisbane City Council and
 * TransLink public information. A stop is listed only when it is a sensible walk (about 600 m or less for a ferry);
 * a landmark with no ferry stop near it says so, and points to the train or bus instead.
 */

export interface Landmark {
  id: string
  /** As shown in search results: "Eat Street Northshore". */
  name: string
  /** In "Get off at … for Eat Street"; defaults to `name`. */
  short?: string
  /** Extra search words (other names people use). */
  keywords: readonly string[]
  /** Ferry terminals (slugs), best first. Empty: not near a ferry. */
  ferry: readonly string[]
  /** Train stations (network.json keys and names), best first. Empty: not near a train. */
  train: ReadonlyArray<{ key: string; name: string }>
  /** One plain sentence when the bus is the better way, e.g. for the Gabba. */
  bus?: string
  /** A short walking note, e.g. "about 10 min walk". */
  walk?: { ferry?: string; train?: string }
}

export const LANDMARKS: readonly Landmark[] = [
  {
    id: 'city-botanic-gardens',
    name: 'City Botanic Gardens',
    short: 'the City Botanic Gardens',
    keywords: ['botanic', 'gardens', 'botanical'],
    ferry: ['qut-gardens-point'],
    train: [{ key: 'central', name: 'Central' }],
    walk: { train: 'about 15 min walk' },
  },
  {
    id: 'south-bank-parklands',
    name: 'South Bank Parklands and the Brisbane sign',
    short: 'South Bank Parklands',
    keywords: [
      'brisbane sign',
      'streets beach',
      'wheel of brisbane',
      'cultural centre',
      'parklands',
      'southbank',
    ],
    ferry: ['south-bank'],
    train: [
      { key: 'south-brisbane', name: 'South Brisbane' },
      { key: 'south-bank', name: 'South Bank' },
    ],
  },
  {
    id: 'howard-smith-wharves',
    name: 'Howard Smith Wharves and Felons Brewing',
    short: 'Felons Brewing',
    keywords: ['felons', 'brewing', 'hsw', 'wharves'],
    ferry: ['howard-smith-wharves'],
    train: [],
  },
  {
    id: 'eat-street',
    name: 'Eat Street Northshore',
    short: 'Eat Street',
    keywords: ['eat street', 'markets', 'northshore', 'hamilton'],
    ferry: ['northshore-hamilton'],
    train: [],
    walk: { ferry: 'about 7 min walk' },
  },
  {
    id: 'new-farm-park',
    name: 'New Farm Park and Brisbane Powerhouse',
    short: 'New Farm Park and the Powerhouse',
    keywords: ['powerhouse', 'new farm'],
    ferry: ['new-farm-park'],
    train: [],
  },
  {
    id: 'story-bridge',
    name: 'Story Bridge',
    short: 'the Story Bridge',
    keywords: ['bridge climb', 'kangaroo point'],
    // Under the north end; Holman Street is at the Kangaroo Point end (a cross-river ferry from Riverside only).
    ferry: ['howard-smith-wharves', 'holman-street'],
    train: [],
  },
  {
    id: 'qut-gardens-point',
    name: 'QUT Gardens Point',
    short: 'QUT',
    keywords: ['qut', 'queensland university of technology', 'uni'],
    ferry: ['qut-gardens-point'],
    train: [{ key: 'central', name: 'Central' }],
    walk: { train: 'about 15 min walk' },
  },
  {
    id: 'uq-st-lucia',
    name: 'University of Queensland, St Lucia',
    short: 'UQ',
    keywords: ['uq', 'uni', 'university', 'st lucia'],
    ferry: ['uq-st-lucia'],
    train: [],
    walk: { ferry: 'about 8 min walk' },
  },
  {
    id: 'suncorp-stadium',
    name: 'Suncorp Stadium',
    keywords: ['lang park', 'stadium', 'footy', 'broncos'],
    ferry: [],
    train: [
      { key: 'milton', name: 'Milton' },
      { key: 'roma-street', name: 'Roma Street' },
    ],
    walk: { train: 'about 8 min walk from Milton, 15 from Roma Street' },
  },
  {
    id: 'the-gabba',
    name: 'The Gabba',
    keywords: ['gabba', 'woolloongabba', 'cricket', 'lions', 'stadium'],
    ferry: [],
    train: [
      { key: 'buranda', name: 'Buranda' },
      { key: 'boggo-road', name: 'Boggo Road' },
    ],
    bus: 'Buses stop at Woolloongabba busway station, next to the ground.',
    walk: { train: 'about 15 min walk' },
  },
]

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

/** The query's words, normalised (case and accents ignored); none for a blank query. */
export const queryWords = (query: string): string[] =>
  norm(query)
    .trim()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)

/** Every query word starts a word of `text` ("how sm" matches "Howard Smith Wharves"). */
export function matchesQuery(words: readonly string[], text: string): boolean {
  const own = norm(text).split(/[^a-z0-9]+/)
  return words.every((part) => own.some((w) => w.startsWith(part)))
}

/** Every query word starts a word of the landmark's name or keywords ("eat st", "felons", "gabba"). */
export function matchLandmarks(query: string, list: readonly Landmark[] = LANDMARKS): Landmark[] {
  const q = queryWords(query)
  if (q.length === 0) return []
  return list.filter((l) => matchesQuery(q, `${l.name} ${l.keywords.join(' ')}`))
}

export const landmarkById = (id: string | null | undefined): Landmark | null =>
  (id && LANDMARKS.find((l) => l.id === id)) || null
