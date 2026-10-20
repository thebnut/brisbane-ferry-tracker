/**
 * Per-mode snapshot documents (transit-architecture.md §3.3: "if the snapshot exceeds about 300 KB compressed,
 * split it by mode"). With every mode matched the combined snapshot is ~2.9 MB, and an edge isolate serving only
 * /v1/ferry paid ~40 ms CPU and a second or more to fetch and parse it. Each scope document keeps the full header
 * so the generation check and source age are unchanged.
 *
 * - `{mode}`: that mode's trips and vehicles, plus alerts for that mode or with no mode. Records carried while
 *   their mode is still unloaded (no known mode) go into every mode document, since any of them may own the trip.
 * - `alerts`: every alert (for /v1/alerts without a mode); rewritten only when the alerts change.
 */
import type { Mode, RtSnapshot } from '@bft/core'

export type SnapshotScope = Mode | 'alerts'

export function splitSnapshot(
  snap: RtSnapshot,
  tripModes: Map<string, Mode>,
  modes: readonly Mode[],
): Partial<Record<Mode, RtSnapshot>> {
  const out: Partial<Record<Mode, RtSnapshot>> = {}
  for (const m of modes) out[m] = { header: snap.header, trips: {}, vehicles: [], alerts: [] }
  for (const [key, trip] of Object.entries(snap.trips)) {
    const m = tripModes.get(key)
    if (m) {
      const doc = out[m]
      if (doc) doc.trips[key] = trip
    } else {
      for (const doc of Object.values(out)) if (doc) doc.trips[key] = trip
    }
  }
  for (const v of snap.vehicles) if (v.mode) out[v.mode]?.vehicles.push(v)
  for (const a of snap.alerts) {
    for (const m of modes) if (a.modes.length === 0 || a.modes.includes(m)) out[m]?.alerts.push(a)
  }
  return out
}

export function alertsDocument(snap: RtSnapshot): RtSnapshot {
  return { header: snap.header, trips: {}, vehicles: [], alerts: snap.alerts }
}

/**
 * Merge per-mode documents (and the alerts document) back into one snapshot, for hub restore. Documents are
 * rewritten only when their content changes, so they can be of different ages: the newest header wins.
 */
export function mergeDocuments(docs: RtSnapshot[], alerts: RtSnapshot | null): RtSnapshot | null {
  const newest = docs.reduce<RtSnapshot | undefined>(
    (a, d) => (!a || d.header.seq > a.header.seq ? d : a),
    undefined,
  )
  if (!newest) return alerts
  const merged: RtSnapshot = { header: newest.header, trips: {}, vehicles: [], alerts: alerts?.alerts ?? [] }
  for (const d of docs) {
    Object.assign(merged.trips, d.trips)
    merged.vehicles.push(...d.vehicles)
  }
  return merged
}

/** A document's JSON without its header: `{"trips":…,"vehicles":…,"alerts":…}`. */
export function documentBody(doc: RtSnapshot): string {
  return JSON.stringify({ trips: doc.trips, vehicles: doc.vehicles, alerts: doc.alerts })
}

/**
 * What decides whether a document must be rewritten: its body plus the header fields that change only with the
 * static data. seq, sourceTimestamp, fetchedAt and stats move on every poll; readers get them fresh from the pointer.
 */
export function documentContent(header: RtSnapshot['header'], body: string): string {
  return `${header.schemaVersion}|${JSON.stringify(header.staticGeneration)}|${header.serviceDates.join(',')}|${body}`
}

/** The document's JSON, byte-identical to JSON.stringify(doc) (header first, as snapshotSeq expects). */
export function documentJson(header: RtSnapshot['header'], body: string): string {
  return `{"header":${JSON.stringify(header)},${body.slice(1)}`
}
