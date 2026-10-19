#!/usr/bin/env node
/**
 * Prints the short sha of the commit being deployed, for the Workers' x-bft-build header (the deploy:* scripts pass
 * it as `wrangler deploy --var BUILD_SHA:<sha>`). Adds `-dirty` when the checkout has uncommitted or untracked
 * changes, so a deploy from a modified tree never claims a clean commit. Exits non-zero outside a git checkout, which
 * stops the deploy script before anything is built or uploaded. Prints nothing but the sha.
 *
 * It also refuses (non-zero, files named on stderr) when `apps/<app>/public/data` holds anything a commit doesn't:
 * an untracked or git-ignored file (left by `pnpm data`), a tracked file that is modified, staged or hidden from
 * `git status`, or a symlink there or at apps/<app>/public (the build follows it to files git can't see).
 * `react-router build` copies all of `public/` into the bundle, and the Workers serve that copy ahead of the live R2
 * data until the next deploy. `git status --porcelain` alone hides ignored files, so the marker can't catch this.
 */
import { execFileSync } from 'node:child_process'
import { lstatSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
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
  const root = gitIn(cwd)('rev-parse', '--show-toplevel').trim()
  // Run at the top: `ls-files` prints paths relative to its cwd, and the deploy scripts run from apps/<app>.
  const git = gitIn(root)
  const entries = (...args) => git(...args, '--', ...PUBLIC_DATA).split('\0').filter(Boolean)
  // traditional + all lists every ignored file one by one (matching mode collapses an ignored folder to one entry).
  const changed = entries('status', '--porcelain=v1', '-z', '--no-renames', '--ignored=traditional', '--untracked-files=all')
    .map((entry) => entry.slice(3))
  // assume-unchanged (lowercase tag) or skip-worktree (S) tracked files never show in `git status`, edited or not.
  const listed = entries('ls-files', '-v', '-z')
  const hidden = listed.filter((entry) => /^([a-z]|S) /.test(entry)).map((entry) => entry.slice(2))
  const tracked = new Set(listed.map((entry) => entry.slice(2)))
  return [...new Set([...changed, ...hidden, ...onDisk(root, tracked)])].sort()
}

/**
 * What git can't see but the build copies: a symlink to a directory at apps/<app> or apps/<app>/public, any symlink at
 * public/data or below (Vite's public copy follows links), and any file there the outer repo doesn't track (one
 * inside a nested repository, which `git status` reports only as the repository's folder).
 */
function onDisk(root, tracked) {
  const found = []
  const lstat = (rel) => {
    try {
      return lstatSync(join(root, rel))
    } catch {
      return null
    }
  }
  const linksToDir = (rel) => {
    try {
      return statSync(join(root, rel)).isDirectory()
    } catch {
      return false
    }
  }
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`
      if (entry.isDirectory()) walk(child)
      else if (entry.isSymbolicLink() || !tracked.has(child)) found.push(child)
    }
  }
  if (lstat('apps')?.isSymbolicLink() && linksToDir('apps')) return ['apps']
  if (!lstat('apps')?.isDirectory()) return found
  for (const app of readdirSync(join(root, 'apps'))) {
    for (const rel of [`apps/${app}`, `apps/${app}/public`, `apps/${app}/public/data`]) {
      const s = lstat(rel)
      if (s?.isSymbolicLink() && (rel.endsWith('/data') || linksToDir(rel))) found.push(rel)
      if (!s?.isDirectory()) break
      if (rel.endsWith('/data')) walk(rel)
    }
  }
  return found
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sha = buildSha()
  const stray = strayPublicData()
  if (stray.length) {
    process.stderr.write(
      [
        'build-sha: refusing to deploy: apps/*/public/data holds files (or symlinks) that are not in the commit, and the',
        'build would bundle them and serve them ahead of the live data:',
        ...stray.map((path) => `  ${path}`),
        'Fix: delete the generated folder (e.g. `rm -rf apps/bus/public/data`), or restore or commit tracked files',
        '(`git restore apps/train/public/data`, clearing any assume-unchanged/skip-worktree flag), replace a symlink with',
        'the real folder, then run the deploy again.',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }
  process.stdout.write(`${sha}\n`)
}
