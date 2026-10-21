/**
 * First-visit onboarding (P4) for train: the stations for the picker and the save into favourites
 * (`bft-train-favourites`, through storage.ts writeFavourites: a station with no destination, as the map picker's
 * Save). Loaded only with the prompt (lazy).
 */
import { applyTray, modeChanged, type TrayItem } from '@bft/ui/onboarding'
import type { ModeSource } from '@bft/ui/onboarding-picker'
import type { PickerStop } from '@bft/ui/stop-picker'
import { STATIONS } from './network.ts'
import { searchStations } from './search.ts'
import { type Favourite, readFavourites, sameFavourite, writeFavourites } from './storage.ts'

const platformsText = (codes: string[]) =>
  codes.length === 0
    ? undefined
    : codes.length === 1
      ? `Platform ${codes[0]}`
      : `Platforms ${codes.join(', ')}`

const STOPS: PickerStop[] = STATIONS.map((s) => ({
  id: s.key,
  name: s.name,
  lat: s.lat,
  lon: s.lon,
  detail: platformsText([...new Set(s.platforms.map((p) => p.code).filter(Boolean))]),
}))
const byKey = new Map(STOPS.map((s) => [s.id, s]))

export const trainHasSaved = (): boolean => readFavourites().length > 0

export const trainSource: ModeSource = {
  mode: 'train',
  label: 'Train',
  title: 'Train stations',
  noun: 'station',
  shape: 'square',
  zoom: 13,
  stops: STOPS,
  search: (q) =>
    searchStations(q, STATIONS, 8)
      .map((s) => byKey.get(s.key))
      .filter((s) => s != null),
}

/** Adds the tray's stations as favourites, in tray order, after any already there. False if they weren't all kept. */
export function saveTrain(items: TrayItem[]): boolean {
  const add: Favourite[] = items.filter((i) => i.mode === 'train').map((i) => ({ from: i.id, to: null }))
  if (add.length === 0) return true
  writeFavourites([...readFavourites(), ...add])
  const kept = readFavourites()
  return add.every((f) => kept.some((x) => sameFavourite(x, f)))
}

/**
 * Re-run from Settings (THE-113): the station favourites, as the tray opens with them. A favourite trip with a
 * destination isn't a stop, so it stays out of the tray and is kept as it is.
 */
export const trainTrayItems = (): TrayItem[] =>
  readFavourites().flatMap((f) => {
    const s = f.to == null ? byKey.get(f.from) : undefined
    return s ? [{ mode: 'train' as const, id: s.id, name: s.name, detail: s.detail }] : []
  })

/**
 * Re-run from Settings: the station favourites become the tray's stations, in tray order (one taken out is unsaved);
 * favourite trips keep their place. Nothing is written when the stations didn't change. False if they weren't all kept.
 */
export function resaveTrain(before: TrayItem[], after: TrayItem[]): boolean {
  if (!modeChanged(before, after, 'train')) return true
  const want = applyTray(
    readFavourites(),
    (f) => (f.to == null && byKey.has(f.from) ? f.from : null),
    after.filter((i) => i.mode === 'train'),
    (i): Favourite => ({ from: i.id, to: null }),
  )
  writeFavourites(want)
  const kept = readFavourites()
  return kept.length === want.length && want.every((f, n) => kept[n] && sameFavourite(kept[n], f))
}
