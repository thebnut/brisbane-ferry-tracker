import { Footer, SiteHeader } from '../components/Chrome.tsx'
import { TERMS_HTML } from '../lib/legal.ts'
import { pageMeta, SITE_URL } from '../lib/seo.ts'

export const meta = () =>
  pageMeta({
    title: 'Terms of Use — Brisbane Ferry',
    description: 'Terms of Use for Brisbane Ferry, the unofficial live CityCat departure boards.',
    url: `${SITE_URL}/terms`,
  })

/** Prerendered at build time (react-router.config.ts). */
export default function Terms() {
  return (
    <>
      <SiteHeader />
      <main
        className="legal mx-auto max-w-2xl px-5 py-8"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: static copy from our own legacy page, not user input.
        dangerouslySetInnerHTML={{ __html: TERMS_HTML }}
      />
      <Footer />
    </>
  )
}
