/** THE-118 PR 3: the bus board header's alert count in BrisbaneTransit (stop.tsx boardAlerts, Codex r2). */
import type { Alert } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { boardAlerts, stopAlerts } from '../app/routes/stop.tsx'

const alert = (over: Partial<Alert>): Alert => ({
  id: 'a',
  header: 'Notice',
  activePeriods: [],
  routes: [],
  stops: [],
  modes: ['bus'],
  ...over,
})

describe('boardAlerts', () => {
  const alerts = [
    alert({ id: 'stop', stops: ['10802'] }),
    alert({ id: 'detour', routes: ['66-4321'], effect: 'DETOUR' }),
    alert({ id: 'cut', routes: ['66-4321'], effect: 'NO_SERVICE' }),
    alert({ id: 'all', header: 'Buses suspended' }),
    alert({ id: 'other', routes: ['444-1'], effect: 'NO_SERVICE' }),
    alert({ id: 'elsewhere', stops: ['1'] }),
    alert({ id: 'train', modes: ['train'] }),
    alert({ id: 'later', stops: ['10802'], activePeriods: [{ start: 2000, end: 3000 }] }),
  ]
  it('counts this stop, any alert on a route serving it, and network-wide notices; nothing else', () => {
    expect(boardAlerts(alerts, '10802', ['66', '60'], 1000).map((a) => a.id)).toEqual([
      'stop',
      'detour',
      'cut',
      'all',
    ])
  })
  it('is wider than the notices above the rows (stop and route detours only)', () => {
    expect(stopAlerts(alerts, '10802', ['66', '60'], 1000).map((a) => a.id)).toEqual(['stop', 'detour'])
  })
})
