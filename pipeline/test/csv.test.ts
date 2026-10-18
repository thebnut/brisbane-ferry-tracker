import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CsvError, parseCsvObjects, streamCsv } from '../src/feed/csv.ts'
import { loadFeed, parseTime } from '../src/feed/load.ts'
import { baseFeed, writeFeed } from './synth.ts'

describe('csv', () => {
  it('handles quotes, escaped quotes, commas, CRLF, BOM and blank lines', () => {
    const rows = parseCsvObjects('﻿a,b,c\r\n1,"x, ""y""",3\r\n\r\n"",,"multi\nline"\n')
    expect(rows).toEqual([
      { a: '1', b: 'x, "y"', c: '3' },
      { a: '', b: '', c: 'multi\nline' },
    ])
  })

  it('streams identically regardless of chunk boundaries', async () => {
    const text = `id,name\n${Array.from({ length: 5000 }, (_, i) => `${i},"n ""${i}"", x"`).join('\r\n')}`
    const p = join(await mkdtemp(join(tmpdir(), 'bft-csv-')), 'f.txt')
    await writeFile(p, text)
    const got: string[][] = []
    const n = await streamCsv(
      p,
      () => {},
      (f) => got.push(f),
    )
    expect(n).toBe(5000)
    expect(got[4321]).toEqual(['4321', 'n "4321", x'])
  })

  it('rejects an unterminated quoted field', () => {
    expect(() => parseCsvObjects('a\n"open')).toThrow(CsvError)
  })

  it('parses GTFS times, including past 24:00', () => {
    expect(parseTime('25:10:05')).toBe(25 * 3600 + 10 * 60 + 5)
    expect(parseTime(' 7:00:00')).toBe(7 * 3600)
    expect(parseTime('')).toBe(-1)
    expect(parseTime('7:61:00')).toBe(-2)
    expect(parseTime('noon')).toBe(-2)
  })
})

describe('loadFeed', () => {
  it('groups interleaved stop_times by trip, sorts by stop_sequence and keeps file order ranks', async () => {
    const f = baseFeed()
    const st = f['stop_times.txt'] as string[][]
    const header = st[0] as string[]
    const body = st.slice(1)
    // Reverse every row: trips are now interleaved with others and each trip's rows run backwards.
    f['stop_times.txt'] = [header, ...body.reverse()]
    const feed = await loadFeed(await writeFeed(f))
    const t = feed.trips.find((x) => x.id === 'F1-0')
    expect(t?.count).toBe(4)
    const seqs = Array.from(feed.stopTimes.seq.subarray(t?.start, (t?.start ?? 0) + (t?.count ?? 0)))
    expect(seqs).toEqual([10, 20, 30, 40])
    const ranks = Array.from(feed.stopTimes.fileRank.subarray(t?.start, (t?.start ?? 0) + (t?.count ?? 0)))
    expect(ranks).toEqual([3, 2, 1, 0])
  })

  it('interpolates blank non-timepoint times', async () => {
    const f = baseFeed()
    const row = (f['stop_times.txt'] as string[][]).find((r) => r[0] === 'F1-0' && r[4] === '20') as string[]
    row[1] = ''
    row[2] = ''
    const feed = await loadFeed(await writeFeed(f))
    const t = feed.trips.find((x) => x.id === 'F1-0')
    const i = (t?.start ?? 0) + 1
    // Between 06:00 (row 1) and 06:12 (row 3).
    expect(feed.stopTimes.dep[i]).toBe(6 * 3600 + 6 * 60)
  })
})
