import { WhatsNew } from '@bft/ui/whats-new'
import { Footer, SiteHeader } from '../components/Chrome.tsx'

/** /whats-new: the public changelog (@bft/ui/changelog.ts), in its own route chunk. */
export const meta = () => [{ title: 'What’s new — Brisbane Ferry' }, { name: 'robots', content: 'noindex' }]

export default function WhatsNewPage() {
  return (
    <>
      <SiteHeader />
      <WhatsNew />
      <Footer />
    </>
  )
}
