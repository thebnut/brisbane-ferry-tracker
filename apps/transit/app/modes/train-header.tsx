/**
 * Replaces apps/train/app/components/header.tsx inside BrisbaneTransit (modes.config.ts, THE-118): the one transit
 * header and the status line instead of the BrisbaneTrain lockup and the "Updated" strip. The gear opens the transit
 * Settings. Same exports as the original (test/nav-slots.test.ts).
 */
import { createContext, type ReactNode, useContext } from 'react'
import { type BackLink, ModeHeader, type LiveProps as State } from '../components/ModeHeader.tsx'
import { StatusLine } from '../components/StatusLine.tsx'
import { useRefetchLive } from './refetch-live.ts'

/** Shell's answer (apps/train/app/components/header.tsx): `idle` is a page with no live data of its own. */
type LiveProps = State & { idle?: boolean }

export const ShellLive = createContext<LiveProps>({})

/** An idle page claims nothing. */
const claim = ({ live, pending, idle }: LiveProps) => ({ live: idle ? undefined : live, pending })

export function SiteHeader({ back, ...live }: LiveProps & { back?: BackLink }) {
  return <ModeHeader {...claim(live)} back={back} />
}

/** The station strip has no refresh of its own (each board polls): tapping the line refetches every live board. */
export function UpdatedStrip({
  detail,
  children,
}: {
  updated: ReactNode
  detail?: string
  children?: ReactNode
}) {
  const { refresh, refreshing } = useRefetchLive()
  return (
    <StatusLine {...claim(useContext(ShellLive))} detail={detail} onRefresh={refresh} refreshing={refreshing}>
      {children}
    </StatusLine>
  )
}
