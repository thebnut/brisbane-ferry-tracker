import { Footer, SiteIntro } from '../components/Chrome.tsx'
import { FerryBoards } from '../components/FerryBoards.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { HOME_META, homeJsonLd, pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { pairFromCookie } from '../lib/storage.ts'
import { DEFAULT_STOPS, pairFromParams } from '../lib/terminals.ts'
import type { Route } from './+types/home'

export async function loader({ request, context }: Route.LoaderArgs) {
  const { fixtures, rt, fetcher, env, fallback } = loaderEnv(request, context)
  // The saved pair travels in a cookie so its rows are in the HTML; first visits get the default pair.
  const saved = pairFromCookie(request.headers.get('cookie')) ?? DEFAULT_STOPS
  // A deep link (?from=&to=) opens that pair for this visit without replacing the saved one (R3-F2).
  const linked = pairFromParams(new URL(request.url).searchParams, saved)
  const pair = linked ?? saved
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
    deepLink: linked != null,
    outbound,
    inbound,
    renderedAt: Date.now(),
    // After an API failure with FIXTURE_FALLBACK the browser polls the fixture API too (and shows the demo notice).
    mode: { fixtures: fixtures || fallback.used, rt },
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
        pair={loaderData.pair}
        deepLink={loaderData.deepLink}
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
