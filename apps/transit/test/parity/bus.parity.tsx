// @vitest-environment jsdom
/** Bus tab = BrisbaneBus: the stop board (B-Departures) for Cultural Centre platform 1 from the bus fixtures. */
import { BASE } from '@bft/bus/app/lib/base.ts'
import { cloudflareContext } from '@bft/bus/app/lib/context.ts'
import { handleFixtureApi } from '@bft/bus/app/lib/fixtures.server.ts'
import * as stop from '@bft/bus/app/routes/stop.tsx'
import { afterEach, expect, it, vi } from 'vitest'
import { renderPage } from './render.tsx'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('bus stop page renders the same in BrisbaneBus and in the Bus tab', async () => {
  const html = await renderPage({
    base: BASE,
    pattern: '/stop/:stopId',
    url: '/stop/10802',
    module: stop,
    contextKey: cloudflareContext,
    fixtures: (url, now) => handleFixtureApi(url, now),
    boardAlerts: true,
    ready: /Cultural Centre station, platform 1/,
  })
  expect(html).toContain('Cultural Centre')
  await expect(html).toMatchFileSnapshot('__golden__/bus-stop-10802.html')
})
