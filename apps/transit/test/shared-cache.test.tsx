// @vitest-environment jsdom
/**
 * BrisbaneTransit gives every mounted app one QueryClient (root.tsx), so the apps' query keys must not collide:
 * switching from the Train tab to the Bus tab must not show train alerts (Codex review of #50, finding 1).
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { useAlerts as useBusAlerts } from '@bft/bus/app/lib/queries.ts'
import type { AlertsResponse } from '@bft/core/contract'
import { useAlerts as useTrainAlerts } from '@bft/train/app/lib/queries.ts'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeQueryClient } from '../app/lib/query-client.ts'

const alerts = (header: string): AlertsResponse => ({
  schemaVersion: 1,
  staticGeneration: 'g',
  serviceDates: ['20261020'],
  rtSourceTimestamp: 1,
  rtState: 'live',
  generatedAt: Date.now(),
  alerts: [{ id: header, header, activePeriods: [], routes: [], stops: [], modes: [] }],
})

const LIVE = { fixtures: false, rt: null }
const never = vi.fn(() => new Promise<Response>(() => {}))

function Train() {
  const q = useTrainAlerts(never, LIVE, alerts('train alert'))
  return <p>{q.data?.alerts[0]?.header}</p>
}
function Bus() {
  const q = useBusAlerts(never, LIVE, alerts('bus alert'))
  return <p>{q.data?.alerts[0]?.header}</p>
}

describe('one QueryClient for every tab', () => {
  it('the Bus tab shows bus alerts after the Train tab filled the cache', () => {
    const client = makeQueryClient()
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <Train />
      </QueryClientProvider>,
    )
    expect(screen.getByText('train alert')).toBeInTheDocument()
    rerender(
      <QueryClientProvider client={client}>
        <Bus />
      </QueryClientProvider>,
    )
    expect(screen.getByText('bus alert')).toBeInTheDocument()
  })

  it('every query key in the four apps starts with its app', () => {
    // jsdom gives import.meta.url an http scheme; Vitest runs from apps/transit.
    const apps = join(process.cwd(), '..')
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = join(d, f)
        return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : []
      })
    for (const app of ['ferry', 'train', 'bus', 'transit'])
      for (const file of walk(join(apps, app, 'app')))
        for (const m of readFileSync(file, 'utf8').matchAll(/queryKey(?::| =) \[\s*'([^']+)'/g))
          expect(m[1], `${file}`).toBe(app)
  })
})
