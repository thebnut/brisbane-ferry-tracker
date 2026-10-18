/**
 * Build-time composition of BrisbaneTransit from the standalone apps (transit-architecture.md §3.6: no runtime mode
 * switching). Shared by vite.config.ts and vitest.config.ts.
 *
 *  - `MODE_BASES`: each app's screens are mounted under a prefix. Their links go through `app/lib/base.ts` in that
 *    app, which reads `import.meta.env.VITE_<MODE>_BASE`; this build defines it, the standalone builds don't.
 *  - `navSlots()`: each app keeps its section navigation in one module (`app/components/nav.tsx`). Inside this build
 *    that module resolves to `app/modes/<mode>-nav.tsx` instead, so the bottom bar is the Mode Tabs while every page
 *    module is imported unchanged. test/nav-slots.test.ts checks each replacement exports what the original does.
 */
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { MODE_BASES, type MountedMode } from './app/lib/modes.ts'

export { MODE_BASES, type MountedMode }

export const baseDefines = (bases: Partial<Record<MountedMode, string>> = MODE_BASES) =>
  Object.fromEntries(
    Object.entries(bases).map(([mode, base]) => [
      `import.meta.env.VITE_${mode.toUpperCase()}_BASE`,
      JSON.stringify(base),
    ]),
  )

const appsDir = fileURLToPath(new URL('..', import.meta.url))

/** Absolute paths of the swapped modules → their transit replacements. */
export const NAV_SLOTS: Record<string, string> = Object.fromEntries(
  (['train', 'bus'] as const).map((mode) => [
    `${appsDir}${mode}/app/components/nav.tsx`,
    fileURLToPath(new URL(`./app/modes/${mode}-nav.tsx`, import.meta.url)),
  ]),
)

export function navSlots(): Plugin {
  return {
    name: 'bft:transit-nav-slots',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!importer || !id.endsWith('nav.tsx')) return null
      const r = await this.resolve(id, importer, { ...options, skipSelf: true })
      return r ? (NAV_SLOTS[r.id] ?? null) : null
    },
  }
}
