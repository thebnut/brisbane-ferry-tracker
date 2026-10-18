/**
 * Hibernating WebSocket vs 15 s polling for service detail (ADR-0003 Phase 4 measurement).
 *
 *   pnpm --filter @bft/train exec tsx scripts/ws-vs-poll.ts [base=http://localhost:8797] [clients=20] [seconds=180]
 *
 * Against a bft-train Worker with TRIP_WS=1 and FIXTURES=1 (`wrangler dev --var TRIP_WS:1 --var FIXTURES:1`), it
 * picks a running trip, then runs `clients` pollers (GET every 15 s, random phase) and `clients` WebSocket viewers
 * side by side and reports, per approach: Worker/DO invocations, bytes to clients, and freshness lag (when a viewer
 * first sees a source cycle's data, minus the cycle start). It also times the server work per unit in-process
 * (fixture trip build + contract validation + fingerprint) to estimate CPU.
 */
import { performance } from 'node:perf_hooks'
import type { TripResponse } from '@bft/core/contract'
import { validateTrip } from '../app/lib/contract.server.ts'
import { handleFixtureApi } from '../app/lib/fixtures.server.ts'
import { tripFingerprint } from '../app/lib/tripFingerprint.ts'

const base = process.argv[2] ?? 'http://localhost:8797'
const clients = Number(process.argv[3] ?? 20)
const seconds = Number(process.argv[4] ?? 180)
const POLL = 15_000

/** Fixture RT stamps rtSourceTimestamp 12 s before the start of the 15 s cycle that built it. */
const cycleStart = (t: TripResponse) => ((t.rtSourceTimestamp ?? 0) + 12) * 1000

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] as number) : Number.NaN
}

async function pickTrip(): Promise<string> {
  const res = await fetch(`${base}/__fixtures/v1/train/stops/central/departures?limit=20`)
  const body = (await res.json()) as { departures: Array<{ tripInstance: string; gps: boolean }> }
  const d = body.departures.find((x) => x.gps) ?? body.departures[0]
  if (!d) throw new Error('no departures')
  return d.tripInstance
}

async function main() {
  const key = await pickTrip()
  const until = Date.now() + seconds * 1000
  const poll = { requests: 0, bytes: 0, lags: [] as number[] }
  const ws = { connects: 0, messages: 0, bytes: 0, lags: [] as number[] }

  const pollers = Array.from({ length: clients }, async () => {
    await new Promise((r) => setTimeout(r, Math.random() * POLL))
    const seen = new Set<number>()
    while (Date.now() < until) {
      const res = await fetch(`${base}/__fixtures/v1/train/trips/${encodeURIComponent(key)}`)
      const text = await res.text()
      poll.requests++
      poll.bytes += text.length
      const c = cycleStart(JSON.parse(text) as TripResponse)
      if (!seen.has(c)) {
        seen.add(c)
        if (seen.size > 1) poll.lags.push(Date.now() - c)
      }
      await new Promise((r) => setTimeout(r, POLL))
    }
  })

  const sockets = Array.from(
    { length: clients },
    () =>
      new Promise<void>((resolve) => {
        const s = new WebSocket(`${base.replace(/^http/, 'ws')}/v1/train/trips/${encodeURIComponent(key)}/ws`)
        const seen = new Set<number>()
        s.addEventListener('open', () => ws.connects++)
        s.addEventListener('message', (e) => {
          const text = String(e.data)
          ws.messages++
          ws.bytes += text.length
          const c = cycleStart(JSON.parse(text) as TripResponse)
          if (!seen.has(c)) {
            seen.add(c)
            if (seen.size > 1) ws.lags.push(Date.now() - c)
          }
        })
        setTimeout(() => {
          s.close()
          resolve()
        }, until - Date.now())
      }),
  )
  await Promise.all([...pollers, ...sockets])
  const stats = await (await fetch(`${base}/__trip-ws-stats/${encodeURIComponent(key)}`)).json()

  // Server work per unit, in-process (Workers Free: 10 ms CPU per invocation).
  const now = Date.now()
  const url = new URL(`http://x/__fixtures/v1/train/trips/${encodeURIComponent(key)}`)
  await handleFixtureApi(url, now)
  const runs = 50
  let t = performance.now()
  let fp = ''
  for (let i = 0; i < runs; i++) {
    const trip = validateTrip(await (await handleFixtureApi(url, now)).json())
    fp = tripFingerprint(trip)
  }
  const perLoadMs = (performance.now() - t) / runs
  t = performance.now()
  for (let i = 0; i < runs; i++) JSON.stringify(fp)
  const minutes = seconds / 60
  const report = {
    trip: key,
    clients,
    seconds,
    polling: {
      workerRequests: poll.requests,
      perClientPerMin: +(poll.requests / clients / minutes).toFixed(2),
      bytesToClients: poll.bytes,
      lagMs: { p50: pct(poll.lags, 50), p95: pct(poll.lags, 95), max: Math.max(...poll.lags) },
      serverWorkMs: +(poll.requests * perLoadMs).toFixed(1),
    },
    websocket: {
      connects: ws.connects,
      messagesToClients: ws.messages,
      bytesToClients: ws.bytes,
      lagMs: { p50: pct(ws.lags, 50), p95: pct(ws.lags, 95), max: Math.max(...ws.lags) },
      doStats: stats,
      serverWorkMs: +(((stats as { upstream: number }).upstream ?? 0) * perLoadMs).toFixed(1),
    },
    perTripLoadMs: +perLoadMs.toFixed(2),
  }
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
