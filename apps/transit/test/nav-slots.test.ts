/**
 * The swapped nav modules must export what the originals export (so every mode page imports them unchanged) with the
 * same sections. This project builds as BrisbaneTransit, so the originals are read straight from disk and compared by
 * export names; the NAV contents are compared by key and label.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as busNav from '../app/modes/bus-nav.tsx'
import * as trainNav from '../app/modes/train-nav.tsx'
import { NAV_SLOTS } from '../modes.config.ts'

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
