#!/usr/bin/env node
/**
 * Prints the short sha of the commit being deployed, for the Workers' x-bft-build header (the deploy:* scripts pass
 * it as `wrangler deploy --var BUILD_SHA:<sha>`). Adds `-dirty` when the checkout has uncommitted or untracked
 * changes, so a deploy from a modified tree never claims a clean commit. Exits non-zero outside a git checkout, which
 * stops the deploy script before anything is built or uploaded. Prints nothing but the sha.
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function buildSha(cwd = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const sha = git('rev-parse', '--short=7', 'HEAD')
  return git('status', '--porcelain') ? `${sha}-dirty` : sha
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${buildSha()}\n`)
}
