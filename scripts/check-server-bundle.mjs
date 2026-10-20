#!/usr/bin/env node
/**
 * Fails if an app's server (Worker) build carries MapLibre: maps render only in the browser, and the library's
 * web-worker asset in a Worker bundle has a dangling source map that makes `wrangler deploy` fail (P4, #115).
 * Comments that mention MapLibre are fine; the library's own code and assets are not.
 *
 *   node ../../scripts/check-server-bundle.mjs   (from an app, after `pnpm build`)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'build', 'server')
/** The library's bundled code (its source-region marker or licence header) or its worker asset. */
const CODE = /node_modules[\\/](?:\.pnpm[\\/])?maplibre-gl|\* MapLibre GL JS/
const ASSET = /maplibre/i

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(p)
  }
}
try {
  walk(root)
} catch {
  console.error(`check-server-bundle: no server build at ${root} (run the build first)`)
  process.exit(2)
}
const bad = files.filter(
  (f) => ASSET.test(f.slice(root.length)) || (/\.(m?js)$/.test(f) && CODE.test(readFileSync(f, 'utf8'))),
)
if (bad.length) {
  console.error(`check-server-bundle: MapLibre in the server build:\n  ${bad.join('\n  ')}`)
  process.exit(1)
}
console.log(`check-server-bundle: ${files.length} server files, no MapLibre`)
