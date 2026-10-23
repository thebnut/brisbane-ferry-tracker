import { VIA_NETWORK } from '@bft/ui/connectivity'
import { redirect } from 'react-router'
import { Footer, SiteIntro } from '../components/Chrome.tsx'
import { FerryBoards } from '../components/FerryBoards.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { HOME_META, homeJsonLd, pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { pairFromCookie } from '../lib/storage.ts'
import { boardForOldLink, DEFAULT_STOPS } from '../lib/terminals.ts'
import type { Route } from './+types/home'

export async function loader({ request, context }: Route.LoaderArgs) {
  // An old deep link (?from=&to=, R3-F2) opens that terminal's board with its "To" (THE-118 PR 5), not the saved pair.
  const board = boardForOldLink(new URL(request.url).searchParams)
  if (board) throw redirect(board, 302)
  const { fixtures, rt, fetcher, env, fallback } = loaderEnv(request, context)
  // The saved pair travels in a cookie so its rows are in the HTML; first visits get the default pair.
  const pair = pairFromCookie(request.headers.get('cookie')) ?? DEFAULT_STOPS
  const [outbound, inbound] = await Promise.all([
    settle((signal) =>
      fetchDepartures(fetcher, pair.outbound.id, pair.inbound.id, { signal, validate: validateDepartures }),
    ),
    settle((signal) =>
      fetchDepartures(fetcher, pair.inbound.id, pair.outbound.id, { signal, validate: validateDepartures }),
    ),
  ])
  return {
    pair,
    outbound,
    inbound,
    renderedAt: Date.now(),
    via: VIA_NETWORK,
    // After an API failure with FIXTURE_FALLBACK the browser polls the fixture API too (and shows the demo notice).
    // FIXTURES=1 or a fallback answer: demo data without a visitor's demo session (useFixtureCookie).
    mode: {
      fixtures: fixtures || fallback.used,
      rt,
      forced: env?.FIXTURES === '1' || fallback.used,
      allowed: env?.ALLOW_FIXTURES === '1',
    },
    siteUrl: env?.SITE_URL ?? SITE_URL,
  }
}

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const siteUrl = loaderData?.siteUrl ?? SITE_URL
  return [
    ...pageMeta({ ...HOME_META, url: `${siteUrl}/`, siteUrl }),
    { 'script:ld+json': homeJsonLd(siteUrl) },
  ]
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <FerryBoards
        from={loaderData.pair.outbound}
        to={loaderData.pair.inbound}
        home
        outbound={loaderData.outbound}
        inbound={loaderData.inbound}
        renderedAt={loaderData.renderedAt}
        mode={loaderData.mode}
      >
        <SiteIntro />
      </FerryBoards>
      <Footer />
    </>
  )
}
