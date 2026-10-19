import { describe, expect, it } from 'vitest'
import { fixtureNow } from '../src/util/fixture-clock.ts'

const REAL = 1_760_000_000_000
const at = (q: string) => fixtureNow(new URL(`https://x/p${q}`), REAL)

describe('fixtureNow', () => {
  it('pins the clock to a well-formed epoch ms', () => {
    expect(at('?fixtureNow=1792504800000')).toBe(1792504800000)
  })

  it('is the real clock when absent or malformed', () => {
    for (const q of [
      '',
      '?fixtureNow=',
      '?fixtureNow=abc',
      '?fixtureNow=1e12',
      '?fixtureNow=-1792504800000',
      '?fixtureNow=17925048',
      '?fixtureNow=1792504800000.5',
    ])
      expect(at(q), q).toBe(REAL)
  })
})
