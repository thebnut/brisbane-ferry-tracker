/**
 * legacy/latest.json must match schedule-processor/process-schedule.js exactly (only `generated` may differ). The
 * original script runs unmodified in a scratch copy, on the same feed and pinned instant, with TZ=UTC like GitHub's
 * runners. The real-feed variant runs when BFT_GTFS_ZIP points at a TransLink zip.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { windowDates } from '../src/build/build.ts'
import { buildLegacyLatest } from '../src/build/legacy.ts'
import { loadFeed } from '../src/feed/load.ts'
import { extractZip } from '../src/feed/source.ts'
import { runLegacy } from './legacy/run-legacy.ts'
import { baseFeed, feedZip, NOW, type SynthFeed } from './synth.ts'

const withoutGenerated = (s: string) => s.replace(/^ {2}"generated": "[^"]*",$/m, '')

async function compare(zipPath: string, nowMs: number) {
  const dir = await mkdtemp(join(tmpdir(), 'bft-legacy-'))
  const { dir: feedDir } = await extractZip(zipPath, join(dir, 'x'))
  const { brisbaneDate } = await import('@bft/core')
  const feed = await loadFeed(feedDir, { windowDates: windowDates(brisbaneDate(nowMs)) })
  const ours = buildLegacyLatest(feed, nowMs)
  const theirs = await runLegacy(zipPath, nowMs)
  return { ours, theirs }
}

async function synthZip(feed: SynthFeed) {
  const p = join(await mkdtemp(join(tmpdir(), 'bft-legacy-zip-')), 'feed.zip')
  await writeFile(p, feedZip(feed))
  return p
}

describe('legacy latest.json', () => {
  it('matches the original script on a synthetic feed', async () => {
    const f = baseFeed()
    // A ferry after midnight (24:10 → next calendar day), a calendar_dates addition and removal, odd seconds.
    ;(f['trips.txt'] as string[][]).push(['F1-1', 'WK', 'F1-late', 'Riverside', '1', '', ''])
    ;(f['stop_times.txt'] as string[][]).push(
      ['F1-late', '24:10:30', '24:10:30', '317584', '1', '0', '0'],
      ['F1-late', '24:30:00', '24:30:00', '317590', '2', '0', '0'],
    )
    ;(f['calendar_dates.txt'] as string[][]).push(['WE', '20261021', '1'], ['WK', '20261022', '2'])
    const { ours, theirs } = await compare(await synthZip(f), NOW)
    expect(JSON.parse(ours).departureCount).toBeGreaterThan(20)
    expect(withoutGenerated(ours)).toBe(withoutGenerated(theirs))
  }, 60_000)

  it('matches at a late-evening build instant too', async () => {
    const { ours, theirs } = await compare(await synthZip(baseFeed()), Date.parse('2026-10-20T13:59:59.123Z'))
    expect(withoutGenerated(ours)).toBe(withoutGenerated(theirs))
  }, 60_000)

  const real = process.env.BFT_GTFS_ZIP
  it.skipIf(!real || !existsSync(real))(
    'matches the original script on the real SEQ feed',
    async () => {
      const { ours, theirs } = await compare(real as string, NOW)
      expect(ours.length).toBeGreaterThan(1_000_000)
      expect(withoutGenerated(ours)).toBe(withoutGenerated(theirs))
    },
    600_000,
  )
})
