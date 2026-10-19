#!/usr/bin/env node
/**
 * Prints the short sha of the commit being deployed, for the Workers' x-bft-build header (the deploy:* scripts pass
 * it as `wrangler deploy --var BUILD_SHA:<sha>`). Adds `-dirty` when the checkout has uncommitted or untracked
 * changes, so a deploy from a modified tree never claims a clean commit. Exits non-zero outside a git checkout, which
 * stops the deploy script before anything is built or uploaded. Prints nothing but the sha.
 *
 * It also refuses (non-zero, files named on stderr) when `apps/<app>/public/data` holds anything a commit doesn't:
 * an untracked or git-ignored file (left by `pnpm data`), or a tracked file that is modified, staged or hidden from
 * `git status`. `react-router build` copies all of `public/` into the bundle, and the Workers serve that copy ahead of
 * the live R2 data until the next deploy. `git status --porcelain` alone hides ignored files, so the marker can't
 * catch this.
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Anchored at the repo root (`top`), since the deploy scripts run from apps/<app> or services/edge. `glob` keeps `*`
// to one path segment; the bare pattern catches a `data` file or symlink, the `/**` one everything below it.
const PUBLIC_DATA = [':(top,glob)apps/*/public/data', ':(top,glob)apps/*/public/data/**']

const gitIn =
  (cwd) =>
  (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

export function buildSha(cwd = process.cwd()) {
  const git = gitIn(cwd)
  const sha = git('rev-parse', '--short=7', 'HEAD').trim()
  return git('status', '--porcelain').trim() ? `${sha}-dirty` : sha
}

/** Repo-relative paths under any apps/<app>/public/data that differ from HEAD; empty when the deploy may go ahead. */
export function strayPublicData(cwd = process.cwd()) {
  const git = gitIn(cwd)
  // traditional + all lists every ignored file one by one (matching mode collapses an ignored folder to one entry).
  const status = git(
    'status',
    '--porcelain=v1',
    '-z',
    '--no-renames',
    '--ignored=traditional',
    '--untracked-files=all',
    '--',
    ...PUBLIC_DATA,
  )
  const changed = status
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.slice(3))
  // assume-unchanged (lowercase tag) or skip-worktree (S) tracked files never show in `git status`, edited or not.
  const hidden = git('ls-files', '-v', '-z', '--', ...PUBLIC_DATA)
    .split('\0')
    .filter((entry) => /^([a-z]|S) /.test(entry))
    .map((entry) => entry.slice(2))
  return [...new Set([...changed, ...hidden])].sort()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = buildSha()
  const stray = strayPublicData()
  if (stray.length) {
    process.stderr.write(
      [
        'build-sha: refusing to deploy: apps/*/public/data holds files that are not in the commit, and the build would',
        'bundle them and serve them ahead of the live data:',
        ...stray.map((path) => `  ${path}`),
        'Fix: delete the generated folder (e.g. `rm -rf apps/bus/public/data`), or restore or commit tracked files',
        '(`git restore apps/train/public/data`), then run the deploy again.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
  process.stdout.write(`${sha}\n`)
}
