/** Trip detail's shared pieces (THE-118 PR 6): the summary, facts that drop empty tiles, and "Your trip". */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { statusLine } from '../src/row.tsx'
import {
  BOARD_STATE,
  backClick,
  occupancyFact,
  positionFromVehicle,
  type TimelineStop,
  TripFacts,
  TripSummary,
  YourTrip,
} from '../src/trip.tsx'

const stop = (i: number, over: Partial<TimelineStop> = {}): TimelineStop => ({
  id: String(i),
  name: `Stop ${i}`,
  kind: 'stop',
  dep: `7:${String(10 + i).padStart(2, '0')} am`,
  ...over,
})
const STOPS = Array.from({ length: 8 }, (_, i) => stop(i))
const names = () =>
  screen.getAllByRole('listitem').map((li) => li.querySelector('span.text-\\[15px\\]')?.textContent)

describe('YourTrip', () => {
  it('starts at your stop, with earlier stops and those past your destination collapsed', async () => {
    render(<YourTrip stops={STOPS} board={3} alight={5} />)
    expect(names()).toEqual(['Stop 3', 'Stop 4', 'Stop 5'])
    const earlier = screen.getByRole('button', { name: '3 earlier stops' })
    const later = screen.getByRole('button', { name: '2 later stops' })
    expect(earlier).toHaveTextContent('▴ 3 earlier stops')
    expect(earlier).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(earlier)
    expect(names()).toEqual(['Stop 0', 'Stop 1', 'Stop 2', 'Stop 3', 'Stop 4', 'Stop 5'])
    expect(screen.getByRole('button', { name: 'Hide 3 earlier stops' })).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(later)
    expect(names()).toHaveLength(8)
  })

  it('your stop and your get-off stop are bold; stops it runs through are struck through', () => {
    const { container } = render(
      <YourTrip stops={[stop(0), stop(1, { kind: 'skip', dep: null }), stop(2), stop(3)]} board={0} alight={2} />,
    )
    expect(container.querySelector('[data-mine=board] .font-extrabold')).toHaveTextContent('Stop 0')
    expect(container.querySelector('[data-mine=alight] .font-extrabold')).toHaveTextContent('Stop 2')
    expect(screen.getByText('Stop 1')).toHaveClass('line-through')
    expect(screen.queryByText('Stop 3')).toBeNull()
  })

  it('no destination: the rest of the trip is shown, nothing collapsed after; no toggle at the first stop', () => {
    render(<YourTrip stops={STOPS} board={0} />)
    expect(names()).toHaveLength(8)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('the capsule moves on the rows shown; on a collapsed stretch its words say where', async () => {
    const { container, rerender } = render(<YourTrip stops={STOPS} board={2} position={3.5} positionLabel="Between 3 and 4" />)
    const capsule = container.querySelector('[data-train-position]') as HTMLElement
    expect(capsule.dataset.trainPosition).toBe('3.50')
    expect(capsule.style.top).toMatch(/calc\((50% \+ 50%|100%)\)/)
    expect(container.querySelector('[data-position-label]')).toBeNull()
    rerender(<YourTrip stops={STOPS} board={4} position={1.2} positionLabel="Between Stop 1 and Stop 2" />)
    expect(container.querySelector('[data-train-position]')).toBeNull()
    expect(screen.getByText('Between Stop 1 and Stop 2')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: '4 earlier stops' }))
    expect(container.querySelector('[data-train-position]')).not.toBeNull()
  })

  it('a GPS position is a live claim; a timetable one (train) is not', () => {
    const { container, rerender } = render(
      <YourTrip stops={STOPS} board={4} position={1.5} positionLabel="The bus is heading to Stop 2" positionLive />,
    )
    expect(screen.getByText('The bus is heading to Stop 2')).toHaveAttribute('data-live-claim')
    rerender(<YourTrip stops={STOPS} board={0} position={1.5} positionLive />)
    expect(container.querySelector('[data-train-position]')).toHaveAttribute('data-live-claim')
    rerender(<YourTrip stops={STOPS} board={0} position={1.5} />)
    expect(container.querySelector('[data-train-position]')).not.toHaveAttribute('data-live-claim')
  })

  it('positionFromVehicle: at a stop when stopped, half way from the one before when not', () => {
    const ids = ['a', 'b', 'c']
    expect(positionFromVehicle(ids, { stopId: 'b', status: 'STOPPED_AT' })).toBe(1)
    expect(positionFromVehicle(ids, { stopId: 'c', status: 'IN_TRANSIT_TO' })).toBe(1.5)
    expect(positionFromVehicle(ids, { stopId: 'a', status: 'INCOMING_AT' })).toBe(0)
    expect(positionFromVehicle(ids, { stopId: 'x' })).toBeNull()
    expect(positionFromVehicle(ids, null)).toBeNull()
  })
})

