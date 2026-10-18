import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { CountdownChip, DepartureCard, StatusBadge } from '../src/board.tsx'
import { OfflineBanner } from '../src/states.tsx'
import {
  isPlatformChange,
  PlatformTile,
  RouteTile,
  routeTileVariant,
  StoppingPattern,
} from '../src/transit.tsx'

describe('CountdownChip', () => {
  it.each([
    [0, 'Departing', 'departing'],
    [4, 'in 4 mins', 'soon'],
    [11, 'in 11 mins', 'near'],
    [34, 'in 34 mins', 'later'],
  ])('%i min → %s (%s)', (mins, text, tone) => {
    render(<CountdownChip minutes={mins} />)
    const chip = screen.getByText(text)
    expect(chip).toHaveAttribute('data-tone', tone)
  })
  it('renders nothing over an hour', () => {
    const { container } = render(<CountdownChip minutes={88} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('StatusBadge', () => {
  it.each([
    ['live', 'LIVE'],
    ['scheduled', 'SCHEDULED'],
    ['gps', 'GPS'],
    ['express', 'EXPRESS'],
    ['cancelled', 'CANCELLED'],
    ['skipped', 'SKIPPED'],
    ['unknown', 'UNKNOWN'],
  ] as const)('%s shows %s', (kind, text) => {
    render(<StatusBadge kind={kind} />)
    expect(screen.getByText(text)).toHaveAttribute('data-badge', kind)
  })
})

describe('DepartureCard', () => {
  it('shows times, badges, chip and opens on click', async () => {
    const onSelect = vi.fn()
    render(
      <DepartureCard
        time="7:42 pm"
        arrival={{ time: '7:54 pm' }}
        badges={['live', 'gps']}
        service="EXPRESS · F11"
        express
        highlighted
        minutes={4}
        onSelect={onSelect}
        label="7:42 pm express to Riverside"
      />,
    )
    expect(screen.getByText('in 4 mins')).toBeInTheDocument()
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByRole('article')).toHaveAttribute('data-highlighted', 'true')
    await userEvent.click(screen.getByRole('button', { name: '7:42 pm express to Riverside' }))
    expect(onSelect).toHaveBeenCalledOnce()
  })
  it('cancelled rows have no countdown', () => {
    render(<DepartureCard time="8:01 pm" badges={['cancelled']} cancelled minutes={20} />)
    expect(screen.queryByText('in 20 mins')).toBeNull()
    expect(screen.getByRole('article')).toHaveAttribute('data-cancelled', 'true')
  })
})

describe('PlatformTile', () => {
  it('detects a change only when both platforms are known and differ', () => {
    expect(isPlatformChange('7', '4')).toBe(true)
    expect(isPlatformChange('4', '4')).toBe(false)
    expect(isPlatformChange(' 4a', '4A')).toBe(false)
    expect(isPlatformChange('4', null)).toBe(false)
  })
  it('renders the NOW tile with the old number struck through', () => {
    render(<PlatformTile platform="7" scheduledPlatform="4" />)
    const tile = screen.getByLabelText('Platform changed to 7, was 4')
    expect(tile).toHaveTextContent('NOW74')
    expect(tile).toHaveAttribute('data-platform-change', 'true')
  })
  it('renders a plain platform tile', () => {
    render(<PlatformTile platform="4" scheduledPlatform="4" />)
    expect(screen.getByLabelText('Platform 4')).toBeInTheDocument()
  })
})

describe('RouteTile', () => {
  it('uses orange for Metro and CityGlider', () => {
    expect(routeTileVariant('M1')).toBe('premium')
    expect(routeTileVariant('60', 'CityGlider')).toBe('premium')
    expect(routeTileVariant('199')).toBe('premium')
    expect(routeTileVariant('61')).toBe('premium')
    expect(routeTileVariant('29')).toBe('standard')
    expect(routeTileVariant('M10')).toBe('premium')
    render(<RouteTile route="M2" variant="premium" />)
    expect(screen.getByText('M2').closest('[data-variant]')).toHaveAttribute('data-variant', 'premium')
  })
})

describe('StoppingPattern', () => {
  it('lists every stop and marks run-through stations', () => {
    render(
      <StoppingPattern
        stops={[
          { id: 'a', name: 'Central', stops: true },
          { id: 'b', name: 'Fortitude Valley', stops: false },
          { id: 'c', name: 'Bowen Hills', stops: true },
        ]}
      />,
    )
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByText('(runs through)')).toBeInTheDocument()
  })
})

describe('OfflineBanner', () => {
  it('uses the agreed wording', () => {
    render(<OfflineBanner kind="offline" />)
    expect(screen.getByText('Offline · scheduled')).toBeInTheDocument()
  })
  it('live times unavailable', () => {
    render(<OfflineBanner kind="unavailable" />)
    expect(screen.getByText('Live times unavailable')).toBeInTheDocument()
  })
})
