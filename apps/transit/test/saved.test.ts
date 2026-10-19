// @vitest-environment jsdom
import { KEYS } from '@bft/bus/app/lib/storage.ts'
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import { stationHref } from '@bft/train/app/lib/network.ts'
import { FAVOURITES_KEY } from '@bft/train/app/lib/storage.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import { stationName, trainBoardHref } from '../app/lib/hrefs.ts'
import { offlineRows, readSavedItems, writeSavedCopy } from '../app/lib/saved.ts'
import { cardModel, greeting, homeLiveState, lastAnswerAt } from '../app/routes/saved.tsx'

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

  it('next-day times carry the tomorrow marker (R2-S1)', () => {
    const item = {
      id: 'bus:1832',
      mode: 'bus' as const,
      key: '1832',
      to: null,
      title: 'CC',
      href: '/bus/stop/1832',
    }
    // 7:30 pm now; first bus 5:05 am tomorrow (20/10).
    const m = cardModel(
      item,
      res([
        dep({ schedDep: s + 34_500 }),
        dep({ route: { id: '199-1', short: '199', long: '' }, schedDep: s + 36_000 }),
      ]),
      NOW,
    )
    expect(m.time).toBe('5:05 am (20/10)')
    expect(m.later).toBe('5:30 am (20/10) 199')
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

describe('the home page’s live judgement (R7-T1)', () => {
  const items = [{}, {}]
  const opts = { online: true, nowMs: NOW, unconfirmedBefore: null }
  const live = res([dep({ status: 'live', estDep: s + 120 })])

  it('LIVE only once every saved card has a live answer: a pending card is not live', () => {
    expect(
      homeLiveState(
        items,
        [
          { data: live, pending: false },
          { data: undefined, pending: true },
        ],
        opts,
      ),
    ).toEqual({
      live: false,
      unconfirmed: false,
    })
    expect(
      homeLiveState(
        items,
        [
          { data: live, pending: false },
          { data: live, pending: false },
        ],
        opts,
      ).live,
    ).toBe(true)
    expect(homeLiveState(items, [{ data: undefined, pending: true }], opts).live).toBe(false)
    // A card whose request failed (no data, no longer pending) isn't live either (Codex review).
    expect(
      homeLiveState(
        items,
        [
          { data: live, pending: false },
          { data: undefined, pending: false },
        ],
        opts,
      ).live,
    ).toBe(false)
  })

  it('a page from the device’s copy is offline until a card has its own network answer', () => {
    const cached = { ...opts, unconfirmedBefore: NOW + 10_000 }
    // Saved items not read yet, or cards still waiting: offline banner, no LIVE.
    expect(homeLiveState(null, [], cached)).toEqual({ live: false, unconfirmed: true })
    expect(homeLiveState(items, [{ data: undefined, pending: true }], cached)).toEqual({
      live: false,
      unconfirmed: true,
    })
    // An answer that came with the page, or an offline copy, confirms nothing.
    expect(homeLiveState(items, [{ data: live, pending: false }], cached).unconfirmed).toBe(true)
    const copy = { ...live, generatedAt: NOW + 60_000, offline: true as const }
    expect(homeLiveState(items, [{ data: copy, pending: false }], cached).unconfirmed).toBe(true)
    // A network answer after the page: confirmed, and live once every card is.
    const fresh = { ...live, generatedAt: NOW + 60_000 }
    expect(
      homeLiveState([{}], [{ data: fresh, pending: false }], { ...cached, nowMs: NOW + 60_000 }),
    ).toEqual({ live: true, unconfirmed: false })
  })

  it('R8-T1: nothing saved, a page from the device’s copy is unconfirmed (banner too) until it reaches the network', () => {
    const cached = { ...opts, unconfirmedBefore: NOW + 10_000 }
    expect(homeLiveState([], [], cached)).toEqual({ live: false, unconfirmed: true })
    expect(homeLiveState([], [], { ...cached, reached: true })).toEqual({ live: true, unconfirmed: false })
    expect(homeLiveState([], [], { ...cached, reached: true, online: false })).toEqual({
      live: false,
      unconfirmed: false,
    })
  })

  it('nothing saved: LIVE only after the page’s own network answer, fresh page or not (Codex release review)', () => {
    // A fresh server render through an API outage: no answer, no LIVE (and no banner while the browser is online).
    expect(homeLiveState([], [], opts)).toEqual({ live: false, unconfirmed: false })
    expect(homeLiveState([], [], { ...opts, reached: true })).toEqual({ live: true, unconfirmed: false })
    expect(homeLiveState([], [], { ...opts, reached: true, online: false })).toEqual({
      live: false,
      unconfirmed: false,
    })
  })

  it('never LIVE before the saved items are read (the server render and hydration)', () => {
    expect(homeLiveState(null, [], opts)).toEqual({ live: false, unconfirmed: false })
  })

  it('never LIVE offline; with nothing saved, never LIVE from a cached copy', () => {
    expect(homeLiveState(items, [{ data: live, pending: false }], { ...opts, online: false }).live).toBe(
      false,
    )
    // A cached copy: not LIVE, and unconfirmed (the banner shows with the OFFLINE pill, R8-T1).
    expect(homeLiveState([], [], { ...opts, unconfirmedBefore: NOW })).toEqual({
      live: false,
      unconfirmed: true,
    })
  })
})

describe('R9-T1: "Last updated" is the newest network answer, never the clock', () => {
  const answer = (generatedAt: number) => ({ ...res([dep({})]), generatedAt })
  const offline = (generatedAt: number) => ({ ...answer(generatedAt), offline: true as const })

  it('nothing until a card has a network answer', () => {
    expect(lastAnswerAt(null, [], null)).toBeNull()
    expect(lastAnswerAt(null, [undefined, undefined], null)).toBeNull()
    // Offline copies (one stamped with the device clock when there was no response) set nothing.
    expect(lastAnswerAt(null, [offline(NOW), offline(Date.now())], null)).toBeNull()
  })

  it('the newest answer among the cards', () => {
    expect(lastAnswerAt(null, [answer(NOW - 30_000), undefined, answer(NOW)], null)).toBe(NOW)
    expect(lastAnswerAt(null, [answer(NOW), offline(NOW + 60_000)], null)).toBe(NOW)
  })

  it('ignores answers that came with a page from the device’s copy', () => {
    expect(lastAnswerAt(null, [answer(NOW)], NOW + 10_000)).toBeNull()
    expect(lastAnswerAt(null, [answer(NOW + 20_000)], NOW + 10_000)).toBe(NOW + 20_000)
  })

  it('stays at the last answer offline, and moves on with the next one', () => {
    // The cards turned into offline copies: the time shown before stays.
    expect(lastAnswerAt(NOW, [offline(NOW), undefined], null)).toBe(NOW)
    // Never back to an older answer.
    expect(lastAnswerAt(NOW, [answer(NOW - 60_000)], null)).toBe(NOW)
    expect(lastAnswerAt(NOW, [answer(NOW + 15_000)], null)).toBe(NOW + 15_000)
  })
})
