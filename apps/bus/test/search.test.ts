import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { type StopIndexEntry, StopIndexFile } from '../app/lib/data-contract.ts'
import { buildSearchIndex, searchStops } from '../app/lib/search.ts'
import fixture from '../fixtures/bus-day.json'

const stops = fixture.stops as StopIndexEntry[]
const index = buildSearchIndex(stops)
const names = (q: string, n = 3) => searchStops(index, q, n).hits.map((h) => h.name)

describe('stop search (fixture stops)', () => {
  it('matches names with a typo', () => {
    expect(names('cultral centre')[0]).toMatch(/^Cultural Centre station, platform/)
    expect(names('king goerge')[0]).toMatch(/^King George Square/)
  })
  it('matches words out of order', () => {
    expect(names('centre cultural')[0]).toMatch(/^Cultural Centre/)
  })
  it('matches stop numbers exactly, with or without leading zeros or "stop"', () => {
    for (const q of ['10802', '010802', 'stop 10802', '#10802']) {
      const r = searchStops(index, q)
      expect(r.exact).toBe(true)
      expect(r.hits[0]?.key).toBe('10802')
    }
    expect(searchStops(index, '99999999').exact).toBe(false)
  })
  it('finds street stops by their stop number in the name', () => {
    expect(names('adelaide 37')[0]).toBe('Adelaide Street Stop 37 near Anzac Square')
  })
  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchStops(index, '  ').hits).toEqual([])
    expect(searchStops(index, 'station', 2).hits).toHaveLength(2)
  })
})

// The full index is built by `pnpm data` (gitignored); these run locally when it exists.
const full = join(__dirname, '../public/data/bus/stops.json')
describe.runIf(existsSync(full))('stop search (full 12k-stop index)', () => {
  // Read lazily: describe bodies run even when the suite is skipped (CI has no built data).
  let file: ReturnType<typeof StopIndexFile.parse>
  let big: ReturnType<typeof buildSearchIndex>
  beforeAll(() => {
    file = StopIndexFile.parse(JSON.parse(readFileSync(full, 'utf8')))
    big = buildSearchIndex(file.stops)
  })
  it('is contract-valid and has every bus stop', () => {
    expect(file.stops.length).toBeGreaterThan(12_000)
  })
  it('ranks the obvious stop first', () => {
    expect(searchStops(big, 'cultural centre').hits[0]?.name).toMatch(/^Cultural Centre station/)
    expect(searchStops(big, 'uq lakes').hits[0]?.name).toMatch(/^UQ Lakes/)
    expect(searchStops(big, 'mater hil').hits[0]?.name).toMatch(/^Mater Hill station/)
    expect(searchStops(big, '1882').hits[0]?.key).toBe('1882')
  })
  it('answers typical queries quickly in Node (the browser p95 is measured by Playwright)', () => {
    const qs = [
      'cu',
      'cul',
      'cult',
      'cultural',
      'cultral centre',
      'king george',
      'adelaide st',
      'gympie rd',
      '10802',
      'griffith uni',
    ]
    const times: number[] = []
    for (let i = 0; i < 5; i++)
      for (const q of qs) {
        const t = performance.now()
        searchStops(big, q)
        times.push(performance.now() - t)
      }
    times.sort((a, b) => a - b)
    expect(times[Math.floor(times.length * 0.95)]).toBeLessThan(25)
  })
})
