// @vitest-environment jsdom
import { KEYS } from '@bft/bus/app/lib/storage.ts'
import type { Departure, DeparturesResponse } from '@bft/core/contract'
import { FAVOURITES_KEY as FERRY_FAVOURITES, readFerryFavourites } from '@bft/ferry/app/lib/favourites.ts'
import { STORAGE_KEYS } from '@bft/ferry/app/lib/storage.ts'
import { stationHref } from '@bft/train/app/lib/network.ts'
import { FAVOURITES_KEY } from '@bft/train/app/lib/storage.ts'
import { pageLive, reportValue } from '@bft/ui/mode-home'
import { beforeEach, describe, expect, it } from 'vitest'
import { stationName, trainBoardHref } from '../app/lib/hrefs.ts'
import { offlineRows, readFerry, readSavedItems, writeSavedCopy } from '../app/lib/saved.ts'
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
  it('reads the ferry favourites, train favourites and bus stops from their apps’ storage', () => {
    // The pair remembered before THE-118 becomes the first ferry favourite.
    localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
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
      ['ferry', '317584', '317590', 'Bulimba → Riverside', '/ferry/terminal/bulimba?to=riverside'],
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

  it('ferry (THE-118): reads the list as ferry favourites.ts does, in every state, without writing it', () => {
    const pair = JSON.stringify({ outbound: { id: '317584', name: '' }, inbound: { id: '317590', name: '' } })
    const states: Array<() => void> = [
      () => {},
      () => localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, pair),
      () => {
        localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, pair)
        localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
      },
      () => {
        localStorage.setItem(STORAGE_KEYS.SELECTED_STOPS, '{bad')
        localStorage.setItem(STORAGE_KEYS.REMEMBER_SELECTION, 'true')
      },
      () => sessionStorage.setItem(STORAGE_KEYS.SELECTED_STOPS_SESSION, pair),
      () => localStorage.setItem(FERRY_FAVOURITES, '{bad'),
      () => localStorage.setItem(FERRY_FAVOURITES, '{"from":"317584"}'),
      () =>
        localStorage.setItem(
          FERRY_FAVOURITES,
          JSON.stringify([
            { from: '317584', to: '317590' },
            { from: '317584', to: '317590' },
            { from: 'nope', to: null },
            { from: '317590', to: '999' },
            { from: '317590' },
            null,
          ]),
        ),
    ]
    for (const set of states) {
      localStorage.clear()
      sessionStorage.clear()
      set()
      const before = localStorage.getItem(FERRY_FAVOURITES)
      const lite = readFerry()
      expect(localStorage.getItem(FERRY_FAVOURITES)).toBe(before)
      expect(lite).toEqual(readFerryFavourites())
    }
  })

  it('ferry: several favourites, with or without a To, each its own card', () => {
    localStorage.setItem(
      FERRY_FAVOURITES,
      JSON.stringify([
        { from: '317590', to: null },
        { from: '317584', to: '317590' },
      ]),
    )
    const ferry = readSavedItems().filter((i) => i.mode === 'ferry')
    expect(ferry.map((i) => [i.id, i.title, i.href])).toEqual([
      ['ferry:317590>', 'Riverside', '/ferry/terminal/riverside'],
      ['ferry:317584>317590', 'Bulimba → Riverside', '/ferry/terminal/bulimba?to=riverside'],
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

describe('the home page’s live judgement (R7-T1), reported like the mode homes (R36-L1, R32-RT1)', () => {
  const items = [{}, {}]
  const opts = { online: true, nowMs: NOW, unconfirmedBefore: null }
  const live = res([dep({ status: 'live', estDep: s + 120 })])
  // Live data whose next departure is timetabled: the card shows no LIVE pill.
  const quiet = res([
    dep({ status: 'scheduled' }),
    dep({ status: 'live', schedDep: s + 600, estDep: s + 660 }),
  ])
  const noRows = res([])
  const state = (live: boolean | undefined, pending = false, unconfirmed = false) => ({
    live,
    pending,
    unconfirmed,
  })

  it('LIVE once no card is waiting or not live and one shows its LIVE pill', () => {
    const answered = (...data: DeparturesResponse[]) => data.map((d) => ({ data: d, failed: false }))
    expect(homeLiveState(items, answered(live, live), opts)).toEqual(state(true))
    expect(homeLiveState(items, answered(live, quiet), opts)).toEqual(state(true))
    // A stale or not-live card wins (not live, OFFLINE pill), as on the mode homes.
    expect(homeLiveState(items, answered(live, res([dep({})], 'stale')), opts)).toEqual(state(false))
  })

  it('P-3167c11-H1: never LIVE over cards without a pill: only live feeds with timetabled or no rows claim nothing', () => {
    const answered = (...data: DeparturesResponse[]) => data.map((d) => ({ data: d, failed: false }))
    expect(homeLiveState(items, answered(quiet, quiet), opts)).toEqual(state(undefined))
    expect(homeLiveState(items, answered(noRows, noRows), opts)).toEqual(state(undefined))
    expect(homeLiveState([{}], answered(noRows), opts)).toEqual(state(undefined))
  })

  it('a card still waiting: "Connecting…", not OFFLINE; a failed or not-live one wins over it (R32-RT1)', () => {
    expect(
      homeLiveState(
        items,
        [
          { data: live, failed: false },
          { data: undefined, failed: false },
        ],
        opts,
      ),
    ).toEqual(state(false, true))
    // A card whose request failed (no data, no longer pending) isn't live (Codex review), and isn't waiting.
    expect(
      homeLiveState(
        items,
        [
          { data: undefined, failed: true },
          { data: undefined, failed: false },
        ],
        opts,
      ),
    ).toEqual(state(false))
  })

  it('a failed refetch keeping its data reports as on the mode homes (reportValue, Codex r1)', () => {
    const failed = (data: DeparturesResponse) => ({ data, failed: true })
    const ok = (data: DeparturesResponse) => ({ data, failed: false })
    const waiting = { data: undefined, failed: false }
    // Timetabled data kept after a failure (a 503 leaves useOnline true): not live, never LIVE beside a live card.
    expect(homeLiveState(items, [failed(quiet), ok(live)], opts)).toEqual(state(false))
    expect(homeLiveState([{}], [failed(quiet)], opts)).toEqual(state(false))
    // Its live pill still showing: LIVE for the header, and the failure ends another card's "Connecting…" (R32-RT1).
    expect(homeLiveState([{}], [failed(live)], opts)).toEqual(state(true))
    expect(homeLiveState(items, [failed(live), waiting], opts)).toEqual(state(false))
    expect(homeLiveState(items, [ok(live), waiting], opts)).toEqual(state(false, true))
  })

  it('matches the mode homes’ pageLive for every pair of card states', () => {
    const stale = res([dep({ status: 'live', estDep: s + 120 })], 'stale')
    // [card, reportValue(live, pending, failed, liveRows)] for each state a saved card can be in.
    const cards: Array<
      [{ data: DeparturesResponse | undefined; failed: boolean }, Parameters<typeof reportValue>]
    > = [
      [{ data: undefined, failed: false }, [false, true, false, false]],
      [{ data: undefined, failed: true }, [false, false, true, false]],
      [{ data: live, failed: false }, [true, false, false, true]],
      [{ data: quiet, failed: false }, [true, false, false, false]],
      [{ data: stale, failed: false }, [false, false, false, false]],
      [{ data: live, failed: true }, [true, false, true, true]],
      [{ data: quiet, failed: true }, [true, false, true, false]],
    ]
    for (const a of cards)
      for (const b of cards) {
        const want = pageLive([reportValue(...a[1]), reportValue(...b[1])])
        const got = homeLiveState(items, [a[0], b[0]], opts)
        expect({ live: got.live, pending: got.pending }, JSON.stringify([a[1], b[1]])).toEqual(want)
      }
  })

  it('a page from the device’s copy is offline until a card has its own network answer', () => {
    const cached = { ...opts, unconfirmedBefore: NOW + 10_000 }
    // Saved items not read yet, or cards still waiting: offline banner and pill.
    expect(homeLiveState(null, [], cached)).toEqual(state(false, false, true))
    expect(homeLiveState(items, [{ data: undefined, failed: false }], cached)).toEqual(
      state(false, false, true),
    )
    // An answer that came with the page, or an offline copy, confirms nothing.
    expect(homeLiveState(items, [{ data: live, failed: false }], cached).unconfirmed).toBe(true)
    const copy = { ...live, generatedAt: NOW + 60_000, offline: true as const }
    expect(homeLiveState(items, [{ data: copy, failed: false }], cached).unconfirmed).toBe(true)
    // A network answer after the page: confirmed, and live once its card shows its pill.
    const fresh = { ...live, generatedAt: NOW + 60_000 }
    expect(homeLiveState([{}], [{ data: fresh, failed: false }], { ...cached, nowMs: NOW + 60_000 })).toEqual(
      state(true),
    )
  })

  it('R8-T1: nothing saved, a page from the device’s copy is unconfirmed (banner too) until it reaches the network', () => {
    const cached = { ...opts, unconfirmedBefore: NOW + 10_000 }
    expect(homeLiveState([], [], cached)).toEqual(state(false, false, true))
    // Reached: confirmed, and with no saved cards the page has no live data to claim.
    expect(homeLiveState([], [], { ...cached, reached: true })).toEqual(state(undefined))
    expect(homeLiveState([], [], { ...cached, reached: true, online: false })).toEqual(state(false))
  })

  it('P-3167c11-O1/H1: nothing saved, or the saved items not read yet (server render, hydration), claims nothing', () => {
    // Not OFFLINE in the server's HTML or before the alerts answer, and not LIVE over an empty list once it does.
    expect(homeLiveState(null, [], opts)).toEqual(state(undefined))
    expect(homeLiveState([], [], opts)).toEqual(state(undefined))
    expect(homeLiveState([], [], { ...opts, reached: true })).toEqual(state(undefined))
    // Offline is still said: the browser is offline, or a request couldn't reach the network (useOnline).
    expect(homeLiveState([], [], { ...opts, reached: true, online: false })).toEqual(state(false))
    expect(homeLiveState(null, [], { ...opts, online: false })).toEqual(state(false))
  })

  it('never LIVE offline; with nothing saved, never LIVE from a cached copy', () => {
    expect(homeLiveState(items, [{ data: live, failed: false }], { ...opts, online: false }).live).toBe(false)
    // A cached copy: not LIVE, and unconfirmed (the banner shows with the OFFLINE pill, R8-T1).
    expect(homeLiveState([], [], { ...opts, unconfirmedBefore: NOW })).toEqual(state(false, false, true))
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
