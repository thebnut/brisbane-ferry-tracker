// @vitest-environment jsdom
/**
 * /route/:route whose route file can't be read: the loader returns a 503 page state (route-pages.test.ts), and the
 * page says so with a Try again that reruns the loader, never the app's "Something went wrong".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRoutesStub, data, Outlet } from 'react-router'
import { describe, expect, it } from 'vitest'
import RoutePage from '../app/routes/route.tsx'

describe('route page without its route file', () => {
  it('says the route could not load; Try again reruns the loader and shows the route', async () => {
    let fail = true
    const client = new QueryClient()
    const Stub = createRoutesStub([
      {
        path: '/',
        Component: () => (
          <QueryClientProvider client={client}>
            <Outlet />
          </QueryClientProvider>
        ),
        ErrorBoundary: () => <p>Something went wrong</p>,
        children: [
          {
            path: 'route/:route',
            loader: () =>
              fail
                ? data({ route: null, renderedAt: 0, siteUrl: '' }, { status: 503 })
                : {
                    route: {
                      short: '333',
                      patterns: [{ directionId: 0, headsign: 'Kippa-Ring', trips: 9, stops: [] }],
                    },
                    renderedAt: 0,
                    siteUrl: '',
                  },
            Component: RoutePage as never,
          },
        ],
      },
    ])
    render(<Stub initialEntries={['/route/333']} />)
    expect(await screen.findByText("Couldn't load this route")).toBeTruthy()
    expect(screen.queryByText('Something went wrong')).toBeNull()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/Kippa-Ring/)).toBeTruthy()
    expect(screen.queryByText("Couldn't load this route")).toBeNull()
  })
})
