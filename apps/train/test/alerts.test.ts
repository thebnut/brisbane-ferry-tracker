import type { Alert } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import { healthOf, isActive, lineStatus, linesOfAlert } from '../app/lib/alerts.ts'

const alert = (over: Partial<Alert>): Alert => ({
  id: 'a',
  header: 'Notice',
  activePeriods: [],
  routes: [],
  stops: [],
  modes: ['train'],
  ...over,
})

describe('line status', () => {
  it('maps alert route ids to display lines by route short name', () => {
    expect(linesOfAlert(alert({ routes: ['BRSP-5185'] }))).toContain('Springfield')
    expect(linesOfAlert(alert({ routes: ['BRFG-5185'] }))).toEqual(['Ferny Grove'])
  })
  it('classifies platform changes, delays, works and suspensions', () => {
    expect(
      healthOf(alert({ header: 'Platform changes at Roma Street', description: 'leave from platform 7' })),
    ).toEqual({ status: 'minor', text: 'Platform change' })
    expect(healthOf(alert({ effect: 'SIGNIFICANT_DELAYS' })).status).toBe('minor')
    expect(healthOf(alert({ cause: 'MAINTENANCE', header: 'Weekend track works' }))).toEqual({
      status: 'works',
      text: 'Weekend works',
    })
    expect(healthOf(alert({ effect: 'NO_SERVICE' })).status).toBe('major')
  })
  it('every line is listed, worst first; inactive alerts are ignored', () => {
    const rows = lineStatus(
      [
        alert({ id: 'x', routes: ['BRFG-1'], effect: 'NO_SERVICE', summary: 'No trains' }),
        alert({
          id: 'y',
          routes: ['BRSP-1'],
          effect: 'SIGNIFICANT_DELAYS',
          activePeriods: [{ start: 0, end: 10 }],
        }),
      ],
      1000,
    )
    expect(rows[0]).toMatchObject({ name: 'Ferny Grove', status: 'major', detail: 'No trains' })
    expect(rows.find((r) => r.name === 'Springfield')?.status).toBe('good')
    expect(rows.length).toBeGreaterThanOrEqual(12)
    expect(isActive(alert({ activePeriods: [{ start: 5 }] }), 4)).toBe(false)
  })
})
