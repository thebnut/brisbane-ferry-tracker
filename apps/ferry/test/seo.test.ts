import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildTerminalData, terminalMeta as legacyMeta } from '../../../src/utils/terminalPage.js'
import {
  TERMINALS as LEGACY,
  SITE_URL as LEGACY_SITE,
  terminalPath as legacyPath,
} from '../../../src/utils/terminals.js'
import { pageMeta, SITE_URL, sitemapXml, terminalJsonLd, terminalMeta } from '../app/lib/seo.ts'
import { terminalBySlug } from '../app/lib/terminals.ts'

describe('SEO parity with the legacy postbuild', () => {
  it('sitemap has the same URLs in the same order', () => {
    const xml = sitemapXml(SITE_URL, Date.UTC(2026, 9, 18, 3))
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
    const legacy = [
      `${LEGACY_SITE}/`,
      ...LEGACY.map((t: { slug: string }) => `${LEGACY_SITE}${legacyPath(t.slug)}`),
      `${LEGACY_SITE}/privacy`,
      `${LEGACY_SITE}/terms`,
    ]
    expect(locs).toEqual(legacy)
    expect(xml).toContain('<lastmod>2026-10-18</lastmod>')
  })
  it('terminal canonical, title and description match the legacy format', () => {
    const t = terminalBySlug('bulimba')
    if (!t) throw new Error('missing')
    const m = terminalMeta(t)
    expect(m.url).toBe('https://www.brisbaneferry.com/terminal/bulimba')
    expect(m.title).toBe('Next ferry from Bulimba - live CityCat times | Brisbane Ferry')
    expect(m.description).toBe(
      "Live ferry departures and today's timetable for Bulimba ferry terminal, Brisbane. Routes F1, F11 and F21. Real-time CityCat updates and nearby terminals.",
    )
    const ld = terminalJsonLd(t, m)
    expect(ld['@graph'][0]).toMatchObject({ '@type': 'BoatTerminal', name: 'Bulimba ferry terminal' })
    const tags = pageMeta(m)
    expect(tags).toContainEqual({ tagName: 'link', rel: 'canonical', href: m.url })
    expect(tags).toContainEqual({ property: 'og:url', content: m.url })
  })
})

describe('terminal meta for every terminal', () => {
  // A weekday's schedule-data/latest.json, trimmed (scripts/seo-schedule-fixture.mjs), not the repo's live copy: main
  // rewrites that daily, and on weekend data (no F11 or F12) the legacy build lists fewer routes than the app's week.
  it('matches the legacy build from a weekday schedule snapshot (title, description, canonical)', () => {
    const schedule = JSON.parse(
      readFileSync(new URL('./fixtures/seo-schedule.json', import.meta.url), 'utf8'),
    )
    const data = buildTerminalData(schedule, new Date(schedule.generated ?? Date.now()))
    const diffs: string[] = []
    for (const legacy of LEGACY) {
      const ours = terminalMeta(terminalBySlug(legacy.slug) as NonNullable<ReturnType<typeof terminalBySlug>>)
      const want = legacyMeta(legacy, data.get(legacy.id))
      for (const k of ['title', 'description', 'url'] as const) {
        if (ours[k] !== want[k]) diffs.push(`${legacy.slug}.${k}: ${ours[k]} != ${want[k]}`)
      }
    }
    expect(diffs).toEqual([])
  })
})
