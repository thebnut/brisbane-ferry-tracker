/**
 * Phase 1 freshness and latency probe (transit-architecture.md §3.3 "Freshness", §7 exit criteria).
 * Polls a /v1 endpoint like a client would and reports:
 *  - source age = client clock − rtSourceTimestamp (TransLink header time behind the response): p50 / p95 / max
 *  - request latency: p50 / p75 / p95 / max
 *  - rtState counts, HTTP statuses, cache headers seen
 *
 *   node --experimental-transform-types scripts/freshness.ts \
 *     --url 'https://bft-api.brisbanetransit.workers.dev/v1/ferry/stops/317584/departures?to=317590' \
 *     [--interval 15] [--duration 600] [--out report.json]
 *
 * Run it from Brisbane for the p75 < 150 ms criterion; the client clock should be NTP-synced.
 */
import { writeFile } from 'node:fs/promises'

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? '') : def
}

export function pct(xs: number[], p: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] as number
}

export interface Sample {
  at: number
  status: number
  latencyMs: number
  sourceAgeS: number | null
  rtState: string | null
  cache: string | null
}

export function summarise(samples: Sample[]) {
  const ages = samples.map((s) => s.sourceAgeS).filter((x): x is number => x != null)
  const lat = samples.map((s) => s.latencyMs)
  const count = <K extends string>(f: (s: Sample) => K) =>
    samples.reduce<Record<string, number>>((m, s) => {
      const k = f(s)
      m[k] = (m[k] ?? 0) + 1
      return m
    }, {})
  const r = (x: number | null) => (x == null ? null : Math.round(x * 10) / 10)
  return {
    samples: samples.length,
    sourceAgeS: {
      p50: r(pct(ages, 50)),
      p95: r(pct(ages, 95)),
      max: r(ages.length ? Math.max(...ages) : null),
    },
    latencyMs: {
      p50: r(pct(lat, 50)),
      p75: r(pct(lat, 75)),
      p95: r(pct(lat, 95)),
      max: r(lat.length ? Math.max(...lat) : null),
    },
    rtState: count((s) => s.rtState ?? 'none'),
    status: count((s) => String(s.status)),
    cache: count((s) => s.cache ?? 'none'),
  }
}

async function main() {
  const url = arg('url')
  if (!url) {
    console.error('usage: freshness.ts --url <v1 endpoint> [--interval s] [--duration s] [--out file]')
    process.exit(2)
  }
  const intervalMs = Number(arg('interval', '15')) * 1000
  const durationMs = Number(arg('duration', '600')) * 1000
  const samples: Sample[] = []
  const end = Date.now() + durationMs
  while (Date.now() < end) {
    const t0 = performance.now()
    let s: Sample
    try {
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
      const body = (await res.json()) as { rtSourceTimestamp?: number | null; rtState?: string }
      const latencyMs = performance.now() - t0
      s = {
        at: Date.now(),
        status: res.status,
        latencyMs,
        sourceAgeS: body.rtSourceTimestamp != null ? Date.now() / 1000 - body.rtSourceTimestamp : null,
        rtState: body.rtState ?? null,
        cache: res.headers.get('cf-cache-status'),
      }
    } catch {
      s = {
        at: Date.now(),
        status: 0,
        latencyMs: performance.now() - t0,
        sourceAgeS: null,
        rtState: null,
        cache: null,
      }
    }
    samples.push(s)
    process.stderr.write(
      `${new Date(s.at).toISOString()} ${s.status} ${s.latencyMs.toFixed(0)} ms age ${s.sourceAgeS?.toFixed(1) ?? '-'} s ${s.rtState}\n`,
    )
    await new Promise((r) => setTimeout(r, Math.max(0, intervalMs - (performance.now() - t0))))
  }
  const report = {
    url,
    intervalS: intervalMs / 1000,
    from: samples[0]?.at,
    to: samples.at(-1)?.at,
    ...summarise(samples),
  }
  const out = arg('out')
  if (out) await writeFile(out, JSON.stringify({ report, samples }, null, 2))
  console.log(JSON.stringify(report, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
