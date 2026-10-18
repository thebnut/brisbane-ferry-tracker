/** Run the original schedule-processor script, unmodified, in a scratch copy and return its latest.json text. */
import { execFile } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const here = import.meta.dirname
const repo = resolve(here, '../../..')

export async function runLegacy(zipPath: string, nowMs: number): Promise<string> {
  // The scratch copy lives under pipeline/.tmp so its imports (jszip, papaparse, date-fns, date-fns-tz) resolve to
  // the pipeline's devDependencies, pinned to the schedule-processor lockfile versions. The script writes to
  // ../schedule-data next to itself, i.e. inside the scratch dir, never the repo's schedule-data/.
  await mkdir(resolve(repo, 'pipeline/.tmp'), { recursive: true })
  const root = await mkdtemp(resolve(repo, 'pipeline/.tmp/legacy-'))
  try {
    await mkdir(join(root, 'schedule-processor'))
    await copyFile(
      join(repo, 'schedule-processor/process-schedule.js'),
      join(root, 'schedule-processor/process-schedule.js'),
    )
    await promisify(execFile)(
      process.execPath,
      [
        '--max-old-space-size=8192',
        '--import',
        join(here, 'preload.mjs'),
        join(root, 'schedule-processor/process-schedule.js'),
      ],
      {
        env: { ...process.env, TZ: 'UTC', LEGACY_ZIP: resolve(zipPath), LEGACY_NOW: String(nowMs) },
        maxBuffer: 64 << 20,
      },
    )
    return await readFile(join(root, 'schedule-data/latest.json'), 'utf8')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
