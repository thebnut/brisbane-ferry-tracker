/**
 * The busiest places in each mode, linked from the landing page (real links in its server HTML, for people and
 * crawlers) and named in /llms.txt. Names are written out so the landing page doesn't load the modes' data files;
 * test/popular.test.ts checks every key against them.
 */
import { MODE_BASES } from './modes.ts'

export interface PopularPlace {
  href: string
  name: string
}

/** Ferry terminal slugs (apps/ferry/app/data/terminals.json). */
export const POPULAR_TERMINALS: readonly (readonly [slug: string, name: string])[] = [
  ['south-bank', 'South Bank'],
  ['riverside', 'Riverside'],
  ['new-farm-park', 'New Farm Park'],
  ['howard-smith-wharves', 'Howard Smith Wharves'],
  ['northshore-hamilton', 'Northshore Hamilton'],
  ['bulimba', 'Bulimba'],
  ['qut-gardens-point', 'QUT Gardens Point'],
  ['uq-st-lucia', 'UQ St Lucia'],
]

/** Train station keys (apps/train/app/data/network.json), as the train home's popular stations. */
export const POPULAR_STATIONS: readonly (readonly [key: string, name: string])[] = [
  ['central', 'Central'],
  ['roma-street', 'Roma Street'],
  ['fortitude-valley', 'Fortitude Valley'],
  ['bowen-hills', 'Bowen Hills'],
  ['south-brisbane', 'South Brisbane'],
  ['domestic-airport', 'Domestic Airport'],
]

/** Bus stop_ids, as the bus home's busy stops. */
export const POPULAR_STOPS: readonly (readonly [id: string, name: string])[] = [
  ['10802', 'Cultural Centre station, platform 1'],
  ['10780', 'King George Square, 2a'],
  ['19051', 'Mater Hill station, platform 1'],
  ['37', 'Adelaide Street Stop 37 near Anzac Square'],
]

export const POPULAR: { ferry: PopularPlace[]; train: PopularPlace[]; bus: PopularPlace[] } = {
  ferry: POPULAR_TERMINALS.map(([slug, name]) => ({ href: `${MODE_BASES.ferry}/terminal/${slug}`, name })),
  train: POPULAR_STATIONS.map(([key, name]) => ({ href: `${MODE_BASES.train}/station/${key}`, name })),
  bus: POPULAR_STOPS.map(([id, name]) => ({ href: `${MODE_BASES.bus}/stop/${id}`, name })),
}
