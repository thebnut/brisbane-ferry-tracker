// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { invisibleTurnstile, within } from '../app/lib/turnstile.ts'

afterEach(() => {
  vi.useRealTimers()
  delete (window as { turnstile?: unknown }).turnstile
  for (const s of document.head.querySelectorAll('script')) s.remove()
})

describe('invisible Turnstile', () => {
  it('a script that never loads or errors still gives up (null) within the timeout', async () => {
    vi.useFakeTimers()
    const ts = invisibleTurnstile('k', () => document.body)
    const p = ts.token(50)
    await vi.advanceTimersByTimeAsync(60)
    await expect(p).resolves.toBeNull()
    // A warm-up stuck on the same load is bounded too.
    ts.warm()
    const q = ts.token(50)
    await vi.advanceTimersByTimeAsync(60)
    await expect(q).resolves.toBeNull()
  })

  it('tokens are single use: each question solves again after a reset', async () => {
    let cb: ((t: string) => void) | null = null
    const reset = vi.fn()
    window.turnstile = {
      render: (_el, o) => {
        cb = o.callback as (t: string) => void
        return 'w'
      },
      execute: () => queueMicrotask(() => cb?.(`tok-${reset.mock.calls.length}`)),
      reset,
      remove: vi.fn(),
    }
    const ts = invisibleTurnstile('k', () => document.body)
    expect(await ts.token()).toBe('tok-0')
    expect(await ts.token()).toBe('tok-1')
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('within() passes values through and times out to null', async () => {
    expect(await within(Promise.resolve(3), 10)).toBe(3)
    expect(await within(new Promise(() => {}), 5)).toBeNull()
  })
})
