/**
 * Build-time composition of BrisbaneTransit from the standalone apps (transit-architecture.md §3.6: no runtime mode
 * switching). Shared by vite.config.ts and vitest.config.ts.
 *
 *  - `modeBases()`: each app's screens are mounted under a prefix (MODE_BASES). Their links go through
 *    `app/lib/base.ts` in that app, which reads `import.meta.env.VITE_<MODE>_BASE`; this build inlines it, the
 *    standalone builds leave it unset.
 *  - `navSlots()`: each app keeps its section navigation in one module (`app/components/nav.tsx`). Inside this build
 *    that module resolves to `app/modes/<mode>-nav.tsx` instead, so the bottom bar is the Mode Tabs while every page
 *    module is imported unchanged. test/nav-slots.test.ts checks each replacement exports what the original does.
 *    Each app's header module (`app/components/header.tsx`: its lockup header and "Updated" strip) resolves to
 *    `app/modes/<mode>-header.tsx`, the one BrisbaneTransit header and status line (THE-118).
 *    The same way, each app's re-run onboarding picker (`app/components/OnboardingRerun.tsx`, THE-113) resolves to
 *    transit's, so "Set up My Transit stops" in a mode tab's Settings edits every mode's stops.
 */
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'
import { MODE_BASES, type MountedMode } from './app/lib/modes.ts'

export { MODE_BASES, type MountedMode }

const BASE_RE = /import\.meta\.env\.VITE_(FERRY|TRAIN|BUS)_BASE/g

/**
 * Inlines `import.meta.env.VITE_<MODE>_BASE` as a string literal in the source. A transform rather than Vite's
 * `define`, because Vitest applies `import.meta.env` defines process-wide, which would leak the prefixes into the
 * standalone parity project.
 */
export function modeBases(bases: Record<MountedMode, string> = MODE_BASES): Plugin {
  return {
    name: 'bft:transit-mode-bases',
    enforce: 'pre',
    transform(code, id) {
      if (!code.includes('import.meta.env.VITE_')) return null
      if (!/\/apps\/(ferry|train|bus)\/app\//.test(id)) return null
      return code.replace(BASE_RE, (_, m: string) => JSON.stringify(bases[m.toLowerCase() as MountedMode]))
    },
  }
}

const appsDir = fileURLToPath(new URL('..', import.meta.url))

/** Absolute paths of the swapped modules → their transit replacements. */
export const NAV_SLOTS: Record<string, string> = Object.fromEntries(
  (['train', 'bus'] as const).map((mode) => [
    `${appsDir}${mode}/app/components/nav.tsx`,
    fileURLToPath(new URL(`./app/modes/${mode}-nav.tsx`, import.meta.url)),
  ]),
)

/** Each mode app's header and status strip → the one BrisbaneTransit header and status line (THE-118). */
export const HEADER_SLOTS: Record<string, string> = Object.fromEntries(
  (['ferry', 'train', 'bus'] as const).map((mode) => [
    `${appsDir}${mode}/app/components/header.tsx`,
    fileURLToPath(new URL(`./app/modes/${mode}-header.tsx`, import.meta.url)),
  ]),
)

/** Each mode app's re-run onboarding picker → transit's, which has every mode. */
export const RERUN_SLOTS: Record<string, string> = Object.fromEntries(
  (['ferry', 'train', 'bus'] as const).map((mode) => [
    `${appsDir}${mode}/app/components/OnboardingRerun.tsx`,
    fileURLToPath(new URL('./app/components/OnboardingRerun.tsx', import.meta.url)),
  ]),
)

export function navSlots(): Plugin {
  return {
    name: 'bft:transit-nav-slots',
    enforce: 'pre',
    async resolveId(id, importer, options) {
      if (!importer || !/(nav|header|OnboardingRerun)\.tsx$/.test(id)) return null
      const r = await this.resolve(id, importer, { ...options, skipSelf: true })
      return r ? (NAV_SLOTS[r.id] ?? HEADER_SLOTS[r.id] ?? RERUN_SLOTS[r.id] ?? null) : null
    },
  }
}
