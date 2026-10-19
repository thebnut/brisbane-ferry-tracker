/** The offline screen for a page whose data needs the network (R7-T2), shown by the root and mode-layout boundaries. */
import { OfflineScreen } from '@bft/ui'
import { retryWhenBack } from '@bft/ui/connectivity'
import { useEffect, useRef } from 'react'
import { useRevalidator } from 'react-router'

/** A screen opened offline whose data needs the network (R7-T2): retried until it loads, Mode Tabs kept. */
export function OfflineRouteScreen() {
  const { revalidate, state } = useRevalidator()
  // One revalidation at a time: a new one aborts the one in flight, so retrying every 10 s could keep a slow but
  // working connection from ever loading the screen (Codex review).
  const loading = useRef(false)
  loading.current = state === 'loading'
  useEffect(
    () =>
      retryWhenBack(() => {
        if (!loading.current) void revalidate().catch(() => {})
      }),
    [revalidate],
  )
  return (
    <>
      <title>Offline | BrisbaneTransit</title>
      <meta name="robots" content="noindex" />
      <OfflineScreen />
    </>
  )
}
