/**
 * What a crawler gets from the server HTML, with no JavaScript (the Worker in workerd, fixture data): the bus stop
 * directory and the landing page's popular places as real links, the old bare paths and trailing-slash duplicates as
 * one 301 to the canonical URL, /llms.txt as plain text, and a non-production deploy saying noindex in its HTML.
 */
import { expect, test } from '@playwright/test'

test.beforeEach(() => {
  test.skip(test.info().project.name !== 'phone', 'server HTML: once')
})

const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1] as string)

test('bus stop directory: the A–Z page links every letter, a letter page every stop, from the server HTML', async ({
  request,
}) => {
  const index = await request.get('/bus/stops')
  expect(index.status()).toBe(200)
  const html = await index.text()
  expect(html).toContain('<h1')
  expect(html).toContain('Brisbane bus stops A–Z')
  expect(html).toMatch(/<link rel="canonical" href="[^"]+\/bus\/stops"\/>/)
  const letters = hrefs(html).filter((h) => /^\/bus\/stops\/[a-z0-9-]+$/.test(h))
  expect(letters.length).toBeGreaterThan(3)
  // Fixture stops: "Mollison St …", "Wickham St …", "Montague Rd …".
  expect(letters).toContain('/bus/stops/m')
  const m = await (await request.get('/bus/stops/m')).text()
  const stops = hrefs(m).filter((h) => /^\/bus\/stop\/\d+$/.test(h))
  expect(stops).toContain('/bus/stop/10079')
  expect(stops).toContain('/bus/stop/1045')
  expect(m).toMatch(/<title>Bus stops: M \| Brisbane Transit<\/title>/)
  // No fixture stop name starts with X.
  expect((await request.get('/bus/stops/x')).status()).toBe(404)
})

test('bus home links the directory; the landing page links popular terminals, stations and stops', async ({
  request,
}) => {
  expect(hrefs(await (await request.get('/bus/')).text())).toContain('/bus/stops')
  const home = hrefs(await (await request.get('/')).text())
  for (const h of [
    '/ferry/terminal/south-bank',
    '/ferry/terminal/riverside',
    '/train/station/central',
    '/train/station/roma-street',
    '/bus/stop/10802',
    '/train/stations',
    '/bus/stops',
  ])
    expect(home, h).toContain(h)
})

test('old bare paths and trailing slashes: one 301 to the canonical URL, query kept', async ({ request }) => {
  const cases: [from: string, to: string][] = [
    ['/terminal/south-bank?utm_source=chatgpt.com', '/ferry/terminal/south-bank?utm_source=chatgpt.com'],
    ['/station/central', '/train/station/central'],
    ['/stop/000001', '/bus/stop/1'],
    ['/ferry/terminal/south-bank/', '/ferry/terminal/south-bank'],
    ['/whats-new/', '/whats-new'],
    ['/bus/stops/', '/bus/stops'],
    ['/bus', '/bus/'],
  ]
  for (const [from, to] of cases) {
    const res = await request.get(from, { maxRedirects: 0 })
    expect(res.status(), from).toBe(301)
    const location = new URL(res.headers().location ?? '', 'http://x.test')
    expect(location.pathname + location.search, from).toBe(to)
  }
})

test('/llms.txt is plain text naming the sections', async ({ request }) => {
  const res = await request.get('/llms.txt')
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('text/plain; charset=utf-8')
  const body = await res.text()
  expect(body).toMatch(/^# Brisbane Transit\n/)
  expect(body).toContain('/ferry/terminal/south-bank)')
})

test('not production (INDEXABLE unset): every page says noindex in the HTML as well as the header', async ({
  request,
}) => {
  for (const path of ['/', '/ferry/', '/bus/stops']) {
    const res = await request.get(path)
    expect(res.headers()['x-robots-tag'], path).toBe('noindex')
    expect(await res.text(), path).toContain('<meta name="robots" content="noindex" data-deploy-noindex="">')
  }
})
