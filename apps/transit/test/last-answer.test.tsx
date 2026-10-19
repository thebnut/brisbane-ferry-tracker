// @vitest-environment jsdom
/**
 * R9-T1: the home's "Last updated" is kept across renders at the last network answer, and only within its data mode:
 * a demo answer's time never shows for an ordinary visit's cards (Codex review).
 */
import type { DeparturesResponse } from '@bft/core/contract'
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useLastAnswerAt } from '../app/routes/saved.tsx'

const NOW = Date.UTC(2026, 9, 19, 9, 30)
const answer = (generatedAt: number) => ({ generatedAt }) as DeparturesResponse
const offline = (generatedAt: number) => ({ ...answer(generatedAt), offline: true })

describe('useLastAnswerAt', () => {
  it('keeps the last answer while the cards turn into offline copies, and moves on with the next', () => {
    const { result, rerender } = renderHook(({ cards }) => useLastAnswerAt('false:null', cards, null), {
      initialProps: { cards: [undefined] as Array<ReturnType<typeof offline> | undefined> },
    })
    expect(result.current).toBeNull()
    rerender({ cards: [answer(NOW)] })
    expect(result.current).toBe(NOW)
    rerender({ cards: [offline(NOW + 90_000)] })
    expect(result.current).toBe(NOW)
    rerender({ cards: [undefined] })
    expect(result.current).toBe(NOW)
    rerender({ cards: [answer(NOW + 90_000)] })
    expect(result.current).toBe(NOW + 90_000)
  })

  it('starts again when the data mode changes (demo to ordinary, and back)', () => {
    const { result, rerender } = renderHook(
      ({ scope, cards }) => useLastAnswerAt(scope, cards, null),
      { initialProps: { scope: 'true:null', cards: [answer(NOW)] as Array<DeparturesResponse | undefined> } },
    )
    expect(result.current).toBe(NOW)
    // The ordinary visit's cards are still waiting, or failed: nothing, not the demo answer's time.
    rerender({ scope: 'false:null', cards: [undefined] })
    expect(result.current).toBeNull()
    rerender({ scope: 'false:null', cards: [answer(NOW + 15_000)] })
    expect(result.current).toBe(NOW + 15_000)
    rerender({ scope: 'true:null', cards: [undefined] })
    expect(result.current).toBeNull()
  })
})
