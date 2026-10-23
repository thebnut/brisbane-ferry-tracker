// @vitest-environment jsdom
/**
 * R32-RT1 (Codex r3): the train Shell adds its boards' reports up. A board still waiting (its first answer, or a
 * non-live seed's refetch) makes the page "Connecting…" only while every other board is waiting too or live with
 * nothing failed: a board whose request failed, even with live data from before it still on screen, wins.
 */
import { cleanup, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { Shell, useReportLive } from '../app/components/Chrome.tsx'

type Board = { live: boolean; pending?: boolean; failed?: boolean }

function Report({ id, live, pending, failed }: Board & { id: string }) {
  useReportLive(id, live, pending, failed)
  return null
}

function page(boards: Board[]) {
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <Shell active="stations" live>
          {boards.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list.
            <Report key={i} id={`b${i}`} {...b} />
          ))}
        </Shell>
      ),
    },
  ])
  render(<RouterProvider router={router} />)
  const header = screen.getByRole('banner')
  return {
    connecting: header.querySelector('[data-connection=connecting]') != null,
    live: header.querySelector('[data-live-claim]') != null,
    offline: header.textContent?.includes('OFFLINE') ?? false,
  }
}

afterEach(cleanup)

const waiting = { live: false, pending: true }
const live = { live: true }

describe('train Shell: pending across boards (R32-RT1)', () => {
  it('Connecting… while a board waits and every other waits or is live', () => {
    expect(page([waiting])).toMatchObject({ connecting: true, live: false, offline: false })
    cleanup()
    expect(page([waiting, live]).connecting).toBe(true)
    cleanup()
    expect(page([waiting, waiting]).connecting).toBe(true)
  })
  it("a waiting board never hides another's failure", () => {
    // A board whose own answer isn't live.
    expect(page([waiting, { live: false }])).toMatchObject({ connecting: false, offline: true })
    cleanup()
    // Live data still on screen from before a failed (or retried) request.
    expect(page([waiting, { live: true, failed: true }])).toMatchObject({ connecting: false, offline: true })
    cleanup()
    // A failure is never pending itself, even while retried with nothing to show.
    expect(page([waiting, { live: false, pending: true, failed: true }])).toMatchObject({ connecting: false })
  })
  it('live data from before a failed request stays LIVE on its own, as before', () => {
    expect(page([{ live: true, failed: true }])).toMatchObject({
      connecting: false,
      live: true,
      offline: false,
    })
  })
})
