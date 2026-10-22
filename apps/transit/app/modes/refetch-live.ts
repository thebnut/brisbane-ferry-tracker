/** Refresh for a status line whose page has no refresh of its own (train station, bus route; THE-118 PR 2). */
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

/**
 * Live data in the query cache: responses with a `generatedAt`, as @bft/ui/connectivity tells them apart, and queries
 * still without an answer (a failed first request), so Refresh retries those too.
 */
const isLiveQuery = (q: { state: { data: unknown } }) => {
  const data = q.state.data as { generatedAt?: unknown } | undefined
  return data == null || typeof data.generatedAt === 'number'
}

/** Refetches every live query on the page; `refreshing` until they have all answered. */
export function useRefetchLive(): { refresh: () => void; refreshing: boolean } {
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  return {
    refreshing,
    refresh: () => {
      setRefreshing(true)
      void client
        .refetchQueries({ type: 'active', predicate: isLiveQuery })
        .finally(() => setRefreshing(false))
    },
  }
}
