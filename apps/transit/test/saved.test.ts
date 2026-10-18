// @vitest-environment jsdom
import { KEYS } from '@bft/bus/app/lib/storage.ts'
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import { stationHref } from '@bft/train/app/lib/network.ts'
import { FAVOURITES_KEY } from '@bft/train/app/lib/storage.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import { stationName, trainBoardHref } from '../app/lib/hrefs.ts'
import { offlineRows, readSavedItems, writeSavedCopy } from '../app/lib/saved.ts'
import { cardModel, greeting } from '../app/routes/saved.tsx'

const NOW = Date.UTC(2026, 9, 19, 9, 30) // 7:30 pm Brisbane
const s = NOW / 1000

const dep = (o: Partial<Departure>): Departure =>
  ({
    tripInstance: 't@20261019',
    stopSequence: 1,
    route: { id: '66-1', short: '66', long: 'UQ Lakes - RBWH' },
    headsign: 'UQ Lakes',
    directionId: 0,
    stopId: '1832',
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
  departures: Departure[],
  rtState: DeparturesResponse['rtState'] = 'live',
): DeparturesResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261019'],
  rtSourceTimestamp: s,
  rtState,
  generatedAt: NOW,
  mode: 'bus',
  stop: { key: '1832', name: 'Cultural Centre, platform 1', stopIds: ['1832'] },
  to: null,
  departures,
})

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('Saved mixes every app’s own saved items', () => {
  it('reads the ferry pair, train favourites and bus stops from their apps’ storage', () => {
    localStorage.setItem(
      STORAGE_KEYS.SELECTED_STOPS,
      JSON.stringify({
        outbound: { id: '317584', name: 'Bulimba' },
        inbound: { id: '317590', name: 'Riverside' },
      }),
    )
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: 'roma-street', to: 'indooroopilly' }]))
    localStorage.setItem(KEYS.SAVED, JSON.stringify([{ id: '1832', name: 'Cultural Centre, platform 1' }]))
    const items = readSavedItems()
    expect(items.map((i) => [i.mode, i.key, i.to, i.title, i.href])).toEqual([
      ['ferry', '317584', '317590', 'Bulimba → Riverside', '/ferry'],
      [
        'train',
        'roma-street',
        'indooroopilly',
        'Roma Street → Indooroopilly',
        '/train/station/roma-street?to=indooroopilly',
      ],
      ['bus', '1832', null, 'Cultural Centre, platform 1', '/bus/stop/1832'],
    ])
  })

  it('offline: scheduled-only rows from this page’s copy, without departed services', () => {
    localStorage.setItem(KEYS.SAVED, JSON.stringify([{ id: '1832', name: 'CC' }]))
    const [item] = readSavedItems()
    if (!item) throw new Error('no item')
    writeSavedCopy(
      item,
      res([dep({ schedDep: s - 600 }), dep({ status: 'live', estDep: s + 200, gps: true })]),
    )
    const rows = offlineRows(item, NOW) ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'scheduled', estDep: null, gps: false })
  })

  it('offline falls back to the bus app’s own longer copy', () => {
    localStorage.setItem(KEYS.SAVED, JSON.stringify([{ id: '1832', name: 'CC' }]))
    localStorage.setItem('bft-bus-v1:1832', JSON.stringify({ savedAt: NOW, body: res([dep({})]) }))
    const [item] = readSavedItems()
    expect(offlineRows(item as never, NOW)).toHaveLength(1)
  })

  it('card model: route + headsign title for bus, countdown, LIVE and the following departures', () => {
    const item = {
      id: 'bus:1832',
      mode: 'bus' as const,
      key: '1832',
      to: null,
      title: 'CC',
      href: '/bus/stop/1832',
    }
    const m = cardModel(
      item,
      res([
        dep({ status: 'live', estDep: s + 120 }),
        dep({ route: { id: '199-1', short: '199', long: '' }, schedDep: s + 360 }),
        dep({ route: { id: 'M2-1', short: 'M2', long: '' }, schedDep: s + 660 }),
      ]),
      NOW,
    )
    expect(m).toMatchObject({
      title: '66 to UQ Lakes',
      live: true,
      time: '7:32 pm',
      minutes: 2,
      label: 'Bus · Cultural Centre, platform 1',
    })
    expect(m.later).toBe('7:36 pm 199   7:41 pm M2')
    expect(cardModel(item, res([]), NOW)).toMatchObject({ time: null, minutes: null })
  })

  it('train titles and links match the train app without its station list', () => {
    expect(trainBoardHref('roma-street', null)).toBe(stationHref('roma-street'))
    expect(trainBoardHref('roma-street', 'indooroopilly')).toBe(
      `${stationHref('roma-street')}?to=indooroopilly`,
    )
    expect(stationName('south-brisbane')).toBe('South Brisbane')
  })

  it('greets in Brisbane time', () => {
    expect(greeting(Date.UTC(2026, 9, 19, 22))).toBe('Good morning')
    expect(greeting(NOW)).toBe('Good evening')
  })
})
