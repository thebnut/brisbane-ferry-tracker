/**
 * Wraps every page inside the Mode Tabs layout so a page that can't load keeps the tabs (R7-T2): offline, a page
 * whose data needs the network shows the offline screen and loads by itself once the network is back. Any other error
 * goes on to the root ErrorBoundary.
 */
import { isOfflineFailure } from '@bft/ui/connectivity'
import { Outlet } from 'react-router'
import { OfflineRouteScreen } from '../root.tsx'
import type { Route } from './+types/screen'

export default function Screen() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (!isOfflineFailure(error)) throw error
  return <OfflineRouteScreen />
}
