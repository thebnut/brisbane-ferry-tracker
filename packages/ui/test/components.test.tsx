import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CountdownChip, StatusBadge } from '../src/board.tsx'
import { OfflineBanner } from '../src/states.tsx'
import { StoppingPattern } from '../src/train.tsx'
import { RouteTile, routeTileVariant } from '../src/transit.tsx'

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
