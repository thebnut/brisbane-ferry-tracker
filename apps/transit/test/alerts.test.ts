import type { Alert } from '@bft/core/contract'
import { describe, expect, it } from 'vitest'
import {
  alertMode,
  alertModes,
  impactOn,
  inMode,
  savedScope,
  scopeText,
  severityOf,
  sortAlerts,
  stopModeOf,
} from '../app/lib/alerts.ts'
import { isTrainPlatform, platformsOf, trainLinesOf } from '../app/lib/train-lines.ts'

const NOW = 1_792_400_000
const a = (o: Partial<Alert>): Alert => ({
  id: 'x',
  header: 'h',
  activePeriods: [{ start: NOW - 60, end: NOW + 3600 }],
  routes: [],
  stops: [],
  modes: [],
  ...o,
})

describe('merged alerts', () => {
  it('mode chips: own mode, and network-wide notices under every mode', () => {
    expect(inMode(a({ modes: ['bus'] }), 'bus')).toBe(true)
    expect(inMode(a({ modes: ['bus'] }), 'train')).toBe(false)
    expect(inMode(a({}), 'ferry')).toBe(true)
    expect(alertMode(a({}))).toBeNull()
    expect(alertMode(a({ modes: ['tram', 'train'] }))).toBe('train')
  })

  it("a stop-only alert with no mode belongs to its stops' mode, not to every mode (R2-X7b)", () => {
    const stopMode = stopModeOf(isTrainPlatform)
    // Dohles Rock Road, Murrumba Downs - temporary stop closure: one bus stop, no mode from the feed.
    const dohles = a({
      stops: ['316056'],
      header: 'Dohles Rock Road, Murrumba Downs - temporary stop closure',
    })
    const modes = alertModes(dohles, stopMode)
    expect(modes).toEqual(['bus'])
    expect(inMode(dohles, 'train', modes)).toBe(false)
    expect(inMode(dohles, 'bus', modes)).toBe(true)
    expect(scopeText(dohles, trainLinesOf, stopMode)).toBe('BUS · 1 STOP · DOHLES ROCK ROAD, MURRUMBA DOWNS')
    // Ferry terminals and train platforms are told apart from bus stops.
    expect(alertModes(a({ stops: ['317584'] }), stopMode)).toEqual(['ferry'])
    const platform = platformsOf('central')[0] as string
    expect(alertModes(a({ stops: [platform] }), stopMode)).toEqual(['train'])
    // A parent id can't be placed: under All only, never under every mode chip.
    expect(alertModes(a({ stops: ['place_cabstn'] }), stopMode)).toEqual([])
    expect(inMode(a({ stops: ['place_cabstn'] }), 'train', [])).toBe(false)
    // Without the train network a numeric stop isn't guessed to be a bus stop.
    expect(alertModes(dohles, stopModeOf())).toEqual([])
  })

  it('severity from the GTFS-RT effect, planned when not yet active', () => {
    expect(severityOf(a({ effect: 'DETOUR', modes: ['bus'] }), NOW)).toBe('detour')
    expect(severityOf(a({ effect: 'NO_SERVICE' }), NOW)).toBe('cancelled')
    expect(severityOf(a({ effect: 'STOP_MOVED' }), NOW)).toBe('changed')
    expect(severityOf(a({ effect: 'DETOUR', activePeriods: [{ start: NOW + 86400 }] }), NOW)).toBe('planned')
    expect(severityOf(a({ effect: 'OTHER_EFFECT' }), NOW)).toBe('info')
  })

  it('scope text names the route, line or stops', () => {
    expect(scopeText(a({ modes: ['bus'], routes: ['66-4949'] }))).toBe('BUS · ROUTE 66')
    expect(scopeText(a({ modes: ['bus'], routes: ['66-1', '199-2'] }))).toBe('BUS · 2 ROUTES')
    expect(scopeText(a({ modes: ['ferry'], routes: ['F1-4055'] }))).toBe('FERRY · F1')
    expect(scopeText(a({ modes: ['bus'], stops: ['1832'], header: 'Notice' }))).toBe('BUS · 1 STOP')
    expect(scopeText(a({ modes: ['train'] }))).toBe('TRAIN · ALL LINES')
    // Train line names need the train network (loaded on demand).
    expect(scopeText(a({ modes: ['train'], routes: ['BRSP-5203'] }), trainLinesOf)).toBe(
      'TRAIN · SPRINGFIELD LINE',
    )
    expect(scopeText(a({ modes: ['train'], routes: ['BRSP-5203'] }))).toBe('TRAIN · ALL LINES')
    expect(scopeText(a({}))).toBe('ALL SERVICES')
    // X3: a stop closure with no mode from the feed says which stop, never "ALL SERVICES".
    expect(
      scopeText(
        a({ modes: [], stops: ['116'], header: 'George Street, Brisbane City - temporary stop closure' }),
      ),
    ).toBe('1 STOP · GEORGE STREET, BRISBANE CITY')
    expect(scopeText(a({ modes: [], stops: ['320891', '320899'], header: 'Stop changes' }))).toBe('2 STOPS')
    expect(
      scopeText(
        a({
          modes: ['bus'],
          stops: ['10736'],
          header: "O'Connell Terrace, Bowen Hills - temporary stop closure",
        }),
      ),
    ).toBe("BUS · 1 STOP · O'CONNELL TERRACE, BOWEN HILLS")
    // No mode, but the routes are train lines (live 18 Oct: "Weekend track closure - Gold Coast line").
    expect(scopeText(a({ modes: [], routes: ['BRSP-5203'] }), trainLinesOf)).toMatch(/^TRAIN · /)
  })

  it('drops ended alerts and puts disruptions first', () => {
    const ended = a({ id: 'ended', activePeriods: [{ start: NOW - 7200, end: NOW - 60 }] })
    const info = a({ id: 'info', effect: 'OTHER_EFFECT' })
    const cancelled = a({ id: 'cancel', effect: 'NO_SERVICE' })
    expect(sortAlerts([ended, info, cancelled], NOW).map((x) => x.id)).toEqual(['cancel', 'info'])
  })

  it('saved train stations match alerts on their platforms once the network is loaded', () => {
    const item = {
      id: 'train:central>',
      mode: 'train' as const,
      key: 'central',
      to: null,
      title: 'Central',
      href: '',
    }
    const stops = savedScope([item], platformsOf).stops
    expect(stops.size).toBeGreaterThan(2)
    expect(savedScope([item]).stops.size).toBe(0)
  })

  it('"Affects my trips" by saved stop, then by route', () => {
    const scope = { stops: new Set(['1832']), routes: new Set(['66']) }
    expect(impactOn(a({ stops: ['1832'] }), scope)).toMatch(/saved stop/)
    expect(impactOn(a({ routes: ['66-4949'] }), scope)).toMatch(/route you use/)
    expect(impactOn(a({ routes: ['199-1'] }), scope)).toBeNull()
  })
})
