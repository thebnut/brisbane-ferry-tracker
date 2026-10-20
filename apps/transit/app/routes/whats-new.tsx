import { WhatsNew } from '@bft/ui/whats-new'
import { TransitFooter, TransitHeader } from '../components/Chrome.tsx'

/** /whats-new: the public changelog (@bft/ui/changelog.ts), in its own route chunk. The mode pages' footers link here. */
export const meta = () => [{ title: 'What’s new | BrisbaneTransit' }, { name: 'robots', content: 'noindex' }]

export default function WhatsNewPage() {
  return (
    <>
      <TransitHeader />
      <WhatsNew />
      <TransitFooter />
    </>
  )
}
