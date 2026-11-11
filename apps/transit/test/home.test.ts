// @vitest-environment node
/** The landing page (/, release 24): indexable, canonical on this site, and a way into every tab. */
import { describe, expect, it } from 'vitest'
import { HOME_DESCRIPTION, HOME_TITLE, meta, SECTIONS } from '../app/routes/home.tsx'
import routes from '../app/routes.ts'

type Meta = Record<string, unknown>[]
// biome-ignore lint/suspicious/noExplicitAny: meta takes the route's generated arg type.
const metaFor = (siteUrl: string) => (meta as (args: any) => Meta)({ loaderData: { siteUrl } })

describe('landing page', () => {
  it('is indexable: a canonical on this site and no robots noindex', () => {
    const m = metaFor('https://brisbanetransit.com')
    expect(m.find((t) => t.rel === 'canonical')?.href).toBe('https://brisbanetransit.com/')
    expect(m.find((t) => t.name === 'robots')).toBeUndefined()
    expect(m.find((t) => 'title' in t)?.title).toBe(HOME_TITLE)
    expect(m.find((t) => t.name === 'description')?.content).toBe(HOME_DESCRIPTION)
    expect(m.find((t) => t.property === 'og:url')?.content).toBe('https://brisbanetransit.com/')
    expect(m.find((t) => t.property === 'og:image')?.content).toBe('https://brisbanetransit.com/og-image.jpg')
  })

  it('has a search-length title and description', () => {
    expect(HOME_TITLE.length).toBeLessThanOrEqual(65)
    expect(HOME_DESCRIPTION.length).toBeGreaterThan(70)
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(165)
  })

  it('links into ferry, train, bus, nearby and My Transit', () => {
    expect(SECTIONS.map((s) => s.href)).toEqual(['/ferry', '/train', '/bus', '/nearby', '/saved'])
  })

  it('is the index route; My Transit is /saved', () => {
    const layout = (
      routes as { file: string; children?: { index?: boolean; path?: string; file: string }[] }[]
    )[0]
    expect(layout?.children?.find((r) => r.index)?.file).toBe('routes/home.tsx')
    expect(layout?.children?.find((r) => r.path === 'saved')?.file).toBe('routes/saved.tsx')
  })
})
