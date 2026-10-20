// @vitest-environment node
/**
 * P6: the SITE_URL each mounted mode page gets (its canonical, OG and JSON-LD URLs), through the Worker's fetch
 * handler. Production keeps the standalone apps' URLs, byte-identical to before P6; staging and local dev, which
 * have no <MODE>_SITE_URL, point at this site's own page under the mode prefix, whose OG images exist here.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cloudflareContext as busContext } from '@bft/bus/app/lib/context.ts'
import { meta as busStopMeta } from '@bft/bus/app/routes/stop.tsx'
import { cloudflareContext as ferryContext } from '@bft/ferry/app/lib/context.ts'
import { TERMINALS } from '@bft/ferry/app/lib/terminals.ts'
import { meta as ferryHomeMeta } from '@bft/ferry/app/routes/home.tsx'
import { cloudflareContext as trainContext } from '@bft/train/app/lib/context.ts'
import { STATIONS } from '@bft/train/app/lib/network.ts'
import { meta as trainHomeMeta } from '@bft/train/app/routes/home.tsx'
import type { RouterContextProvider } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { unstable_readConfig } from 'wrangler'
import routes from '../app/routes.ts'
import worker from '../workers/app.ts'

let seen: RouterContextProvider | undefined
vi.mock('virtual:react-router/server-build', () => ({}))
vi.mock('react-router', async (orig) => ({
  ...(await orig<typeof import('react-router')>()),
  createRequestHandler: () => async (_request: Request, context: RouterContextProvider) => {
    seen = context
    return new Response('<!doctype html><title>t</title>', { headers: { 'content-type': 'text/html' } })
  },
}))

const CONFIG = fileURLToPath(new URL('../wrangler.jsonc', import.meta.url))
const varsOf = (env?: string) =>
  unstable_readConfig({ config: CONFIG, env }, { hideWarnings: true }).vars as Record<string, string>

/** The SITE_URL the Worker hands each mode's loaders for an env's vars. */
async function siteUrls(vars: Record<string, string>) {
  seen = undefined
  const env = { ...vars, API_BASE: 'http://x' } as unknown as Env
  await worker.fetch(new Request(`${vars.SITE_URL}/ferry`), env, {} as ExecutionContext)
  if (!seen) throw new Error('SSR not reached')
  const ctx = seen
  return {
    ferry: ctx.get(ferryContext).env.SITE_URL,
    train: ctx.get(trainContext).env.SITE_URL,
    bus: ctx.get(busContext).env.SITE_URL,
  }
}

type Meta = Record<string, unknown>[]
// biome-ignore lint/suspicious/noExplicitAny: meta functions take per-route generated arg types.
const call = (fn: (args: any) => unknown, loaderData: unknown) => fn({ loaderData }) as Meta
/** The canonical, og:url, og:image and JSON-LD of three mounted pages, for a SITE_URL per mode. */
function metaFor(urls: { ferry: string; train: string; bus: string }) {
  return {
    ferry: call(ferryHomeMeta, { siteUrl: urls.ferry }),
    train: call(trainHomeMeta, { site: { siteUrl: urls.train, indexable: false } }),
    bus: call(busStopMeta, { stopId: '10802', departures: null, siteUrl: urls.bus }),
  }
}
const canonical = (m: Meta) => m.find((t) => t.rel === 'canonical')?.href
const ogImage = (m: Meta) => m.find((t) => t.property === 'og:image')?.content

describe.each(['production', 'production-preview'])('%s: mode pages keep the standalone sites', (envName) => {
  it('SITE_URLs and meta are what develop rendered before P6', async () => {
    const vars = varsOf(envName)
    const urls = await siteUrls(vars)
    // Develop's expression, before modeSiteUrl.
    const before = {
      ferry: vars.FERRY_SITE_URL ?? vars.SITE_URL,
      train: vars.TRAIN_SITE_URL ?? vars.SITE_URL,
      bus: vars.BUS_SITE_URL ?? vars.SITE_URL,
    }
    expect(urls).toEqual({
      ferry: 'https://www.brisbaneferry.com',
      train: 'https://brisbanetrain.com',
      bus: 'https://brisbanebus.com',
    })
    expect(urls).toEqual(before)
    const m = metaFor(urls)
    expect(JSON.stringify(m)).toBe(JSON.stringify(metaFor(before)))
    expect(canonical(m.ferry)).toBe('https://www.brisbaneferry.com/')
    expect(ogImage(m.ferry)).toBe('https://www.brisbaneferry.com/og-image.jpg')
    expect(canonical(m.train)).toBe('https://brisbanetrain.com/')
    expect(ogImage(m.train)).toBe('https://brisbanetrain.com/icon-512.png')
    expect(canonical(m.bus)).toBe('https://brisbanebus.com/stop/10802')
    expect(ogImage(m.bus)).toBe('https://brisbanebus.com/icon-512.png')
  })
})

