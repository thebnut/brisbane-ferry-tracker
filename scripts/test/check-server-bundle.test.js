import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { findMapLibre } from '../check-server-bundle.mjs'

/** A fake build/server tree from { path: content }. */
function tree(files) {
  const root = mkdtempSync(join(tmpdir(), 'bft-server-'))
  for (const [p, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true })
    writeFileSync(join(root, p), content)
  }
  return root
}
const bad = (files) => {
  const root = tree(files)
  try {
    return findMapLibre(root).bad.map((f) => f.slice(root.length + 1))
  } finally {
    rmSync(root, { recursive: true })
  }
}

test('passes a server build whose comments merely mention MapLibre', () => {
  assert.deepEqual(
    bad({
      'index.js': '/** MapLibre is stubbed out of the Worker; this module never imports maplibre-gl statically. */',
      'assets/SafeMap-x.js': '// MapLibre 6 needs WebGL2\nexport const a = 1',
      'assets/SafeMap-x.js.map': '{"sourcesContent":["// never imports maplibre-gl statically"]}',
    }),
    [],
  )
})

test('catches the library bundled in, its worker asset, its styles and imports of it', () => {
  assert.deepEqual(
    bad({
      'assets/OnboardingPicker-a.js': '//#region ../../node_modules/.pnpm/maplibre-gl@6.14.0/node_modules/maplibre-gl/dist/maplibre-gl.mjs',
      'assets/maplibre-gl-worker-b.mjs': 'self.onmessage=()=>{}',
      'assets/style.css': '.maplibregl-map{overflow:hidden}.maplibregl-canvas{position:absolute}',
      'assets/index.js': 'import { Map } from "maplibre-gl";',
      'assets/lazy.js': 'const m = await import("maplibre-gl/dist/maplibre-gl.mjs")',
      'assets/licence.js': '/**\n * MapLibre GL JS\n * @license 3-Clause BSD */',
      'assets/fine.js': 'export const x = "maplibre-gl is never on the server"',
    }).sort(),
    [
      'assets/OnboardingPicker-a.js',
      'assets/index.js',
      'assets/lazy.js',
      'assets/licence.js',
      'assets/maplibre-gl-worker-b.mjs',
      'assets/style.css',
    ],
  )
})
