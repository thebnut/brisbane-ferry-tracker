import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildSha, strayPublicData } from '../build-sha.mjs'

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

// The public/data guard: the deploy stops when apps/<app>/public/data holds anything a commit doesn't.

function dataRepo() {
  const r = repo()
  const put = (path, body = '{}') => {
    mkdirSync(dirname(join(r.dir, path)), { recursive: true })
    writeFileSync(join(r.dir, path), body)
  }
  const commit = (...paths) => {
    r.git('add', '-f', ...paths)
    r.git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'y')
  }
  put('apps/x/.gitignore', 'public/data/\n')
  put('apps/train/public/data/train/stops.json')
  commit('apps/x/.gitignore', 'apps/train/public/data/train/stops.json')
  return { ...r, put, commit }
}

const run = (cwd) => spawnSync('node', [SCRIPT], { cwd, encoding: 'utf8' })

test('public/data guard: a clean checkout with tracked public/data files passes, from any app folder', () => {
  const r = dataRepo()
  try {
    mkdirSync(join(r.dir, 'apps/x/app'), { recursive: true })
    assert.deepEqual(strayPublicData(r.dir), [])
    for (const cwd of [r.dir, join(r.dir, 'apps/x'), join(r.dir, 'apps/x/app')]) {
      const res = run(cwd)
      assert.equal(res.status, 0, res.stderr)
      assert.match(res.stdout, /^[0-9a-f]{7}\n$/)
      assert.equal(res.stderr, '')
    }
  } finally {
    r.done()
  }
})

test('public/data guard: an ignored file under apps/x/public/data stops the deploy and is named', () => {
  const r = dataRepo()
  try {
    r.put('apps/x/public/data/bus/routes/66.json')
    r.put('apps/x/public/data/bus/routes.json')
    // `git status --porcelain` hides ignored files, so the marker alone would still claim a clean commit.
    assert.doesNotMatch(buildSha(r.dir), /-dirty/)
    assert.deepEqual(strayPublicData(r.dir), ['apps/x/public/data/bus/routes.json', 'apps/x/public/data/bus/routes/66.json'])
    const res = run(join(r.dir, 'apps/x'))
    assert.equal(res.status, 1)
    assert.equal(res.stdout, '')
    assert.match(res.stderr, /apps\/x\/public\/data\/bus\/routes\/66\.json/)
    assert.match(res.stderr, /rm -rf apps\/bus\/public\/data/)
  } finally {
    r.done()
  }
})

test('public/data guard: untracked, modified, staged and assume-unchanged files also stop it', () => {
  const r = dataRepo()
  try {
    r.put('apps/y/public/data/n.json')
    assert.deepEqual(strayPublicData(r.dir), ['apps/y/public/data/n.json'])
    rmSync(join(r.dir, 'apps/y'), { recursive: true })

    r.put('apps/train/public/data/train/stops.json', '{"edited":1}')
    assert.deepEqual(strayPublicData(r.dir), ['apps/train/public/data/train/stops.json'])
    r.git('update-index', '--assume-unchanged', 'apps/train/public/data/train/stops.json')
    assert.deepEqual(strayPublicData(r.dir), ['apps/train/public/data/train/stops.json'])
    // Named from the repo root even when run from an app folder, as the deploy scripts do.
    assert.deepEqual(strayPublicData(join(r.dir, 'apps/train')), ['apps/train/public/data/train/stops.json'])
    r.git('update-index', '--no-assume-unchanged', 'apps/train/public/data/train/stops.json')
    r.git('checkout', '--', 'apps/train/public/data/train/stops.json')

    r.put('apps/train/public/data/train/lines.json')
    r.git('add', 'apps/train/public/data/train/lines.json')
    assert.deepEqual(strayPublicData(r.dir), ['apps/train/public/data/train/lines.json'])
  } finally {
    r.done()
  }
})

test('public/data guard: files outside apps/*/public/data do not trip it (they only mark the sha -dirty)', () => {
  const r = dataRepo()
  try {
    r.put('apps/x/public/database.json')
    r.put('apps/x/public/icons/data/a.png')
    r.put('apps/x/app/public/data/a.json')
    r.put('services/edge/public/data/a.json')
    r.put('public/data/a.json')
    r.put('apps/x/build/client/data/bus/routes.json')
    assert.deepEqual(strayPublicData(r.dir), [])
    const res = run(r.dir)
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout, /^[0-9a-f]{7}-dirty\n$/)
  } finally {
    r.done()
  }
})

test('public/data guard: a symlink at or below apps/<app>/public/data, or at public, stops it even when committed', () => {
  for (const link of ['apps/x/public/data/bus', 'apps/x/public/data', 'apps/x/public']) {
    const r = dataRepo()
    const outside = mkdtempSync(join(tmpdir(), 'build-sha-target-'))
    try {
      writeFileSync(join(outside, 'routes.json'), '{}')
      mkdirSync(dirname(join(r.dir, link)), { recursive: true })
      symlinkSync(outside, join(r.dir, link))
      r.commit(link)
      assert.equal(r.git('status', '--porcelain', '--ignored', '--untracked-files=all'), '')
      assert.deepEqual(strayPublicData(r.dir), [link], link)
      assert.equal(run(r.dir).status, 1)
    } finally {
      r.done()
      rmSync(outside, { recursive: true, force: true })
    }
  }
})

test('public/data guard: a file symlink directly under apps/ is not an app and does not block a deploy', () => {
  const r = dataRepo()
  try {
    r.put('README.md', 'x')
    symlinkSync('../README.md', join(r.dir, 'apps/README.md'))
    r.commit('README.md', 'apps/README.md')
    assert.deepEqual(strayPublicData(r.dir), [])
    assert.equal(run(r.dir).status, 0)
  } finally {
    r.done()
  }
})

test('public/data guard: data inside a nested repository at the app, public or data level stops it', () => {
  for (const [nested, file] of [
    ['apps/example', 'apps/example/public/data/bus/routes.json'],
    ['apps/x/public', 'apps/x/public/data/bus/routes.json'],
    ['apps/x/public/data', 'apps/x/public/data/bus/routes.json'],
  ]) {
    const r = dataRepo()
    try {
      r.put(file)
      execFileSync('git', ['init', '-q'], { cwd: join(r.dir, nested) })
      assert.ok(strayPublicData(r.dir).includes(file), nested)
      assert.equal(run(r.dir).status, 1)
    } finally {
      r.done()
    }
  }
})
