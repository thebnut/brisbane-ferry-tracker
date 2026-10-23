import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LineStatus } from '../src/states.tsx'
import { ServiceTimeline } from '../src/timeline.tsx'
import { LineChip, StoppingPattern } from '../src/train.tsx'

describe('StoppingPattern (compact strip)', () => {
  const stops = [
    { id: 'a', name: 'Roma Street', stops: true },
    { id: 'b', name: 'Milton', stops: false },
    { id: 'c', name: 'Auchenflower', stops: false },
    { id: 'd', name: 'Toowong', stops: true, gapBefore: true },
  ]
  it('hollow dots for run-through stations, counted in the label; names stay accessible', () => {
    const { container } = render(<StoppingPattern compact stops={stops} color="1F6FB2" />)
    expect(
      screen.getByRole('list', { name: 'Stopping pattern, runs through 2 stations' }),
    ).toBeInTheDocument()
    expect(container.querySelectorAll('[data-stops="false"]')).toHaveLength(2)
    expect(screen.getByText('Milton')).toHaveClass('sr-only')
    expect(screen.getByText('… then', { exact: false })).toBeInTheDocument()
  })
})

describe('ServiceTimeline', () => {
  it('draws the train capsule at its fractional position and separate arr/dep', () => {
    const { container } = render(
      <ServiceTimeline
        position={1.5}
        positionLabel="Between Central and Roma Street"
        stops={[
          { id: '1', name: 'Bowen Hills', kind: 'passed', dep: '2:44 pm' },
          { id: '2', name: 'Central', kind: 'stop', arr: '2:48 pm', dep: '2:50 pm' },
          { id: '3', name: 'Milton', kind: 'skip', note: 'Passes, no stop' },
          { id: '4', name: 'Toowong', kind: 'you', dep: '2:59 pm' },
        ]}
      />,
    )
    const capsule = container.querySelector('[data-train-position]') as HTMLElement
    expect(capsule.dataset.trainPosition).toBe('1.50')
    expect(capsule.style.top).toMatch(/calc\((50% \+ 50%|100%)\)/)
    expect(screen.getByText('arr 2:48 pm', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Between Central and Roma Street')).toBeInTheDocument()
  })
})

describe('LineStatus and LineChip', () => {
  it('shows the status chip text override', () => {
    render(
      <LineStatus
        lines={[{ id: 's', name: 'Springfield', status: 'minor', statusText: 'Platform change' }]}
      />,
    )
    expect(screen.getByText('Platform change')).toBeInTheDocument()
  })
  it('LineChip renders the name', () => {
    render(<LineChip name="Ferny Grove" color="D53E45" />)
    expect(screen.getByText('Ferny Grove')).toBeInTheDocument()
  })
})
