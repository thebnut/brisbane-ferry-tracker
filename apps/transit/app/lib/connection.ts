/**
 * The header's connection state (THE-118 PR 2). It only reads the page's own LIVE answer (shared liveState and
 * rtState, unchanged) and the device's connection (useOnline), and adds a neutral first state, so a page never
 * flashes OFFLINE before anything has failed:
 *  - offline: only when the device has no connection: the browser says it is offline, or a request couldn't reach the
 *    network (fetch threw, timed out, or the service worker answered from its cache: useOnline);
 *  - connecting: the page is still waiting for its first answer and nothing has failed;
 *  - live: the page's own rule says its data is live;
 *  - scheduled: online, but the page's answer isn't live (an API error, an unavailable or stale feed, a stop the
 *    timetable no longer has). A neutral pill: the rows are timetable times, and the boards keep retrying. Before
 *    19 Nov 2026 this said OFFLINE (release review C3), which riders read as "the site is down".
 * Null for a page without live data while online (no claim either way).
 */
export type ConnectionState = 'connecting' | 'live' | 'scheduled' | 'offline'

export interface ConnectionInput {
  /** The page's LIVE answer; undefined for a page without live data. */
  live: boolean | undefined
  /** No answer yet (no data and no error) for the page's live data. */
  pending?: boolean
  /** useOnline(): false while the browser is offline or requests can't reach the network. */
  online: boolean
}

export function connectionState({ live, pending = false, online }: ConnectionInput): ConnectionState | null {
  if (!online) return 'offline'
  if (pending) return 'connecting'
  if (live === undefined) return null
  return live ? 'live' : 'scheduled'
}
