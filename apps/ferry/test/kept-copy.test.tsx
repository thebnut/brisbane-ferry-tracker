// @vitest-environment jsdom
import type { DeparturesResponse } from '@bft/core/contract'
import { bestOfflineCopy } from '@bft/ui/connectivity'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiFetcher } from '../app/lib/api.ts'
import { makeQueryClient, useDepartures, useShownData } from '../app/lib/queries.ts'
import * as storage from '../app/lib/storage.ts'
import { useNow } from '../app/lib/useNow.ts'

vi.mock('../app/lib/storage.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof storage>()
  return { ...actual, readOffline: vi.fn(actual.readOffline) }
})

const NOW = Date.UTC(2026, 9, 20, 0, 0, 0)
const body = (generatedAt: number, deps: number[]): DeparturesResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261020'],
  rtSourceTimestamp: null,
  rtState: 'live',
  generatedAt,
  mode: 'ferry',
  stop: { key: '317584', name: 'Bulimba', stopIds: ['317584'] },
  to: { key: '317590', name: 'Riverside' },
  departures: deps.map((at, i) => ({
    tripInstance: `t${i}`,
    stopSequence: 1,
    schedDep: Math.floor(at / 1000),
    estDep: null,
    routeShort: 'F1',
  })) as unknown as DeparturesResponse['departures'],
})

let renders = 0
let picked: DeparturesResponse | undefined
/** A board as FerryBoards wires it: a clock that ticks every second and the data it shows. */
function Board({
  data,
  from,
  to,
  hold,
}: {
  data: DeparturesResponse
  from: string
  to: string
  hold: boolean
}) {
  const now = useNow(NOW, 1_000)
  picked = useShownData(data, from, to, hold, now)
  renders++
  return null
}

/** Clock ticks one second at a time, each its own render (one act batches its updates into a single render). */
async function tick(seconds: number) {
  for (let i = 0; i < seconds; i++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
}

const read = vi.mocked(storage.readOffline)
beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
  localStorage.clear()
  read.mockClear()
  renders = 0
  picked = undefined
})
afterEach(() => {
  onlineManager.setOnline(true)
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the kept offline copy is read once per change, not per tick (L8)', () => {
  it('a board held offline for a minute of countdown ticks reads storage once', async () => {
    const shown = body(NOW - 3_600_000, [NOW - 60_000])
    const saved = body(NOW - 600_000, [NOW + 120_000, NOW + 600_000])
    storage.writeOffline('317584', '317590', saved)
    render(<Board data={shown} from="317584" to="317590" hold />)
    await tick(60)
    expect(renders).toBeGreaterThanOrEqual(60)
    expect(read).toHaveBeenCalledTimes(1)
    // The same choice as before the memo: the newer kept copy is the base over the cached page's spent board.
    expect(picked).toEqual(bestOfflineCopy([shown, saved], Date.now()))
  })

  it('reads again when the data, the pair or the hold changes, and never while not held', async () => {
    const a = body(NOW - 60_000, [NOW + 60_000])
    const view = render(<Board data={a} from="317584" to="317590" hold={false} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    // Online (and during hydration) the device copy isn't touched.
    expect(read).not.toHaveBeenCalled()

    view.rerender(<Board data={a} from="317584" to="317590" hold />)
    expect(read).toHaveBeenCalledTimes(1)
    const b = body(NOW - 30_000, [NOW + 90_000])
    view.rerender(<Board data={b} from="317584" to="317590" hold />)
    expect(read).toHaveBeenCalledTimes(2)
    view.rerender(<Board data={b} from="317590" to="317584" hold />)
    expect(read).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenLastCalledWith('317590', '317584')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('which copy is best still follows the clock, with no new read', async () => {
    // The board is the newest copy (R6-B1: it stays the base) and runs out at +30 s; the kept copy extends it with
    // the rows still to come, which the clock thins out.
    const shown = body(NOW - 10_000, [NOW + 30_000])
    const saved = body(NOW - 120_000, [NOW + 40_000, NOW + 90_000, NOW + 600_000])
    storage.writeOffline('317584', '317590', saved)
    render(<Board data={shown} from="317584" to="317590" hold />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(picked?.generatedAt).toBe(shown.generatedAt)
    expect(picked?.departures).toHaveLength(4)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000)
    })
    expect(picked?.generatedAt).toBe(shown.generatedAt)
    expect(picked?.departures).toHaveLength(2)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it("another tab's newer kept copy shows on the next tick, with no poll answered (Codex review r1, r2)", async () => {
    // Offline in every sense, and the poll's request hangs: nothing but the storage event can bring the copy in.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    onlineManager.setOnline(false)
    const fetcher = vi.fn<ApiFetcher>(() => new Promise<Response>(() => {}))
    const spent = body(NOW - 3_600_000, [NOW - 60_000])
    function Live() {
      const now = useNow(NOW, 1_000)
      const q = useDepartures(fetcher, { fixtures: false, rt: null }, '317584', '317590', null, spent)
      picked = useShownData(q.data, '317584', '317590', true, now)
      return null
    }
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <Live />
      </QueryClientProvider>,
    )
    await tick(2)
    expect(picked?.departures.filter((d) => d.schedDep >= Date.now() / 1000)).toHaveLength(0)
    const reads = read.mock.calls.length
    // Another tab keeps a newer copy: the browser fires `storage` here (never for this tab's own writes).
    const other = body(NOW - 60_000, [NOW + 120_000, NOW + 600_000])
    storage.writeOffline('317584', '317590', other)
    dispatchEvent(new StorageEvent('storage', { key: 'bft-ferry-v1:317584:317590' }))
    await tick(1)
    expect(picked?.generatedAt).toBe(other.generatedAt)
    expect(picked?.departures.filter((d) => d.schedDep >= Date.now() / 1000)).toHaveLength(2)
    expect(read.mock.calls.length).toBe(reads + 1)
    // And once only: the ticks after it don't read again.
    await tick(10)
    expect(read.mock.calls.length).toBe(reads + 1)
    expect(fetcher.mock.calls.length).toBeGreaterThan(0)
  })
})
