import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LineStatus } from '../src/states.tsx'
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
