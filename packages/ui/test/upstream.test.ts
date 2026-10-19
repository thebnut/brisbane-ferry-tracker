// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_TIMEOUT_MS, proxied } from '../src/upstream.ts'

afterEach(() => vi.useRealTimers())

/** An upstream call that never answers until its signal aborts (R8-F1: bft-api held requests for minutes). */
const hang = (signal: AbortSignal) =>
  new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)))

describe('proxied (R8-F1)', () => {
  it('a hung upstream call is aborted and rejected at the deadline', async () => {
    vi.useFakeTimers()
    let seen: AbortSignal | undefined
    const result = proxied(new Request('https://app.test/v1/x'), (signal) => {
      seen = signal
      return hang(signal)
    }).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)
    expect(await result).toBeInstanceOf(Error)
    expect(seen?.aborted).toBe(true)
  })

  it("the visitor's abort reaches the upstream call", async () => {
    const visitor = new AbortController()
    let seen: AbortSignal | undefined
    const result = proxied(new Request('https://app.test/v1/x', { signal: visitor.signal }), (signal) => {
      seen = signal
      return hang(signal)
    }).catch((e: unknown) => e)
    visitor.abort()
    await result
    expect(seen?.aborted).toBe(true)
  })

  it('the deadline covers work after the headers (body read, contract check)', async () => {
    vi.useFakeTimers()
    const result = proxied(new Request('https://app.test/v1/x'), async () => new Promise(() => {})).catch(
      (e: unknown) => e,
    )
    await vi.advanceTimersByTimeAsync(API_TIMEOUT_MS)
    expect(String(await result)).toMatch(/upstream timeout/)
  })
})
