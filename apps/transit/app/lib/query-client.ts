/** The QueryClient for every page (root.tsx), kept apart from the transit data hooks so mode pages don't load them. */
import { QueryClient } from '@tanstack/react-query'

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Polling stops while the tab is hidden (TanStack's focus manager watches visibilitychange).
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        retry: 1,
        staleTime: 10_000,
        // Let the service worker's cache answer when the network is down.
        networkMode: 'offlineFirst',
      },
    },
  })
}
