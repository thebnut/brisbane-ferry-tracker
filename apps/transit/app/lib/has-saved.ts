/**
 * Whether this device has anything for My Transit, for the landing page's way back to it: the stores' keys read
 * directly, without saved.ts and the stores' code. Importing saved.ts from the landing page split it out of the chunk
 * the transit pages share and cost each of them ~120 B gz of first load (release 24). test/has-saved.test.ts checks this
 * agrees with saved.ts readSavedItems; an entry saved.ts would drop (an unknown terminal) can still count here, which
 * only shows the link.
 */
import { safe } from './storage.ts'

const LISTS = ['bft-ferry-favourites', 'bft-train-favourites', 'bft-bus-saved']

const nonEmptyList = (key: string) =>
  safe(() => {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null')
    return Array.isArray(v) && v.length > 0
  }, false)

/** The pair "Remember selection" kept before ferry favourites existed (saved.ts readFerry reads it the same way). */
const rememberedFerryPair = () =>
  safe(() => {
    if (localStorage.getItem('bft-ferry-favourites') !== null) return false
    if (localStorage.getItem('brisbane-ferry-remember-selection') !== 'true') return false
    const p = JSON.parse(localStorage.getItem('brisbane-ferry-selected-stops') ?? 'null')
    return typeof p?.outbound?.id === 'string' && typeof p?.inbound?.id === 'string'
  }, false)

export function hasSavedStops(): boolean {
  return LISTS.some(nonEmptyList) || rememberedFerryPair()
}
