/**
 * P6: every page of each standalone app (its routes.ts) redirects to a page BrisbaneTransit actually has, so a
 * redirected URL never lands on transit's 404. Table-driven over the routes files, so a new mode route without a
 * mapping fails here.
 */
import busRoutes from '@bft/bus/app/routes.ts'
import ferryRoutes from '@bft/ferry/app/routes.ts'
import trainRoutes from '@bft/train/app/routes.ts'
import { type RedirectMode, transitPath } from '@bft/ui/redirect'
import { describe, expect, it } from 'vitest'
import transitRoutes from '../app/routes.ts'

interface RouteEntry {
  path?: string
  index?: boolean
  children?: RouteEntry[]
}

/** Full path patterns of a route config ('' for an index route of the root). */
function paths(entries: readonly RouteEntry[], parent = ''): string[] {
  return entries.flatMap((e) => {
    const here = e.path ? `${parent}/${e.path}`.replace(/\/+/g, '/') : parent
    const own = e.index || e.path ? [here || '/'] : []
    return [...own, ...(e.children ? paths(e.children, here) : [])]
  })
}

const sample = (pattern: string) => pattern.replace(/:[^/]+/g, 'x1')
const toRegExp = (pattern: string) => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}$`)
const TRANSIT = paths(transitRoutes as RouteEntry[]).filter((p) => !p.includes('*'))
const onTransit = (path: string) => TRANSIT.some((p) => toRegExp(p).test(path))

const APPS: [RedirectMode, readonly RouteEntry[]][] = [
  ['ferry', ferryRoutes as RouteEntry[]],
  ['train', trainRoutes as RouteEntry[]],
  ['bus', busRoutes as RouteEntry[]],
]

describe.each(APPS)('%s routes.ts → transit', (mode, routes) => {
  const pages = paths(routes).filter((p) => !p.includes('*'))

  it('has pages to check', () => {
    expect(pages.length).toBeGreaterThan(3)
  })

  it.each(pages)('%s', (pattern) => {
    const to = transitPath(mode, sample(pattern))
    expect(to).not.toBeNull()
    expect(onTransit(to ?? ''), `${pattern} → ${to}`).toBe(true)
    if (pattern === '/feedback') expect(to).toBe('/feedback')
    else if (pattern === '/') expect(to).toBe(`/${mode}`)
    // A page of its own on transit, not the fallback home.
    else expect(to).toBe(`/${mode}${sample(pattern)}`)
  })

  it('an unknown path goes to the mode home on transit', () => {
    expect(transitPath(mode, '/no/such/page')).toBe(`/${mode}`)
    expect(onTransit(`/${mode}`)).toBe(true)
  })
})
