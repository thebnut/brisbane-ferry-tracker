import { Footer, SiteHeader } from '../components/Chrome.tsx'
import { PRIVACY_HTML } from '../lib/legal.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'

export const meta = () =>
  pageMeta({
    title: 'Privacy Policy — Brisbane Ferry',
    description: 'Privacy Policy for Brisbane Ferry, the unofficial live CityCat departure boards.',
    url: `${SITE_URL}/privacy`,
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
