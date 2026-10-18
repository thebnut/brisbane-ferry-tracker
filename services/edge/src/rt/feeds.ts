/**
 * TransLink GTFS-RT feed layout. Combined feeds cover every mode; per-mode feeds are much smaller
 * (Saturday midday: combined TripUpdates 1.1 MB decoded vs Ferry 17 KB, Rail 100 KB), which matters on the
 * Workers Free plan's 10 ms CPU budget. Alerts are only published combined.
 */
import type { Mode } from '@bft/core'

export const MODES: readonly Mode[] = ['ferry', 'train', 'bus', 'tram']

export const FEED_MODE_SUFFIX: Record<Mode, string> = {
  ferry: 'Ferry',
  train: 'Rail',
  bus: 'Bus',
  tram: 'Tram',
}

export type FeedKind = 'TripUpdates' | 'VehiclePositions' | 'alerts'

export interface FeedSpec {
  /** Path below RT_UPSTREAM and the key the raw bytes are stored under, e.g. `TripUpdates/Ferry`. */
  key: string
  kind: FeedKind
  /** The mode a per-mode feed covers; undefined for combined feeds. */
  mode?: Mode
}

export interface RtConfig {
  /** Modes whose feeds are polled and published. */
  modes: Mode[]
  /** True: poll the combined feeds (all modes). False: one feed per polled mode. */
  combined: boolean
  /** Modes whose trip indexes the hub loads and matches against (a subset of `modes`). */
  indexModes: Mode[]
}

const parseModeList = (v: string): Mode[] =>
  [...new Set(v.split(',').map((s) => s.trim().toLowerCase()))].filter((s): s is Mode =>
    (MODES as readonly string[]).includes(s),
  )

/**
 * `RT_MODES=all` polls the combined feeds; `ferry,train` polls those per-mode feeds.
 * `RT_INDEX_MODES` picks which modes get trip indexes. It defaults to every polled mode except bus. With the
 * compact matcher, two days of bus take ~18 MB and fit the DO, but a bus poll costs ~140 ms CPU (staging), which
 * needs Workers Paid: set RT_INDEX_MODES=ferry,train,bus (and poll bus) once Paid is active.
 */
export function parseRtModes(value: string | undefined, indexModes?: string): RtConfig {
  const v = (value ?? 'ferry,train').trim().toLowerCase()
  const combined = v === 'all'
  const modes = combined ? [...MODES] : parseModeList(v)
  if (modes.length === 0) throw new Error(`RT_MODES has no known mode: ${value}`)
  const idx = indexModes
    ? parseModeList(indexModes).filter((m) => modes.includes(m))
    : modes.filter((m) => m !== 'bus')
  return { modes, combined, indexModes: idx }
}

export function feedsFor(cfg: RtConfig): FeedSpec[] {
  const out: FeedSpec[] = []
  for (const kind of ['TripUpdates', 'VehiclePositions'] as const) {
    if (cfg.combined) out.push({ key: kind, kind })
    else for (const mode of cfg.modes) out.push({ key: `${kind}/${FEED_MODE_SUFFIX[mode]}`, kind, mode })
  }
  out.push({ key: 'alerts', kind: 'alerts' })
  return out
}

/** GTFS route_type → mode (alerts' informed entities carry route_type). */
export function modeForRouteType(t: number): Mode | undefined {
  switch (t) {
    case 0:
    case 900:
      return 'tram'
    case 2:
    case 100:
    case 109:
      return 'train'
    case 3:
    case 700:
      return 'bus'
    case 4:
    case 1000:
    case 1200:
      return 'ferry'
    default:
      return undefined
  }
}
