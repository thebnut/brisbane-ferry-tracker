import { describe, expect, it } from 'vitest'
// The legacy app's canonical terminal list (plain ESM, read-only).
import { TEMPORARY_CONNECTIVITY } from '../../../src/utils/ferryStops.js'
import { TERMINALS as LEGACY } from '../../../src/utils/terminals.js'
import {
  boardForOldLink,
  boardHref,
  DEFAULT_STOPS,
  destinationParam,
  normalisePair,
  TERMINALS,
  terminalById,
  terminalByParam,
  terminalBySlug,
  tripStopName,
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
})

describe('terminal board URLs (THE-118 PR 5)', () => {
  const bulimba = terminalBySlug('bulimba')
  const dockside = terminalBySlug('dockside')
  if (!bulimba || !dockside) throw new Error('missing terminal')
  it('names a terminal by slug or by stop id', () => {
    expect(terminalByParam('hawthorne')?.id).toBe('317583')
    expect(terminalByParam('317583')?.slug).toBe('hawthorne')
    expect(terminalByParam('nope')).toBeNull()
    expect(terminalByParam(null)).toBeNull()
  })
  it('"To" is a terminal the origin reaches directly, else none', () => {
    expect(destinationParam(bulimba, 'riverside')?.id).toBe('317590')
    expect(destinationParam(bulimba, '317587')?.slug).toBe('teneriffe') // F21 across the river
    expect(destinationParam(bulimba, 'bulimba')).toBeNull()
    // Dockside only reaches Sydney Street.
    expect(destinationParam(dockside, 'riverside')).toBeNull()
    expect(destinationParam(dockside, 'sydney-street')?.id).toBe('317589')
    expect(destinationParam(bulimba, 'nope')).toBeNull()
  })
  it('links a board with its "To" by slug', () => {
    expect(boardHref('317584', '317590')).toBe('/terminal/bulimba?to=riverside')
    expect(boardHref('317584', null)).toBe('/terminal/bulimba')
    expect(boardHref('nope', '317590')).toBe('/')
  })
})

describe('old ?from=&to= links (R3-F2) open the terminal board', () => {
  const p = (q: string) => new URLSearchParams(q)
  it('with "To" when the origin reaches it', () => {
    expect(boardForOldLink(p('from=317583&to=317590'))).toBe('/terminal/hawthorne?to=riverside')
    expect(boardForOldLink(p('from=317584&to=317587'))).toBe('/terminal/bulimba?to=teneriffe')
  })
  it('without "To" when it is missing or unreachable; none for an unknown origin', () => {
    expect(boardForOldLink(p('from=317581&to=317590'))).toBe('/terminal/dockside')
    expect(boardForOldLink(p('from=317583'))).toBe('/terminal/hawthorne')
    expect(boardForOldLink(p('from=999&to=317590'))).toBeNull()
    expect(boardForOldLink(p('to=317590'))).toBeNull()
  })
  it("keeps the link's other parameters", () => {
    expect(boardForOldLink(p('from=317584&to=317590&fixtures=1'))).toBe(
      '/terminal/bulimba?to=riverside&fixtures=1',
    )
  })
})

describe('tripStopName (R3: curated names win over the API trip-stop name)', () => {
  it('shows the curated terminal name when the API name differs', () => {
    expect(tripStopName('317590', 'Riverside ferry terminal, Eagle St')).toBe('Riverside')
    expect(tripStopName('319637', 'Qut Gardens Point Ferry Terminal')).toBe('QUT Gardens Point')
  })
  it('falls back to the API name, then the stop id, for a stop not in the curated list', () => {
    expect(tripStopName('999999', 'Somewhere ferry terminal')).toBe('Somewhere ferry terminal')
    expect(tripStopName('999999', undefined)).toBe('999999')
    expect(tripStopName('999999', null)).toBe('999999')
  })
})
