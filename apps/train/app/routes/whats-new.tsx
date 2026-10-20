import { WhatsNew } from '@bft/ui/whats-new'
import { Footer, SiteHeader } from '../components/Chrome.tsx'
import { TrainNav } from '../components/nav.tsx'

/** /whats-new: the public changelog (@bft/ui/changelog.ts), in its own route chunk. */
export const meta = () => [{ title: 'What’s new | BrisbaneTrain' }, { name: 'robots', content: 'noindex' }]

export default function WhatsNewPage() {
  return (
    <>
      <SiteHeader />
      <WhatsNew />
      <Footer />
      <TrainNav active="" />
    </>
  )
}
