// @vitest-environment jsdom
/** Ferry tab = BrisbaneFerry: the Bulimba terminal page (both boards) from the ferry fixtures. */
import { BASE } from '@bft/ferry/app/lib/base.ts'
import { cloudflareContext } from '@bft/ferry/app/lib/context.ts'
import { handleFixtureApi } from '@bft/ferry/app/lib/fixtures.server.ts'
import * as terminal from '@bft/ferry/app/routes/terminal.tsx'
import { afterEach, expect, it, vi } from 'vitest'
import { renderPage } from './render.tsx'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('ferry terminal page renders the same in BrisbaneFerry and in the Ferry tab', async () => {
  const html = await renderPage({
    base: BASE,
    pattern: '/terminal/:slug',
    url: '/terminal/bulimba',
    module: terminal,
    contextKey: cloudflareContext,
    fixtures: (url, now) => handleFixtureApi(url, now),
    ready: /Riverside/,
  })
  expect(html).toContain('Bulimba')
  await expect(html).toMatchFileSnapshot('__golden__/ferry-bulimba.html')
})
