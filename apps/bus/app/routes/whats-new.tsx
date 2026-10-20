import { WhatsNew } from '@bft/ui/whats-new'
import { BusNav, Footer, SiteHeader } from '../components/Shell.tsx'

/** /whats-new: the public changelog (@bft/ui/changelog.ts), in its own route chunk. */
export const meta = () => [{ title: 'What’s new | BrisbaneBus' }, { name: 'robots', content: 'noindex' }]

export default function WhatsNewPage() {
  return (
    <>
      <SiteHeader />
      <WhatsNew />
      <Footer />
      <BusNav active="" />
    </>
  )
}
