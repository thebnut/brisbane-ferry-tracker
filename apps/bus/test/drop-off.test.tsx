// @vitest-environment jsdom
/** Smoke round 2, ADDENDUM 2: a set-down-only stop (UQ Lakes station 1882) points to where buses pick up. */
import type { DeparturesResponse } from '@bft/core/contract'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { DepartureList } from '../app/components/StopBoard.tsx'

const NOW = Date.UTC(2026, 9, 18, 12, 40)
const res = (boardAt?: Array<{ key: string; name: string }>): DeparturesResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261018', '20261019'],
  rtSourceTimestamp: NOW / 1000,
  rtState: 'live',
  generatedAt: NOW,
  mode: 'bus',
  stop: { key: '1882', name: 'UQ Lakes station', stopIds: ['1882'], ...(boardAt ? { boardAt } : {}) },
  to: null,
  departures: [],
})
const board = (data: DeparturesResponse, offline = false) =>
  render(
    <MemoryRouter>
      <DepartureList
        stopId="1882"
        data={data}
        isError={false}
        onRetry={() => {}}
        nowMs={NOW}
        alerts={[]}
        offline={offline}
      />
    </MemoryRouter>,
  )

afterEach(cleanup)

describe('set-down-only stop', () => {
  const siblings = [
    { key: '11501', name: 'UQ Lakes stop A' },
    { key: '11503', name: 'UQ Lakes stop C' },
  ]
  it('says buses only drop off here and links the stops to board at', () => {
    board(res(siblings))
    expect(screen.getByRole('heading', { name: 'Buses only drop off here' })).toBeInTheDocument()
    const links = screen.getAllByRole('link')
    expect(links.map((l) => [l.textContent, l.getAttribute('href')])).toEqual([
      ['UQ Lakes stop A', '/stop/11501'],
      ['UQ Lakes stop C', '/stop/11503'],
    ])
    expect(screen.queryByText(/No buses due/)).toBeNull()
  })
  it('says so offline too (it is the stop, not the connection)', () => {
    board(res(siblings), true)
    expect(screen.getByRole('heading', { name: 'Buses only drop off here' })).toBeInTheDocument()
  })
  it('with no stop to board at nearby: no buses pick up here', () => {
    board(res([]))
    expect(screen.getByRole('heading', { name: 'No buses pick up here' })).toBeInTheDocument()
  })
  it('an ordinary empty stop keeps the honest "no buses" text', () => {
    board(res())
    expect(screen.getByRole('heading', { name: 'No buses due' })).toBeInTheDocument()
  })
})

describe('offline empty boards (Codex review)', () => {
  it('a route filter with no saved times left says so, not "no buses on this route today or tomorrow"', () => {
    const data = res()
    data.departures = [
      {
        tripInstance: 't@20261018',
        stopSequence: 1,
        route: { id: '66-1', short: '66' },
        headsign: 'RBWH',
        directionId: 0,
        stopId: '1882',
        platform: null,
        schedDep: NOW / 1000 + 600,
        estDep: null,
        schedArrTo: null,
        estArrTo: null,
        status: 'scheduled',
        gps: false,
        vehicleId: null,
      },
    ]
    render(
      <MemoryRouter>
        <DepartureList
          stopId="1882"
          data={data}
          isError={false}
          onRetry={() => {}}
          nowMs={NOW}
          alerts={[]}
          routes={new Set(['199'])}
          offline
        />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('heading', { name: 'Offline: no saved times for this route' }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/today or tomorrow/)).toBeNull()
  })
})
