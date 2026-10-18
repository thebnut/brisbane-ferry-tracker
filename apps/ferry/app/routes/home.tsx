import { Footer, SiteIntro } from '../components/Chrome.tsx'
import { FerryBoards } from '../components/FerryBoards.tsx'
import { fetchDepartures } from '../lib/api.ts'
import { validateDepartures } from '../lib/contract.server.ts'
import { HOME_META, homeJsonLd, pageMeta, SITE_URL } from '../lib/seo.ts'
import { loaderEnv, settle } from '../lib/server.server.ts'
import { pairFromCookie } from '../lib/storage.ts'
import { DEFAULT_STOPS } from '../lib/terminals.ts'
import type { Route } from './+types/home'

export async function loader({ request, context }: Route.LoaderArgs) {
  const { fixtures, rt, fetcher, env } = loaderEnv(request, context)
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
    mode: { fixtures, rt },
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
