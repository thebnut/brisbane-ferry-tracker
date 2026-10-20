// @vitest-environment jsdom
/**
 * /route/:route whose route file can't be read (the loader's 503: R2 slow): the page says so with a Try again that
 * reruns the loader, never the app's "Something went wrong"; any other error still goes to the parent boundary.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRoutesStub, data, Outlet } from 'react-router'
import { describe, expect, it } from 'vitest'
import { ErrorBoundary } from '../app/routes/route.tsx'

function stub(loader: () => unknown) {
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
          loader,
          Component: () => <p>Route 333 stops</p>,
          ErrorBoundary: ErrorBoundary as never,
        },
      ],
    },
  ])
  render(<Stub initialEntries={['/route/333']} />)
}

describe('route page ErrorBoundary', () => {
  it('a 503 says the route could not load, and Try again reruns the loader', async () => {
    let fail = true
    stub(() => {
      if (fail) throw data(null, { status: 503 })
      return null
    })
    expect(await screen.findByText("Couldn't load this route")).toBeTruthy()
    expect(screen.queryByText('Something went wrong')).toBeNull()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Route 333 stops')).toBeTruthy()
  })

  it('any other error goes on to the parent boundary', async () => {
    stub(() => {
      throw data(null, { status: 500 })
    })
    expect(await screen.findByText('Something went wrong')).toBeTruthy()
  })
})
