/**
 * Layout for every tab. Mode pages render their own standalone header (that app's lockup) inside the Outlet; this
 * layout adds only the Mode Tabs (bottom on phones, a pill row on desktop). No runtime mode state: the active tab is
 * the URL.
 */
import { Outlet } from 'react-router'
import { DesktopModeBar, ModeBar } from '../components/ModeBar.tsx'

export default function ModeLayout() {
  return (
    <>
      <DesktopModeBar />
      <Outlet />
      <ModeBar />
    </>
  )
}
