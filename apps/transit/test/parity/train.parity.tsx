// @vitest-environment jsdom
/** Train tab = BrisbaneTrain: the Roma Street → Indooroopilly station board (T-Departures) from the train fixtures. */
import { BASE } from '@bft/train/app/lib/base.ts'
import { cloudflareContext } from '@bft/train/app/lib/context.ts'
import { handleFixtureApi } from '@bft/train/app/lib/fixtures.server.ts'
import * as station from '@bft/train/app/routes/station.tsx'
import { afterEach, expect, it, vi } from 'vitest'
import { renderPage } from './render.tsx'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('train station board renders the same in BrisbaneTrain and in the Train tab', async () => {
  const html = await renderPage({
    base: BASE,
    pattern: '/station/:slug',
    url: '/station/roma-street?to=indooroopilly',
    module: station,
    contextKey: cloudflareContext,
    fixtures: (url, now) => handleFixtureApi(url, now),
    transitNav: 'Train sections',
    ready: /Indooroopilly/,
  })
  expect(html).toContain('Roma Street')
  await expect(html).toMatchFileSnapshot('__golden__/train-roma-street.html')
})
