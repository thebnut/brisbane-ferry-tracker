/**
 * Layout for every tab. Mode pages render their own standalone header (that app's lockup) inside the Outlet; this
 * layout adds only the Mode Tabs (bottom on phones, a pill row on desktop). No runtime mode state: the active tab is
 * the URL.
 */
import { AppHeader } from '@bft/ui'
import emblem from '@bft/ui/assets/emblem-transit.svg?url'
import { isOfflineFailure } from '@bft/ui/connectivity'
import { Outlet } from 'react-router'
import { DesktopModeBar, ModeBar } from '../components/ModeBar.tsx'
import { OfflineRouteScreen } from '../components/OfflineRoute.tsx'
import type { Route } from './+types/mode-layout'

export default function ModeLayout() {
  return (
    <>
      <DesktopModeBar />
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
      <AppHeader mode="transit" logoSrc={emblem} />
      <DesktopModeBar />
      <main>
        <OfflineRouteScreen />
      </main>
      <ModeBar />
    </>
  )
}
