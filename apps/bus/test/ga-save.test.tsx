// @vitest-environment jsdom
/** GA4 save_stop (@bft/ui/analytics-config): sent from the bus star and onboarding, only for a save kept. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const saveStop = vi.fn()
const stop = (id: string) => ({ mode: 'bus' as const, id, name: `Stop ${id}` })

async function modules() {
  vi.resetModules()
  return {
    star: await import('../app/components/BusStar.tsx'),
    onb: await import('../app/lib/onboarding.ts'),
  }
}

beforeEach(() => {
  localStorage.clear()
  saveStop.mockClear()
  window.__bftGa = { saveStop } as unknown as NonNullable<Window['__bftGa']>
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete window.__bftGa
})

describe('bus save_stop', () => {
  it('the star sends one for a save, none for the unsave', async () => {
    const { star } = await modules()
    render(<star.BusStar id="10802" name="Cultural Centre" />)
    const button = () => screen.getByRole('button', { name: /My Transit$/ })
    fireEvent.click(button())
    expect(saveStop).toHaveBeenCalledExactlyOnceWith('bus', '10802')
    act(() => fireEvent.click(button()))
    expect(saveStop).toHaveBeenCalledOnce()
  })

  it('a save storage refuses sends nothing', async () => {
    const { star } = await modules()
    render(<star.BusStar id="10802" name="Cultural Centre" />)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    fireEvent.click(screen.getByRole('button', { name: /My Transit$/ }))
    expect(saveStop).not.toHaveBeenCalled()
  })

  it('onboarding and the Settings re-run send one per stop newly kept', async () => {
    const { onb } = await modules()
    onb.saveBus([stop('10802'), stop('600')])
    expect(saveStop.mock.calls).toEqual([
      ['bus', '10802'],
      ['bus', '600'],
    ])
    saveStop.mockClear()
    onb.resaveBus([stop('600'), stop('1832')])
    expect(saveStop.mock.calls).toEqual([['bus', '1832']])
  })
})
