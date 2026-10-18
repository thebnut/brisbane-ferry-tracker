// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DemoExitLink, FIXTURE_COOKIE_MAX_AGE_S, fixtureCookie, useFixtureCookie } from '../src/demo.tsx'

function Probe({ active }: { active: boolean }) {
  useFixtureCookie('bft_fixtures', active)
  return null
}
const at = (search: string) => window.history.replaceState(null, '', `/stop/10802${search}`)

describe('demo mode is easy to leave (R7-B1)', () => {
  it('the cookie lasts an hour, and clearing it expires it at once', () => {
    expect(FIXTURE_COOKIE_MAX_AGE_S).toBe(3600)
    expect(fixtureCookie('bft_fixtures', true)).toContain('max-age=3600')
    expect(fixtureCookie('bft_fixtures', false)).toContain('max-age=0')
  })

  it('?fixtures=1 starts it only when the server put the page in demo mode; ?fixtures=0 ends it', () => {
    at('?fixtures=1')
    render(<Probe active={false} />)
    expect(document.cookie).not.toContain('bft_fixtures=1')
    render(<Probe active />)
    expect(document.cookie).toContain('bft_fixtures=1')
    at('?fixtures=0')
    render(<Probe active={false} />)
    expect(document.cookie).not.toContain('bft_fixtures=1')
    at('')
  })

  it('the notices link out of it with ?fixtures=0', () => {
    render(<DemoExitLink />)
    expect(screen.getByRole('link', { name: 'Exit demo' }).getAttribute('href')).toBe('?fixtures=0')
  })
})

describe('demo data left on the device (Codex review of R7-B1)', () => {
  it('drops copies made from demo data, and the runtime caches when it found any', async () => {
    const { clearDemoLeftovers } = await import('../src/demo.tsx')
    localStorage.setItem(
      'bft-bus-offline:10802',
      JSON.stringify({ body: { staticGeneration: 'fixture-20261020' } }),
    )
    localStorage.setItem(
      'bft-bus-offline:1',
      JSON.stringify({ body: { staticGeneration: '20261017-20261216-x' } }),
    )
    localStorage.setItem('bft-bus-saved', '[]')
    const deleted: string[] = []
    const cacheStorage = {
      keys: async () => ['workbox-precache-v2-x', 'bus-pages', 'bus-data'],
      delete: async (n: string) => {
        deleted.push(n)
        return true
      },
    } as unknown as CacheStorage
    expect(await clearDemoLeftovers({}, localStorage, cacheStorage)).toBe(1)
    expect(localStorage.getItem('bft-bus-offline:10802')).toBeNull()
    expect(localStorage.getItem('bft-bus-offline:1')).not.toBeNull()
    expect(deleted).toEqual(['bus-pages', 'bus-data'])
    deleted.length = 0
    expect(await clearDemoLeftovers({}, localStorage, cacheStorage)).toBe(0)
    expect(deleted).toEqual([])
    await clearDemoLeftovers({ force: true }, localStorage, cacheStorage)
    expect(deleted).toEqual(['bus-pages', 'bus-data'])
    localStorage.clear()
  })
})
