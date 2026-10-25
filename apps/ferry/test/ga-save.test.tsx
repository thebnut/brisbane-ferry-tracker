// @vitest-environment jsdom
/** GA4 save_stop (@bft/ui/analytics-config): sent from the ferry star and the pair save, only for a save kept. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FerryStar from '../app/components/FerryStar.tsx'
import { FAVOURITES_KEY } from '../app/lib/favourites.ts'
import { savePair } from '../app/lib/save-pair.ts'
import { BULIMBA, choice, RIVERSIDE, type Terminal, terminalById } from '../app/lib/terminals.ts'

const saveStop = vi.fn()
const button = () => screen.getByRole('button', { name: /to My Transit$/ })
const refuseWrites = () =>
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError')
  })

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  saveStop.mockClear()
  window.__bftGa = { saveStop } as unknown as NonNullable<Window['__bftGa']>
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete window.__bftGa
})

describe('ferry save_stop', () => {
  it('the star sends one save_stop for a save, none for the unsave', () => {
    render(<FerryStar from={BULIMBA} to={RIVERSIDE} />)
    fireEvent.click(button())
    expect(saveStop).toHaveBeenCalledExactlyOnceWith('ferry', BULIMBA)
    fireEvent.click(button())
    expect(saveStop).toHaveBeenCalledOnce()
  })

  it('a stale "Save" (saved elsewhere since) sends nothing', () => {
    render(<FerryStar from={BULIMBA} to={RIVERSIDE} />)
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify([{ from: BULIMBA, to: RIVERSIDE }]))
    fireEvent.click(button())
    expect(saveStop).not.toHaveBeenCalled()
  })

  it('a save storage refuses sends nothing', () => {
    render(<FerryStar from={BULIMBA} to={RIVERSIDE} />)
    refuseWrites()
    fireEvent.click(button())
    expect(saveStop).not.toHaveBeenCalled()
  })

  it('the stop selector and onboarding (savePair, remembered) send it for a new favourite only', () => {
    const pair = {
      outbound: choice(terminalById(BULIMBA) as Terminal),
      inbound: choice(terminalById(RIVERSIDE) as Terminal),
    }
    savePair(pair, false)
    expect(saveStop).not.toHaveBeenCalled()
    savePair(pair, true)
    expect(saveStop).toHaveBeenCalledExactlyOnceWith('ferry', BULIMBA)
    savePair(pair, true)
    expect(saveStop).toHaveBeenCalledOnce()
  })

  it('no gtag (GA off): saving still works and nothing throws', () => {
    delete window.__bftGa
    render(<FerryStar from={BULIMBA} to={RIVERSIDE} />)
    fireEvent.click(button())
    expect(button().getAttribute('aria-pressed')).toBe('true')
  })
})
