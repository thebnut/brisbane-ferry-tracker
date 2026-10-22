/**
 * Layout for every tab. Each page renders the one BrisbaneTransit header (ModeHeader.tsx; a mode page through its
 * app's header module, swapped at build time), which carries the desktop mode pills; this layout adds the phone's
 * Mode Tabs. No runtime mode state: the active tab is the URL.
 */
import { isOfflineFailure } from '@bft/ui/connectivity'
import { Outlet } from 'react-router'
import { ModeBar } from '../components/ModeBar.tsx'
import { ModeHeader } from '../components/ModeHeader.tsx'
import { OfflineRouteScreen } from '../components/OfflineRoute.tsx'
import type { Route } from './+types/mode-layout'

export default function ModeLayout() {
  return (
    <>
      <Outlet />
      <ModeBar />
    </>
  )
}

/**
 * A page that can't load keeps the Mode Tabs (R7-T2): offline, a page whose data needs the network shows the offline
 * screen and loads by itself once the network is back. Any other error goes on to the root ErrorBoundary.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (!isOfflineFailure(error)) throw error
  return (
    <>
      <ModeHeader />
      <main>
        <OfflineRouteScreen />
      </main>
      <ModeBar />
    </>
  )
}
