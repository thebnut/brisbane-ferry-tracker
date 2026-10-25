/**
 * GA4 (@bft/ui/analytics-config): the root loader hands Layout its bootstrap (rendered nonce'd beside the theme and
 * live-guard scripts) only when GA_MEASUREMENT_ID is set, with this site's site_mode. The rendered tag, its nonce and
 * the CSP are checked in the browser by tests/ga.spec.ts (transit and bus); the CSP itself in security.test.ts.
 */
import { RouterContextProvider } from 'react-router'
import { describe, expect, it } from 'vitest'
import { cloudflareContext } from '../app/lib/context.ts'
import { loader } from '../app/root.tsx'

async function rootData(vars: Record<string, string> = {}) {
  const context = new RouterContextProvider()
  context.set(cloudflareContext, {
    env: { API_BASE: 'http://api.invalid', SITE_URL: 'https://site.example', ...vars } as unknown as Env,
    ctx: {} as ExecutionContext,
    nonce: 'n',
  })
  // biome-ignore lint/suspicious/noExplicitAny: the generated loader args.
  return (await loader({ request: new Request('https://site.example/'), context, params: {} } as any)) as {
    ga?: string
  }
}

describe('GA4 on this site', () => {
  it('off (dev, fixtures, tests): no bootstrap', async () => {
    expect(await rootData()).not.toHaveProperty('ga')
    expect(await rootData({ GA_MEASUREMENT_ID: '' })).not.toHaveProperty('ga')
  })

  it('on: the bootstrap with site_mode "train"; debug_mode only with GA_DEBUG', async () => {
    const { ga } = await rootData({ GA_MEASUREMENT_ID: 'G-MEG3CX0SFC' })
    expect(ga).toContain('gtag("config","G-MEG3CX0SFC",')
    expect(ga).toContain('"site_mode":"train"')
    expect(ga).toContain('siteMode:"train"')
    expect(ga).not.toContain('debug_mode')
    expect((await rootData({ GA_MEASUREMENT_ID: 'G-MEG3CX0SFC', GA_DEBUG: '1' })).ga).toContain(
      '"debug_mode":true',
    )
  })
})
