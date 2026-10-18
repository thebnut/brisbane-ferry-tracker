/** The CLI contract the workflow relies on: exit 0 published, 2 structural failure, 3 quarantined. */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baseFeed, feedZip, writeFeed } from './synth.ts'

const cli = resolve(import.meta.dirname, '../src/cli.ts')
const run = (...args: string[]) =>
  spawnSync(
    process.execPath,
    ['--experimental-transform-types', '--disable-warning=ExperimentalWarning', cli, ...args],
    {
      encoding: 'utf8',
    },
  )
const NOW = '2026-10-19T17:15:00Z'

describe('cli', () => {
  it('builds from a zip, then quarantines a large swing, then accepts it', async () => {
    const work = await mkdtemp(join(tmpdir(), 'bft-cli-'))
    const zip = join(work, 'feed.zip')
    await writeFile(zip, feedZip(baseFeed()))
    const out = join(work, 'out')
    const ok = run('build', '--gtfs', zip, '--out', out, '--now', NOW, '--work-dir', join(work, 'w1'))
    expect(ok.status, ok.stderr).toBe(0)
    expect(ok.stdout).toMatch(/"zipSha256": "[0-9a-f]{64}"/)

    const f = baseFeed()
    f['trips.txt'] = (f['trips.txt'] as string[][]).filter(
      (r) => !String(r[2]).startsWith('B66') && r[2] !== 'B400-loop',
    )
    f['stop_times.txt'] = (f['stop_times.txt'] as string[][]).filter(
      (r) => !String(r[0]).startsWith('B66') && r[0] !== 'B400-loop',
    )
    const swung = await writeFeed(f)
    const q = run('build', '--gtfs', swung, '--out', out, '--now', NOW)
    expect(q.status).toBe(3)
    expect(q.stderr).toMatch(/QUARANTINED bus/)
    expect(existsSync(join(out, 'manifest.staging.json'))).toBe(true)
    const gen = /QUARANTINED bus (\S+):/.exec(q.stderr)?.[1] as string

    const accepted = run('build', '--gtfs', swung, '--out', out, '--now', NOW, '--accept', gen)
    expect(accepted.status, accepted.stderr).toBe(0)
  }, 60_000)

  it('exits 2 on structural corruption', async () => {
    const dir = await writeFeed(baseFeed())
    await rm(join(dir, 'routes.txt'))
    const r = run('build', '--gtfs', dir, '--out', join(dir, 'out'), '--now', NOW)
    expect(r.status).toBe(2)
    expect(r.stderr).toMatch(/STRUCTURAL FAILURE[\s\S]*missing routes.txt/)
    expect(existsSync(join(dir, 'out', 'manifest.json'))).toBe(false)
  })

  it('publishes a build directory to an assets layout', async () => {
    const dir = await writeFeed(baseFeed())
    const out = join(dir, 'out')
    expect(run('build', '--gtfs', dir, '--out', out, '--now', NOW).status).toBe(0)
    const p = run('publish', '--from', out, '--target', 'assets', '--to', join(dir, 'assets'))
    expect(p.status, p.stderr).toBe(0)
    expect(existsSync(join(dir, 'assets', '_headers'))).toBe(true)
  })
})
