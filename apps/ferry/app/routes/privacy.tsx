import { Footer, SiteHeader } from '../components/Chrome.tsx'
import { PRIVACY_HTML } from '../lib/legal.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'
import { getEnv } from '../lib/server.server.ts'
import type { Route } from './+types/privacy'

/** The site's own URL (inside BrisbaneTransit, its page there), for the canonical and OG tags. */
export function loader({ context }: Route.LoaderArgs) {
  return { siteUrl: getEnv(context)?.SITE_URL ?? SITE_URL }
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  pageMeta({
    title: 'Privacy Policy — Brisbane Ferry',
    description: 'Privacy Policy for Brisbane Ferry, the unofficial live CityCat departure boards.',
    url: `${loaderData?.siteUrl ?? SITE_URL}/privacy`,
    siteUrl: loaderData?.siteUrl,
  })

/** Prerendered at build time (react-router.config.ts). */
export default function Privacy() {
  return (
    <>
      <SiteHeader />
      <main
        className="legal mx-auto max-w-2xl px-5 py-8"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static copy from our own legacy page, not user input.
        dangerouslySetInnerHTML={{ __html: PRIVACY_HTML }}
      />
      <Footer />
    </>
  )
}