describe.each([['staging'], [undefined]])('%s: mode pages link inside transit', (envName) => {
  it('SITE_URL + the mode prefix, and the OG images it names are in public/', async () => {
    const vars = varsOf(envName)
    const T = 'https://bft-transit.brisbanetransit.workers.dev'
    expect(vars.SITE_URL).toBe(T)
    const urls = await siteUrls(vars)
    expect(urls).toEqual({ ferry: `${T}/ferry`, train: `${T}/train`, bus: `${T}/bus` })
    const m = metaFor(urls)
    expect(canonical(m.bus)).toBe(`${T}/bus/stop/10802`)
    for (const meta of [m.ferry, m.train, m.bus]) {
      const image = ogImage(meta) as string
      expect(image.startsWith(`${T}/`)).toBe(true)
      const file = fileURLToPath(new URL(`../public${new URL(image).pathname}`, import.meta.url))
      expect(existsSync(file), image).toBe(true)
    }
  })
})

interface RouteEntry {
  path?: string
  index?: boolean
  file: string
  children?: RouteEntry[]
}
/** Every mounted mode page in transit's routes.ts: its mode and route module file. */
function mounted(entries: readonly RouteEntry[]): { mode: 'ferry' | 'train' | 'bus'; file: string }[] {
  return entries.flatMap((e) => {
    const m = /\.\.\/\.\.\/(ferry|train|bus)\/app\/routes\/(.+)$/.exec(e.file)
    const own = m ? [{ mode: m[1] as 'ferry' | 'train' | 'bus', file: m[2] as string }] : []
    return [...own, ...(e.children ? mounted(e.children) : [])]
  })
}
const PAGES = mounted(routes as RouteEntry[])
const MODULES = import.meta.glob<{ meta?: (args: unknown) => Meta }>(
  '../../{ferry,train,bus}/app/routes/*.tsx',
)

/** Loader data with what each page's meta reads, for a site URL. */
const loaderData = (siteUrl: string) => ({
  siteUrl,
  site: { siteUrl, indexable: false },
  terminal: TERMINALS[0],
  station: STATIONS[0],
  to: null,
  stopId: '10802',
  departures: null,
  route: { short: '66', long: 'RBWH to UQ Lakes' },
  trip: null,
})
/** Every absolute URL a page's meta emits (canonical, og:url, og:image, JSON-LD), other than schema.org's. */
async function urlsOf(mode: string, file: string, siteUrl: string): Promise<string[]> {
  const load = MODULES[`../../${mode}/app/routes/${file}`]
  if (!load) throw new Error(`no module ${mode}/${file}`)
  const { meta } = await load()
  if (!meta) return []
  const out = JSON.stringify(meta({ loaderData: loaderData(siteUrl) }))
  return (out.match(/https?:\/\/[^"\s\\]+/g) ?? []).filter((u) => !u.startsWith('https://schema.org'))
}

describe('every mounted mode page', () => {
  it('covers all of them', () => {
    expect(PAGES.length).toBe(18)
  })

  it.each(['production', 'production-preview', 'staging', undefined])(
    "%s: all meta URLs on the page's site",
    async (envName) => {
      const urls = await siteUrls(varsOf(envName))
      for (const { mode, file } of PAGES) {
        const site = urls[mode]
        const found = await urlsOf(mode, file, site)
        for (const u of found) expect(u.startsWith(`${site}/`), `${mode}/${file}: ${u}`).toBe(true)
        // Pages with SEO tags emit them: not vacuous.
        if (!['trip.tsx'].includes(file) || mode === 'bus')
          expect(found.length, `${mode}/${file}`).toBeGreaterThan(0)
      }
    },
  )
})
