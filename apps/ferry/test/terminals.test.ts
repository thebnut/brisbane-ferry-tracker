import { describe, expect, it } from 'vitest'
// The legacy app's canonical terminal list (plain ESM, read-only).
import { TEMPORARY_CONNECTIVITY } from '../../../src/utils/ferryStops.js'
import { TERMINALS as LEGACY } from '../../../src/utils/terminals.js'
import {
  DEFAULT_STOPS,
  normalisePair,
  pairForTerminal,
  pairFromParams,
  swapPair,
  TERMINALS,
  terminalById,
  terminalBySlug,
  withOrigin,
} from '../app/lib/terminals.ts'

describe('terminals generated from GTFS', () => {
  it('have exactly the legacy ids, names and slugs (so /terminal/<slug> URLs are unchanged)', () => {
    const norm = (l: Array<{ id: string; name: string; slug: string }>) =>
      l.map((t) => `${t.id}|${t.name}|${t.slug}`).sort()
    expect(norm(TERMINALS)).toEqual(norm(LEGACY))
  })
  it('connectivity covers the legacy fallback table', () => {
    for (const [id, dests] of Object.entries(TEMPORARY_CONNECTIVITY as Record<string, string[]>)) {
      const ours = terminalById(id)?.destinations ?? []
      for (const d of dests) expect(ours, `${id} → ${d}`).toContain(d)
    }
  })
})

describe('pair rules', () => {
  it('normalises an unreachable destination to the first reachable one', () => {
    const p = normalisePair({
      outbound: { id: '317581', name: 'Dockside' },
      inbound: { id: '317590', name: 'x' },
    })
    expect(p.outbound.id).toBe('317581')
    expect(p.inbound.id).toBe('317589') // Dockside only reaches Sydney Street
  })
  it('falls back to Bulimba → Riverside for unknown stops', () => {
    expect(normalisePair({ outbound: { id: 'nope', name: '' }, inbound: { id: 'x', name: '' } })).toEqual(
      DEFAULT_STOPS,
    )
  })
  it('terminal pages head for Riverside, or Bulimba from Riverside, unless the saved pair involves them', () => {
    const hawthorne = terminalBySlug('hawthorne')
    const riverside = terminalBySlug('riverside')
    if (!hawthorne || !riverside) throw new Error('missing terminal')
    expect(pairForTerminal(hawthorne, null).inbound.id).toBe('317590')
    expect(pairForTerminal(riverside, null).inbound.id).toBe('317584')
    const saved = {
      outbound: { id: '317584', name: 'Bulimba' },
      inbound: { id: '317583', name: 'Hawthorne' },
    }
    expect(pairForTerminal(hawthorne, saved)).toMatchObject({
      outbound: { id: '317583' },
      inbound: { id: '317584' },
    })
  })
  it('changing origin keeps a still-reachable destination; swap swaps', () => {
    const p = withOrigin(DEFAULT_STOPS, '317583')
    expect(p).toMatchObject({ outbound: { id: '317583' }, inbound: { id: '317590' } })
    expect(swapPair(DEFAULT_STOPS)).toMatchObject({ outbound: { id: '317590' }, inbound: { id: '317584' } })
  })
})

describe('pairFromParams (R3-F2 deep links)', () => {
  const p = (q: string) => new URLSearchParams(q)
  it('opens a known, directly connected pair', () => {
    expect(pairFromParams(p('from=317583&to=317590'), DEFAULT_STOPS)).toEqual({
      outbound: { id: '317583', name: 'Hawthorne' },
      inbound: { id: '317590', name: 'Riverside' },
    })
  })
  it('ignores an unknown origin and fixes an unreachable or missing destination', () => {
    expect(pairFromParams(p('from=999&to=317590'), DEFAULT_STOPS)).toBeNull()
    expect(pairFromParams(p('to=317590'), DEFAULT_STOPS)).toBeNull()
    // Dockside only reaches Sydney Street.
    expect(pairFromParams(p('from=317581&to=317590'), DEFAULT_STOPS)?.inbound.id).toBe('317589')
    // No destination: keep the saved one when reachable.
    expect(pairFromParams(p('from=317583'), DEFAULT_STOPS)?.inbound.id).toBe('317590')
  })
})
