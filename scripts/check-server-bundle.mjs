#!/usr/bin/env node
/**
 * Fails if an app's server (Worker) build carries MapLibre: maps render only in the browser, and the library's
 * web-worker asset in a Worker bundle has a dangling source map that makes `wrangler deploy` fail (P4, #115).
 * Comments that mention MapLibre are fine; the library's code, styles, assets and imports of it are not.
 *
 *   node ../../scripts/check-server-bundle.mjs   (from an app, after `pnpm build`)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * What only MapLibre itself leaves in a file: its bundled source region or licence header, its stylesheet's
 * classes, or a module importing the package (left external). Text files only; source maps included.
 */
const SIGNATURES = [
  /node_modules[\\/](?:\.pnpm[\\/][^\\/]*[\\/]node_modules[\\/])?maplibre-gl[\\/]/,
  /\* MapLibre GL JS/,
  /\.maplibregl-(?:map|canvas|ctrl)\b/,
  /\bfrom\s*["']maplibre-gl(?:\/[^"']*)?["']/,
  /\bimport\s*\(?\s*["']maplibre-gl(?:\/[^"']*)?["']/,
  /\brequire\(\s*["']maplibre-gl(?:\/[^"']*)?["']\)/,
]
const TEXT = /\.(?:m?js|cjs|css|json|map|html|txt)$/
/** An asset named after the library (its worker, stylesheet or code split out under its own name). */
const ASSET = /maplibre/i

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** The files under `root` that carry MapLibre, and how many files were checked. */
export function findMapLibre(root) {
  const files = walk(root)
  const bad = files.filter((f) => {
    if (ASSET.test(relative(root, f))) return true
    if (!TEXT.test(f)) return false
    const text = readFileSync(f, 'utf8')
    return SIGNATURES.some((re) => re.test(text))
  })
  return { files: files.length, bad }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(process.cwd(), 'build', 'server')
  let result
  try {
    result = findMapLibre(root)
  } catch {
    console.error(`check-server-bundle: no server build at ${root} (run the build first)`)
    process.exit(2)
  }
  if (result.bad.length) {
    console.error(`check-server-bundle: MapLibre in the server build:\n  ${result.bad.join('\n  ')}`)
    process.exit(1)
  }
  console.log(`check-server-bundle: ${result.files} server files, no MapLibre`)
}
