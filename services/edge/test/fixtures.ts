/**
 * A tiny pipeline output tree (common storage layout) built from @bft/core shapes, plus GTFS-RT builders,
 * a fake upstream and fake DO storage, so the hub and the app run end to end in Node.
 */
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import type { GenerationIndex, Manifest, Mode } from '@bft/core'
import { gtfsToEpoch } from '@bft/core'
import { create, type MessageInitShape, toBinary } from '@bufbuild/protobuf'
import { type SynthTrip, stopDay, tripIndex } from '../../../packages/core/test/helpers.ts'
import { MemoryDataSource } from '../src/data/source.ts'
import { blobKey, indexKey, StaticStore } from '../src/data/static-store.ts'
import { type FeedEntitySchema, FeedMessageSchema } from '../src/gen/gtfs-realtime_pb.js'
import type { HubStorage } from '../src/rt/hub-core.ts'

/** Tuesday 20 Oct 2026 and the day before. */
export const D0 = '20261019'
export const D = '20261020'

export const epoch = (date: string, hms: string) => {
  const [h, m, s] = hms.split(':').map(Number)
  return gtfsToEpoch(date, (h as number) * 3600 + (m as number) * 60 + (s ?? 0))
}

/** Bulimba (317584) → Riverside (317590) style ferry fixtures, with a cross-midnight trip on D0. */
export const TRIPS: Record<string, SynthTrip[]> = {
  [D0]: [
    {
      id: 'LATE',
      route: 'F1-4055',
      headsign: 'Riverside',
      stops: [
        ['317584', '24:40:00'],
        ['317590', '24:55:00'],
      ],
    },
  ],
  [D]: [
    {
      id: 'T1',
      route: 'F1-4055',
      headsign: 'Riverside',
      stops: [
        ['317584', '08:00:00'],
        ['317586', '08:05:00'],
        ['317590', '08:15:00'],
      ],
    },
    {
      id: 'T2',
      route: 'F11-4055',
      headsign: 'Riverside',
      stops: [
        ['317584', '08:10:00'],
        ['317590', '08:20:00'],
      ],
    },
    {
      id: 'T3',
      route: 'F1-4055',
      dir: 1,
      headsign: 'Northshore Hamilton',
      stops: [
        ['317590', '08:30:00'],
        ['317584', '08:45:00'],
      ],
    },
  ],
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

export interface Tree {
  source: MemoryDataSource
  generation: string
  /** Replace the tree with a new generation (trip IDs rotate), writing the manifest last. */
  publish(generation: string, trips?: Record<string, SynthTrip[]>): void
}

export function buildTree(generation = 'g1', trips = TRIPS, mode: Mode = 'ferry'): Tree {
  const source = new MemoryDataSource()
  const put = (key: string, value: unknown, gz = false) => {
    const text = JSON.stringify(value)
    source.files.set(key, gz ? new Uint8Array(gzipSync(text)) : new TextEncoder().encode(text))
  }
  const tree: Tree = {
    source,
    generation,
    publish(gen, t = trips) {
      const dates = Object.keys(t).sort()
      const index: GenerationIndex = {
        schemaVersion: 1,
        generation: gen,
        mode,
        feedVersion: 'fv',
        builtAt: '2026-10-19T17:15:00Z',
        serviceDates: dates,
        blobs: {},
        tripIndex: {},
      }
      for (const date of dates) {
        const dayTrips = t[date] as SynthTrip[]
        const stopIds = [...new Set(dayTrips.flatMap((x) => x.stops.map((s) => s[0])))]
        index.blobs[date] = {}
        for (const s of stopIds) {
          const bytes = new Uint8Array(gzipSync(JSON.stringify(stopDay(date, s, dayTrips))))
          const h = sha(bytes)
          source.files.set(blobKey(h), bytes)
          ;(index.blobs[date] as Record<string, string>)[s] = h
        }
        const ti = new Uint8Array(gzipSync(JSON.stringify(tripIndex(date, dayTrips, gen))))
        const th = sha(ti)
        source.files.set(blobKey(th), ti)
        ;(index.tripIndex as Record<string, string>)[date] = th
      }
      put(indexKey(gen, mode), index)
      const manifest: Manifest = {
        schemaVersion: 1,
        updatedAt: '2026-10-19T17:20:00Z',
        modes: { [mode]: { current: gen, previous: tree.generation, serviceDates: dates } },
        quarantined: [],
      }
      put('manifest.json', manifest)
      tree.generation = gen
    },
  }
  tree.publish(generation)
  put('legacy/latest.json', { generated: '2026-10-19T17:20:00Z', departures: [] })
  // Stop index: every stop the trips use, plus one stop with no service (a known key that returns no rows).
  const ids = [...new Set(Object.values(trips).flatMap((ts) => ts.flatMap((t) => t.stops.map((x) => x[0]))))]
  const entry = (key: string) => ({ key, name: `${key} ferry terminal`, lat: -27.4, lon: 153, routes: [] })
  put(`data/${mode}/stops.json`, {
    schemaVersion: 1,
    mode,
    generation,
    stops: [...ids, 'QUIET'].map(entry),
  })
  return tree
}

export const storeFor = (tree: Tree, now?: () => number) =>
  new StaticStore(tree.source, { validate: true, manifestMaxAgeMs: 0, now })

// ------------------------------------------------------------------ GTFS-RT

type EntityInit = MessageInitShape<typeof FeedEntitySchema>

export function feed(timestamp: number, entities: EntityInit[]): Uint8Array {
  return toBinary(
    FeedMessageSchema,
    create(FeedMessageSchema, {
      header: { gtfsRealtimeVersion: '2.0', timestamp: BigInt(timestamp) },
      entity: entities,
    }),
  )
}

export const tripUpdate = (
  id: string,
  trip: {
    tripId?: string
    startDate?: string
    startTime?: string
    routeId?: string
    scheduleRelationship?: number
  },
  stus: Array<{
    seq?: number
    stopId?: string
    arrTime?: number
    depTime?: number
    arrDelay?: number
    depDelay?: number
    rel?: number
  }>,
  vehicleId?: string,
): EntityInit => ({
  id,
  tripUpdate: {
    trip,
    ...(vehicleId ? { vehicle: { id: vehicleId } } : {}),
    stopTimeUpdate: stus.map((u) => ({
      ...(u.seq != null ? { stopSequence: u.seq } : {}),
      ...(u.stopId ? { stopId: u.stopId } : {}),
      ...(u.rel != null ? { scheduleRelationship: u.rel } : {}),
      ...(u.arrTime != null || u.arrDelay != null
        ? {
            arrival: {
              ...(u.arrTime != null ? { time: BigInt(u.arrTime) } : {}),
              ...(u.arrDelay != null ? { delay: u.arrDelay } : {}),
            },
          }
        : {}),
      ...(u.depTime != null || u.depDelay != null
        ? {
            departure: {
              ...(u.depTime != null ? { time: BigInt(u.depTime) } : {}),
              ...(u.depDelay != null ? { delay: u.depDelay } : {}),
            },
          }
        : {}),
    })),
  },
})

export const vehicle = (
  id: string,
  tripId: string,
  startDate: string,
  lat: number,
  lon: number,
): EntityInit => ({
  id,
  vehicle: {
    trip: { tripId, startDate },
    vehicle: { id, label: id },
    position: { latitude: lat, longitude: lon },
  },
})

export const alert = (id: string, header: string, routeId?: string): EntityInit => ({
  id,
  alert: {
    headerText: { translation: [{ text: header, language: 'en' }] },
    informedEntity:
      routeId === undefined
        ? [{ agencyId: 'TL' }]
        : [{ routeId, ...(routeId.startsWith('F') ? { routeType: 4 } : {}) }],
  },
})

/** A fake TransLink: per-path bodies, ETags, call log, optional hang or failure. */
export class FakeUpstream {
  readonly calls: Array<{ path: string; ifNoneMatch: string | null }> = []
  readonly bodies = new Map<string, Uint8Array>()
  hang = new Set<string>()
  fail = new Set<string>()
  private etags = new Map<string, number>()

  set(path: string, body: Uint8Array): void {
    this.bodies.set(path, body)
    this.etags.set(path, (this.etags.get(path) ?? 0) + 1)
  }

  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    const path = url.replace(/^.*\/SEQ\//, '')
    const inm = new Headers(init?.headers).get('if-none-match')
    this.calls.push({ path, ifNoneMatch: inm })
    if (this.hang.has(path)) {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('The operation was aborted due to timeout')),
        )
      })
    }
    if (this.fail.has(path)) return new Response('boom', { status: 502 })
    const body = this.bodies.get(path)
    if (!body) return new Response('not found', { status: 404 })
    const etag = `"${path}-${this.etags.get(path)}"`
    if (inm === etag) return new Response(null, { status: 304, headers: { etag } })
    return new Response(body as unknown as ArrayBuffer, { headers: { etag } })
  }
}

/** DO storage stand-in with an alarm slot and an event log (to check re-arm ordering). */
export class FakeStorage implements HubStorage {
  readonly data = new Map<string, unknown>()
  alarmAt: number | null = null
  readonly events: string[] = []

  async get<T>(key: string): Promise<T | undefined> {
    return structuredClone(this.data.get(key)) as T | undefined
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    this.events.push(`put:${Object.keys(entries).length}`)
    for (const [k, v] of Object.entries(entries)) this.data.set(k, structuredClone(v))
  }
  async delete(keys: string[]): Promise<number> {
    let n = 0
    for (const k of keys) if (this.data.delete(k)) n++
    return n
  }
  async getAlarm(): Promise<number | null> {
    return this.alarmAt
  }
  async setAlarm(t: number): Promise<void> {
    this.events.push('setAlarm')
    this.alarmAt = t
  }
  async deleteAlarm(): Promise<void> {
    this.alarmAt = null
  }
}

export class Clock {
  constructor(public t: number) {}
  now = () => this.t
  advance(ms: number): void {
    this.t += ms
  }
}
