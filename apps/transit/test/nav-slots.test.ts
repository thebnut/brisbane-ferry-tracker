/**
 * The swapped nav modules must export what the originals export (so every mode page imports them unchanged) with the
 * same sections. This project builds as BrisbaneTransit, so the originals are read straight from disk and compared by
 * export names; the NAV contents are compared by key and label.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as busHeader from '../app/modes/bus-header.tsx'
import * as busNav from '../app/modes/bus-nav.tsx'
import * as ferryHeader from '../app/modes/ferry-header.tsx'
import * as trainHeader from '../app/modes/train-header.tsx'
import * as trainNav from '../app/modes/train-nav.tsx'
import { HEADER_SLOTS, NAV_SLOTS, RERUN_SLOTS } from '../modes.config.ts'

const exportsOf = (path: string) =>
  [...readFileSync(path, 'utf8').matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]).sort()
const navOf = (path: string) =>
  [...readFileSync(path, 'utf8').matchAll(/\{ key: '(\w+)', label: '([^']+)'/g)].map((m) => `${m[1]}:${m[2]}`)

describe('nav slots', () => {
  const original = (mode: string) =>
    fileURLToPath(new URL(`../../${mode}/app/components/nav.tsx`, import.meta.url))

  it('swap exactly the bus and train nav modules', () => {
    expect(Object.keys(NAV_SLOTS).sort()).toEqual([original('bus'), original('train')].sort())
  })

  it.each([
    ['bus', busNav],
    ['train', trainNav],
  ] as const)('%s replacement exports the same names and sections', (mode, mod) => {
    expect(Object.keys(mod).sort()).toEqual(exportsOf(original(mode)))
    expect(mod.NAV.map((n) => `${n.key}:${n.label}`)).toEqual(navOf(original(mode)))
    for (const n of mod.NAV) expect(n.href.startsWith(`/${mode}`)).toBe(true)
  })
})

describe('header slots (THE-118 PR 2)', () => {
  const original = (mode: string) =>
    fileURLToPath(new URL(`../../${mode}/app/components/header.tsx`, import.meta.url))

  it("swap each mode app's header module for the one transit header", () => {
    expect(Object.keys(HEADER_SLOTS).sort()).toEqual(['bus', 'ferry', 'train'].map(original).sort())
  })

  it.each([
    ['ferry', ferryHeader],
    ['train', trainHeader],
    ['bus', busHeader],
  ] as const)('%s replacement exports the same names', (mode, mod) => {
    expect(Object.keys(mod).sort()).toEqual(exportsOf(original(mode)))
  })
})

describe('re-run onboarding slots (THE-113)', () => {
  it("each mode app's re-run picker resolves to transit's, which has every mode", () => {
    const own = (path: string) => fileURLToPath(new URL(path, import.meta.url))
    expect(RERUN_SLOTS).toEqual(
      Object.fromEntries(
        ['ferry', 'train', 'bus'].map((mode) => [
          own(`../../${mode}/app/components/OnboardingRerun.tsx`),
          own('../app/components/OnboardingRerun.tsx'),
        ]),
      ),
    )
  })
})
