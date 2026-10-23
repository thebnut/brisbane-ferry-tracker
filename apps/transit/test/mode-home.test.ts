/**
 * THE-118 PR 8: the mode homes' saved cards (@bft/ui/mode-home homeCard) say what My Transit's cards say (cardModel,
 * which My Transit keeps off that module so it stays off its first load).
 */
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { homeCard } from '@bft/ui/mode-home'
import { describe, expect, it } from 'vitest'
import type { SavedItem } from '../app/lib/saved.ts'
import { cardModel } from '../app/routes/saved.tsx'

const NOW = Date.UTC(2026, 9, 19, 9, 30) // 7:30 pm Brisbane
const s = NOW / 1000

const dep = (o: Partial<Departure>): Departure =>
  ({
    tripInstance: 't@20261019',
    stopSequence: 1,
    route: { id: 'r', short: '66', long: 'UQ Lakes - RBWH' },
    headsign: 'UQ Lakes',
    directionId: 0,
    stopId: 's',
    platform: null,
    schedDep: s + 120,
    estDep: null,
    schedArrTo: null,
    estArrTo: null,
    status: 'scheduled',
    gps: false,
    vehicleId: null,
    ...o,
  }) as Departure

const res = (
  mode: DeparturesResponse['mode'],
  stop: string,
  departures: Departure[],
  o: Partial<DeparturesResponse> = {},
): DeparturesResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261019'],
  rtSourceTimestamp: s,
  rtState: 'live',
  generatedAt: NOW,
  mode,
  stop: { key: 'k', name: stop, stopIds: ['k'] },
  to: null,
  departures,
  ...o,
})

const CASES: Array<[name: string, item: SavedItem, data: DeparturesResponse | undefined]> = [
  [
    'bus, live and late, then two more',
    { id: 'bus:1832', mode: 'bus', key: '1832', to: null, title: 'Cultural Centre', href: '/bus/stop/1832' },
    res('bus', 'Cultural Centre, platform 1', [
      dep({ status: 'cancelled', schedDep: s + 30 }),
      dep({ status: 'live', estDep: s + 300, platform: '1' }),
      dep({ schedDep: s + 900, route: { id: 'r2', short: '61' } }),
      dep({ schedDep: s + 86_400 }),
    ]),
  ],
  [
    'bus, nothing yet',
    { id: 'bus:1', mode: 'bus', key: '1', to: null, title: 'Stop 1', href: '/bus/stop/1' },
    undefined,
  ],
  [
    'train, station to station',
    {
      id: 'train:central>bowen-hills',
      mode: 'train',
      key: 'central',
      to: 'bowen-hills',
      title: 'x',
      href: '/',
    },
    res(
      'train',
      'Central station',
      [
        dep({
          route: { id: 'BRCL', short: 'BRCL', long: 'Caboolture line' },
          headsign: 'Caboolture station',
          platform: '3',
          schedArrTo: s + 400,
        }),
      ],
      { to: { key: 'bowen-hills', name: 'Bowen Hills station' } },
    ),
  ],
  [
    'ferry, express with its vessel',
    {
      id: 'ferry:317584>317590',
      mode: 'ferry',
      key: '317584',
      to: '317590',
      title: 'Bulimba → Riverside',
      href: '/',
    },
    res(
      'ferry',
      'Bulimba ferry terminal',
      [
        dep({
          route: { id: 'F11', short: 'F11' },
          vehicleId: 'v_Mooroolbin II',
          status: 'live',
          estDep: s + 60,
        }),
      ],
      { to: { key: '317590', name: 'Riverside ferry terminal' } },
    ),
  ],
  [
    'ferry, not live',
    { id: 'ferry:317584>', mode: 'ferry', key: '317584', to: null, title: 'Bulimba', href: '/' },
    res('ferry', 'Bulimba ferry terminal', [dep({ route: { id: 'F1', short: 'F1' } })], { rtState: 'stale' }),
  ],
]

describe("a mode home's saved card says what My Transit's says", () => {
  for (const [name, item, data] of CASES)
    it(name, () => {
      const mine = homeCard(item.mode, data, NOW, item.title, item.key)
      const theirs = cardModel(item, data, NOW)
      for (const k of ['label', 'title', 'live', 'time', 'minutes', 'later', 'next'] as const)
        expect(mine[k], k).toEqual(theirs[k])
      // A whole ferry terminal's card says where the ferry is going too (Codex r3).
      if (item.mode === 'ferry' && !item.to) expect(mine.detail).toBe(`F1 · To UQ Lakes`)
      else expect(mine.detail, 'detail').toEqual(theirs.detail)
    })

  it('the big countdown gets the clock time and the next-day marker', () => {
    const tomorrow = homeCard(
      'ferry',
      res('ferry', 'Bulimba', [dep({ schedDep: s + 86_400 })]),
      NOW,
      'B',
      'b',
    )
    expect(tomorrow.clock).toBe('7:30 pm')
    expect(tomorrow.day).toBe('(20/10)')
    expect(homeCard('ferry', undefined, NOW, 'B', 'b')).toMatchObject({
      clock: null,
      day: null,
      minutes: null,
    })
  })
})
