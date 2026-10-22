import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Alert } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import {
  healthOf,
  isActive,
  isNetworkWide,
  lineStatus,
  linesOfAlert,
  networkNotices,
  nextStart,
  stationAlerts,
  upcomingAlerts,
} from '../app/lib/alerts.ts'
import { type Station, stationByKey } from '../app/lib/network.ts'

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

/** /v1/alerts?mode=train at 9:09 pm Sunday 18 Oct 2026 (descriptions dropped): 8 of 9 alerts are REDUCED_SERVICE. */
const live = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/alerts-live-20261018.json', import.meta.url)), 'utf8'),
) as { capturedAt: number; alerts: Alert[] }
const LIVE_NOW = Math.floor(live.capturedAt / 1000)
const byHeader = (h: string) => live.alerts.find((a) => a.header.startsWith(h)) as Alert

describe('line status with the live alerts of 18 Oct (T3)', () => {
  it('"Reduced train timetables" names every line: one network notice, no chip on each line', () => {
    const reduced = byHeader('Reduced train timetables')
    expect(isNetworkWide(reduced)).toBe(true)
    expect(networkNotices(live.alerts, LIVE_NOW).map((a) => a.header)).toEqual(['Reduced train timetables'])
    const rows = lineStatus(live.alerts, LIVE_NOW)
    expect(rows).toHaveLength(12)
    expect(rows.some((r) => r.alerts.includes(reduced))).toBe(false)
  })
  it('no line is red: planned track closures and reduced service are amber', () => {
    const rows = lineStatus(live.alerts, LIVE_NOW)
    expect(rows.filter((r) => r.status === 'major')).toEqual([])
    // The Shorncliffe weekend shuttle (12 to 31 Oct) is the only alert active on a line tonight.
    expect(rows.find((r) => r.name === 'Shorncliffe')).toMatchObject({ status: 'works' })
    for (const a of live.alerts) expect(healthOf(a).status).not.toBe('major')
  })
  it('closures with future periods are upcoming, not current', () => {
    const upcoming = upcomingAlerts(live.alerts, LIVE_NOW).map((a) => a.header)
    expect(upcoming).toContain('Weekend track closure - Ipswich/Rosewood and Springfield lines')
    expect(upcoming).toContain(
      'Weekend track closure - Caboolture, Redcliffe Peninsula, Shorncliffe and Sunshine Coast lines',
    )
    expect(upcoming).not.toContain('Reduced train timetables')
    const weekend = byHeader('Weekend track closure - Ipswich')
    expect(isActive(weekend, LIVE_NOW)).toBe(false)
    expect(nextStart(weekend, LIVE_NOW)).toBe(weekend.activePeriods[0]?.start)
    const springfield = lineStatus(live.alerts, LIVE_NOW).find((r) => r.name === 'Springfield')
    expect(springfield?.alerts.map((a) => a.header)).not.toContain(weekend.header)
    // During the closure it does mark the line, as planned works.
    const during = (weekend.activePeriods[0]?.start ?? 0) + 3600
    expect(lineStatus([weekend], during).find((r) => r.name === 'Springfield')).toMatchObject({
      status: 'works',
      statusText: 'Weekend works',
    })
  })
  it('red stays for no service, SEVERE and unplanned causes', () => {
    expect(healthOf(alert({ effect: 'REDUCED_SERVICE', cause: 'TECHNICAL_PROBLEM' }))).toEqual({
      status: 'major',
      text: 'Disruption',
    })
    expect(healthOf(alert({ effect: 'DETOUR', cause: 'ACCIDENT' })).status).toBe('major')
    // Delays and platform changes stay amber whatever caused them.
    expect(healthOf(alert({ effect: 'SIGNIFICANT_DELAYS', cause: 'ACCIDENT' })).status).toBe('minor')
    expect(healthOf(alert({ effect: 'REDUCED_SERVICE', severity: 'SEVERE' })).status).toBe('major')
    expect(healthOf(alert({ effect: 'NO_SERVICE', cause: 'MAINTENANCE' })).text).toBe('No trains')
    // A lift outage is not a train disruption, whatever caused it.
    expect(healthOf(alert({ effect: 'ACCESSIBILITY_ISSUE', cause: 'TECHNICAL_PROBLEM' })).status).not.toBe(
      'major',
    )
    expect(
      healthOf(alert({ effect: 'REDUCED_SERVICE', cause: 'STRIKE', header: 'Reduced timetable' })),
    ).toEqual({
      status: 'minor',
      text: 'Reduced service',
    })
    // "Sunshine Coast" is not a weekend.
    expect(
      healthOf(alert({ cause: 'MAINTENANCE', header: 'Track closure - Sunshine Coast line' })).text,
    ).toBe('Planned works')
  })
})

describe('station alerts (the board header count, THE-118 PR 3)', () => {
  const central = stationByKey('central') as Station
  const indro = stationByKey('indooroopilly') as Station
  it('counts active alerts naming a platform or a line that stops there, and nothing else', () => {
    const alerts = [
      alert({ id: 'plat', stops: [(central.platforms[0] as { id: string }).id] }),
      alert({ id: 'line', routes: ['BRFG-1'] }),
      alert({ id: 'later', routes: ['BRFG-1'], activePeriods: [{ start: 2000, end: 3000 }] }),
      alert({ id: 'bus', modes: ['bus'], routes: ['BRFG-1'] }),
    ]
    expect(stationAlerts(alerts, central, 1000).map((a) => a.id)).toEqual(['plat', 'line'])
    // Indooroopilly is on the Ipswich/Springfield lines, not Ferny Grove, and that platform isn't its own.
    expect(stationAlerts(alerts, indro, 1000).map((a) => a.id)).toEqual([])
    expect(stationAlerts([alert({ routes: ['BRSP-1'] })], indro, 1000)).toHaveLength(1)
  })
  it('counts a network-wide notice that names no route or stop at every station (Codex r1)', () => {
    const all = alert({ id: 'all', header: 'All trains suspended' })
    expect(stationAlerts([all], central, 1000)).toHaveLength(1)
    expect(stationAlerts([all], indro, 1000)).toHaveLength(1)
    expect(stationAlerts([{ ...all, modes: ['bus'] }], central, 1000)).toHaveLength(0)
  })
})
