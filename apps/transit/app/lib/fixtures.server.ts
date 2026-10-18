/**
 * Fixture mode for BrisbaneTransit: each mode's recorded weekday answers come from that standalone app's own fixture
 * API (so a mode tab shows exactly what the standalone app shows in fixture mode), plus what only transit needs:
 *  - /v1/alerts without a mode: the three apps' fixture alerts merged
 *  - /data/ferry/* and /data/train/*: stop index and geo tiles built from the apps' bundled stop lists (the bus app
 *    serves its own /data/bus/*)
 *  - POST /v1/ask: canned answers for the Ask box, with every ai.reason reachable ("#reason:capacity" in the question)
 */
import { handleFixtureApi as busFixtures } from '@bft/bus/app/lib/fixtures.server.ts'
import { type Alert, AlertsResponse, type GeoTileFile, type Mode, SCHEMA_VERSION } from '@bft/core/contract'
import { geohashEncode } from '@bft/core/geo'
import ferryTerminals from '@bft/ferry/app/data/terminals.json'
import { handleFixtureApi as ferryFixtures } from '@bft/ferry/app/lib/fixtures.server.ts'
import trainStops from '@bft/train/app/data/stops.json'
import { handleFixtureApi as trainFixtures } from '@bft/train/app/lib/fixtures.server.ts'

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } })

const FIXTURE_GENERATION = 'fixture-transit'

interface IndexStop {
  key: string
  name: string
  code?: string
  lat: number
  lon: number
  routes: string[]
}

const STOPS: Record<'ferry' | 'train', IndexStop[]> = {
  ferry: ferryTerminals.map((t) => ({
    key: t.id,
    name: `${t.name} ferry terminal`,
    code: t.id,
    lat: t.lat,
    lon: t.lng,
    routes: t.routes,
  })),
  train: trainStops.stops.map((s) => ({
    key: s.key,
    name: s.name,
    lat: s.lat,
    lon: s.lon,
    routes: s.routes,
  })),
}

/** The /data files for ferry and train in fixture mode, from the stop lists the apps already bundle. */
export function fixtureData(path: string): Response | null {
  const m = /^\/data\/(ferry|train)\/(stops\.json|geo\/([0-9b-hjkmnp-z]{5})\.json)$/.exec(path)
  if (!m) return null
  const mode = m[1] as 'ferry' | 'train'
  const base = { schemaVersion: SCHEMA_VERSION, mode, generation: FIXTURE_GENERATION }
  if (!m[3]) return json({ ...base, stops: STOPS[mode] })
  const stops = STOPS[mode]
    .filter((s) => geohashEncode(s.lat, s.lon, 5) === m[3])
    .map(({ key, name, code, lat, lon }) => (code ? { key, name, code, lat, lon } : { key, name, lat, lon }))
  // An empty cell is an empty tile, as the API answers it (X2).
  return json({ ...base, geohash: m[3], stops } satisfies GeoTileFile)
}

const modeOfPath = (path: string, url: URL): Mode | null => {
  const m = /^\/(?:v1|data)\/(ferry|train|bus)\//.exec(path)
  if (m) return m[1] as Mode
  const q = url.searchParams.get('mode')
  return q === 'ferry' || q === 'train' || q === 'bus' ? q : null
}

async function mergedAlerts(url: URL, nowMs: number, env: Env | null): Promise<Response> {
  const parts = await Promise.all(
    (['ferry', 'train', 'bus'] as const).map(async (mode) => {
      const u = new URL(url)
      u.searchParams.set('mode', mode)
      const res = await dispatch(mode, u, nowMs, env)
      const body = AlertsResponse.safeParse(await res.json())
      if (!body.success) return { body: null, alerts: [] as Alert[] }
      // The apps' fixture alerts are written for their own mode; tag them so the mode chips can filter.
      const alerts = body.data.alerts.map((a) => (a.modes.length ? a : { ...a, modes: [mode] }))
      return { body: body.data, alerts }
    }),
  )
  const first = parts.find((p) => p.body)?.body
  if (!first) return json({ error: 'fixtures_unavailable' }, 500)
  const seen = new Set<string>()
  const alerts = parts.flatMap((p) => p.alerts).filter((a) => !seen.has(a.id) && seen.add(a.id))
  return json(AlertsResponse.parse({ ...first, alerts }))
}

function dispatch(mode: Mode, url: URL, nowMs: number, env: Env | null): Promise<Response> {
  if (mode === 'ferry') return ferryFixtures(url, nowMs)
  if (mode === 'train') return trainFixtures(url, nowMs)
  return busFixtures(url, nowMs, env)
}

/** Canned /v1/ask answers. "#reason:<code>" anywhere in the question returns that ai.reason (UI tests). */
export function fixtureAsk(question: string): Response {
  const q = question.slice(0, 300)
  const base = { schemaVersion: 1, question: q, normalized: q.toLowerCase().trim() }
  if (/#429\b/.test(q)) return json({ error: 'rate_limited' }, 429)
  const forced = /#reason:([a-z_0-9]+)/.exec(q)?.[1]
  if (forced)
    return json(
      {
        ...base,
        source: 'fallback',
        answer: 'Try: "next train from Bowen Hills to the airport" or "departures at Bulimba ferry".',
        ai: { enabled: true, reason: forced },
      },
      forced === 'turnstile_failed' ? 403 : 200,
    )
  if (/ferry|bulimba/i.test(q))
    return json({
      ...base,
      source: 'deterministic',
      answer:
        'From Bulimba ferry terminal: F11 to Riverside in 4 min (7:42 pm) (live); F1 to UQ St Lucia in 11 min.',
      departures: [
        {
          tripInstance: 'fx-f11@20261020',
          route: 'F11',
          headsign: 'Riverside',
          platform: null,
          departs: '7:42 pm',
          inMinutes: 4,
          arrives: '7:54 pm',
          status: 'live',
        },
        {
          tripInstance: 'fx-f1@20261020',
          route: 'F1',
          headsign: 'UQ St Lucia',
          platform: null,
          departs: '7:49 pm',
          inMinutes: 11,
          arrives: null,
          status: 'scheduled',
        },
      ],
    })
  return json({
    ...base,
    source: 'llm',
    answer:
      'From Bowen Hills station to Domestic Airport station: BRAP to Domestic Airport at 7:58 pm, platform 2.',
    departures: [
      {
        tripInstance: 'fx-ap@20261020',
        route: 'BRAP',
        headsign: 'Domestic Airport',
        platform: '2',
        departs: '7:58 pm',
        inMinutes: 20,
        arrives: '8:16 pm',
        status: 'scheduled',
      },
    ],
    rounds: 2,
    costUsd: 0.0021,
  })
}

/** Answer a /__fixtures/... request. `nowMs` is injectable for tests. */
export async function handleFixtureApi(url: URL, nowMs: number, env: Env | null = null): Promise<Response> {
  const path = url.pathname.replace(/^\/__fixtures/, '')
  const data = fixtureData(path)
  if (data) return data
  if (path === '/v1/alerts' && !url.searchParams.get('mode')) return mergedAlerts(url, nowMs, env)
  const mode = modeOfPath(path, url)
  if (!mode || mode === 'tram') return json({ error: 'not_found' }, 404)
  return dispatch(mode, url, nowMs, env)
}