describe('TripFacts', () => {
  it('drops a fact with nothing to say instead of a "—" or "Not reported" tile', () => {
    const { container } = render(
      <TripFacts facts={[{ label: 'Departs', value: '7:11 am' }, null, occupancyFact(undefined)]} />,
    )
    expect(container.querySelectorAll('[data-fact]')).toHaveLength(1)
    expect(container.textContent).not.toMatch(/—|Not reported|Not reporting/)
  })
  it('occupancy only when reported, with its bars', () => {
    expect(occupancyFact('NO_DATA_AVAILABLE')).toBeNull()
    render(<TripFacts facts={[occupancyFact('FEW_SEATS_AVAILABLE')]} />)
    expect(screen.getByText('Few seats')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2 of 4 bars' })).toBeInTheDocument()
  })
  it('never more than three tiles', () => {
    const f = (label: string) => ({ label, value: label })
    const { container } = render(<TripFacts facts={[f('a'), f('b'), f('c'), f('d')]} />)
    expect(container.querySelectorAll('[data-fact]')).toHaveLength(3)
  })
})

describe('TripSummary', () => {
  it('kicker, "To {headsign}", the countdown with the clock, then the status line with GPS and the vehicle', () => {
    render(
      <TripSummary
        tile={<span>F11</span>}
        kicker="Express CityCat"
        headsign="Northshore Hamilton"
        minutes={4}
        time="7:11 am"
        status={statusLine({ status: 'live', schedDep: 100, estDep: 100 })}
        gps
        vehicle="Mooroolbin II"
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'To Northshore Hamilton' })).toBeInTheDocument()
    expect(screen.getByText('Express CityCat')).toHaveAttribute('data-kicker')
    expect(screen.getByText('4 min')).toBeInTheDocument()
    expect(screen.getByText('7:11 am')).toBeInTheDocument()
    const line = document.querySelector('[data-trip-status]') as HTMLElement
    expect(line).toHaveTextContent('Live · on time· GPS· Mooroolbin II')
  })
  it('everything from the live feed is a live claim, hidden while a cached page is unconfirmed', () => {
    render(
      <TripSummary
        tile={null}
        kicker="Metro"
        headsign="RBWH"
        minutes={4}
        time="8:14 am"
        status={statusLine({ status: 'live', schedDep: 100, estDep: 100 })}
        gps
        vehicle="Bus 1907"
        facts={[{ label: 'Departs', value: '8:14 am' }, occupancyFact('FEW_SEATS_AVAILABLE')]}
      />,
    )
    expect(screen.getByText('Bus 1907').closest('[data-live-claim]')).not.toBeNull()
    expect(screen.getByText('GPS').closest('[data-live-claim]')).not.toBeNull()
    expect(screen.getByText('Few seats').closest('[data-live-claim]')).not.toBeNull()
    expect(screen.getByText('8:14 am', { selector: 'dd' }).closest('[data-live-claim]')).toBeNull()
  })
  it('cancelled: no countdown and no "—", the clock time struck through', () => {
    const { container } = render(
      <TripSummary
        tile={null}
        kicker="Metro"
        headsign="RBWH"
        minutes={4}
        time="8:14 am"
        status={statusLine({ status: 'cancelled' })}
      />,
    )
    expect(container.textContent).not.toContain('—')
    expect(screen.getByText('8:14 am')).toHaveClass('line-through')
  })
  it('a scheduled trip claims nothing live: no GPS, no live words', () => {
    const { container } = render(
      <TripSummary tile={null} kicker="Bus" headsign="UQ" minutes={9} time="8:14 am" status={statusLine({ status: 'scheduled' })} />,
    )
    expect(container.querySelector('[data-live-claim]')).toBeNull()
    expect(container.textContent).toContain('Scheduled')
  })
})

describe('backClick', () => {
  afterEach(() => history.replaceState(null, ''))
  const click = (init: MouseEventInit = {}) => {
    let prevented = false
    const e = {
      button: 0,
      defaultPrevented: false,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...init,
      preventDefault: () => {
        prevented = true
      },
    }
    backClick(e as never)
    return prevented
  }
  it('goes back in history only when the trip was opened from a board row', () => {
    expect(click()).toBe(false)
    history.replaceState({ usr: { [BOARD_STATE]: '/ferry/terminal/bulimba' }, key: 'k', idx: 1 }, '')
    expect(click({ metaKey: true })).toBe(false)
    expect(click()).toBe(true)
  })
})
