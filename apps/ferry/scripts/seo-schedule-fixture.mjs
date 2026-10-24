/**
 * Trim a legacy schedule (schedule-data/latest.json) to the SEO parity test's fixture,
 * test/fixtures/seo-schedule.json: one trip per route and stopping pattern, with only the fields the legacy
 * buildTerminalData reads. The test then doesn't depend on the day the repo's own copy was generated (on weekend
 * data there are no F11 or F12 runs).
 *
 *   node apps/ferry/scripts/seo-schedule-fixture.mjs [schedule=schedule-data/latest.json]
 *
 * Use a weekday's schedule: the app's terminal routes (app/data/terminals.json) cover a whole week.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const src = process.argv[2] ?? 'schedule-data/latest.json'
const schedule = JSON.parse(readFileSync(src, 'utf8'))
const trips = new Map()
for (const d of schedule.departures) {
  if (!trips.has(d.tripId)) trips.set(d.tripId, [])
  trips.get(d.tripId).push(d)
}
const kept = new Map()
for (const stops of trips.values()) {
  stops.sort((a, b) => a.stopSequence - b.stopSequence)
  const key = `${stops[0].routeId.split('-')[0]}:${stops.map((d) => d.stopId).join(',')}`
  if (!kept.has(key)) kept.set(key, stops)
}
const departures = [...kept.keys()]
  .sort()
  .flatMap((k) => kept.get(k))
  .map(({ tripId, routeId, stopId, stopSequence, departureTime, headsign }) => ({
    tripId,
    routeId,
    stopId,
    stopSequence,
    departureTime,
    headsign,
  }))
const out = new URL('../test/fixtures/seo-schedule.json', import.meta.url)
writeFileSync(out, `${JSON.stringify({ generated: schedule.generated, departures }, null, 1)}\n`)
console.log(
  `${departures.length} departures from ${kept.size} trips (${src}, generated ${schedule.generated})`,
)
