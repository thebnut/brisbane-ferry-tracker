import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSha } from '../build-sha.mjs'

const SCRIPT = fileURLToPath(new URL('../build-sha.mjs', import.meta.url))

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'build-sha-'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  git('init', '-q')
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'x')
  return { dir, git, done: () => rmSync(dir, { recursive: true, force: true }) }
}

test('build-sha prints the 7-character short sha of HEAD, and nothing else', () => {
  const r = repo()
  try {
    const head = r.git('rev-parse', 'HEAD')
    assert.equal(buildSha(r.dir), head.slice(0, 7))
    assert.equal(execFileSync('node', [SCRIPT], { cwd: r.dir, encoding: 'utf8' }), `${head.slice(0, 7)}\n`)
  } finally {
    r.done()
  }
})

test('build-sha appends -dirty for uncommitted or untracked changes', () => {
  const r = repo()
  try {
    writeFileSync(join(r.dir, 'new.txt'), 'x')
    assert.match(buildSha(r.dir), /^[0-9a-f]{7}-dirty$/)
  } finally {
    r.done()
  }
})

test('build-sha fails outside a git checkout, so the deploy script stops', () => {
  const dir = mkdtempSync(join(tmpdir(), 'build-sha-nogit-'))
  try {
    assert.throws(() =>
      execFileSync('node', [SCRIPT], { cwd: dir, stdio: 'pipe', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } }),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
