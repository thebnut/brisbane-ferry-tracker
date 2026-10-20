/**
 * R16-D1: one Try again on the stop search retries every failed static /data list on screen (stop index, route index,
 * lines, geo tiles), and nothing else: the /v1 live queries (departures, alerts, vehicles) keep their own backoff and
 * reconnect rules, so a failed one is never refetched by it.
 */
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { retryFailedLists } from '../app/lib/queries.ts'

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const stops: Array<() => void> = []

afterEach(() => {
  for (const stop of stops.splice(0)) stop()
  client.clear()
})

/** An active (observed) query whose fetches all fail, counting them. */
async function failing(queryKey: readonly unknown[], active = true, enabled = true) {
  const calls = { n: 0 }
  const queryFn = async () => {
    calls.n++
    throw new Error('HTTP 503')
  }
  if (active) {
    const observer = new QueryObserver(client, { queryKey, queryFn })
    stops.push(observer.subscribe(() => {}))
    await expect.poll(() => client.getQueryState(queryKey)?.status).toBe('error')
    // Still on screen with its notice, but disabled now (the route search's long names after the query changed).
    if (!enabled) observer.setOptions({ queryKey, queryFn, enabled: false })
  } else {
    await client.prefetchQuery({ queryKey, queryFn })
  }
  return calls
}

describe('retryFailedLists', () => {
  it('refetches each failed static list once', async () => {
    const lists = await Promise.all(
      [
        ['bus', 'stop-index', false],
        ['bus', 'route-index', false],
        ['bus', 'lines', false],
        ['bus', 'geo', false, 'r7hgd'],
      ].map((k) => failing(k)),
    )
    await retryFailedLists(client)
    expect(lists.map((c) => c.n)).toEqual([2, 2, 2, 2])
  })

  it('refetches a failed list that is on screen but disabled by now', async () => {
    const lines = await failing(['bus', 'lines', false], true, false)
    await retryFailedLists(client)
    expect(lines.n).toBe(2)
  })

  it('never refetches a failed /v1 live query (departures, alerts, vehicles)', async () => {
    const live = await Promise.all(
      [
        ['bus', 'departures', false, null, '10802', undefined],
        ['bus', 'alerts', false, null],
        ['bus', 'vehicles', false, null],
      ].map((k) => failing(k)),
    )
    const list = await failing(['bus', 'stop-index', false])
    await retryFailedLists(client)
    expect(live.map((c) => c.n)).toEqual([1, 1, 1])
    expect(list.n).toBe(2)
  })

  it('leaves lists no longer on screen, and other modes, alone', async () => {
    const offScreen = await failing(['bus', 'geo', false, 'r7hge'], false)
    const train = await failing(['train', 'stop-index', false])
    await retryFailedLists(client)
    expect(offScreen.n).toBe(1)
    expect(train.n).toBe(1)
  })
})
