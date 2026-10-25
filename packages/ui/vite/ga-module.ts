/**
 * Builds /ga.js (src/analytics-run.ts) into each app's client output, at a fixed name the root's GA bootstrap can
 * import (analytics-config.ts gaBootstrap). It's its own entry and imports nothing, so no page's chunks change, and
 * nothing references it unless GA is on. Not hashed, so it keeps the default revalidating cache (public/_headers).
 *
 * Imported by path from each app's vite.config.ts. It uses no Vite types, as no-map-on-server.ts.
 */
import { normalisePath } from './no-map-on-server.ts'

const ENTRY = normalisePath(decodeURIComponent(new URL('../src/analytics-run.ts', import.meta.url).pathname))

interface EmitContext {
  emitFile(file: { type: 'chunk'; id: string; fileName: string }): string
}

export function gaModule() {
  return {
    name: 'bft:ga-module',
    applyToEnvironment: (env: { name: string }) => env.name === 'client',
    buildStart(this: EmitContext) {
      this.emitFile({ type: 'chunk', id: ENTRY, fileName: 'ga.js' })
    },
  }
}
