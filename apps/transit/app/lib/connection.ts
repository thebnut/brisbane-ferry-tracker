/**
 * The header's connection state (THE-118 PR 2). It only reads the page's own LIVE answer (shared liveState and
 * rtState, unchanged) and adds a neutral first state, so a page never flashes OFFLINE before anything has failed:
 *  - offline: the browser is offline or a request has failed (useOnline), or the page's answer arrived and isn't live
 *    (an API error, an unavailable or stale feed: the existing OFFLINE, which release review C3 pins);
 *  - connecting: the page is still waiting for its first answer and nothing has failed;
 *  - live: the page's own rule says its data is live.
 * Null for a page without live data while online (no claim either way).
 */
export type ConnectionState = 'connecting' | 'live' | 'offline'

export interface ConnectionInput {
  /** The page's LIVE answer; undefined for a page without live data. */
  live: boolean | undefined
  /** No answer yet (no data and no error) for the page's live data. */
  pending?: boolean
  /** useOnline(): false once a request has failed or the browser is offline. */
  online: boolean
}

export function connectionState({ live, pending = false, online }: ConnectionInput): ConnectionState | null {
  if (!online) return 'offline'
  if (pending) return 'connecting'
  if (live === undefined) return null
  return live ? 'live' : 'offline'
}
