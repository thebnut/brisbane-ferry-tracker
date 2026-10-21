/**
 * First-visit onboarding (P4) for ferry: the picker's terminals and the save into the existing pair store. A ferry
 * favourite is a pair, so the tapped terminal is From and the tray asks for a directly reachable To; Save goes
 * through savePair (remembered), exactly as the stop selector's Save. Loaded only with the prompt (lazy).
 */

import { modeChanged, type TrayItem } from '@bft/ui/onboarding'
import type { ModeSource } from '@bft/ui/onboarding-picker'
import { cleanStopName } from './names.ts'
import { clearPair, savePair } from './save-pair.ts'
import { markSelectorSeen, readSavedPair, STORAGE_KEYS } from './storage.ts'
import { choice, TERMINALS, terminalById, validDestinations } from './terminals.ts'

const STOPS = TERMINALS.map((t) => ({
  id: t.id,
  name: t.name,
  lat: t.lat,
  lon: t.lng,
  detail: t.routes.join(' · '),
}))

/** A pair saved on this device (remembered, or this session's). */
export const ferryHasSaved = (): boolean => readSavedPair() != null

/** The stop selector opened by itself before (the old first visit): this device has been onboarded. */
export function ferrySeenBefore(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEYS.SELECTOR_SEEN) === '1'
  } catch {
    return true
  }
}

/** Answering the prompt counts as the first-visit selector having opened (storage.ts shouldShowSelector). */
export const ferryAnswered = markSelectorSeen

const norm = (s: string) => cleanStopName(s).toLowerCase()

export const ferrySource: ModeSource = {
  mode: 'ferry',
  label: 'Ferry',
  title: 'Ferry terminals',
  noun: 'terminal',
  shape: 'circle',
  zoom: 13,
  stops: STOPS,
  search: (q) => STOPS.filter((s) => norm(s.name).includes(norm(q.trim()))),
  destinations: (from) =>
    validDestinations(from)
      .map(terminalById)
      .filter((t) => t != null)
      .map(choice),
}

/**
 * The tray's ferry trip, saved as the pair (remembered). False when it isn't a real route or storage refused it
 * (savePair keeps quiet about that, so the pair is read back).
 */
export function saveFerry(items: TrayItem[]): boolean {
  const item = items.find((i) => i.mode === 'ferry')
  if (!item) return true
  const from = terminalById(item.id)
  const to = item.to ? terminalById(item.to) : null
  if (!from || !to || !from.destinations.includes(to.id)) return false
  savePair({ outbound: choice(from), inbound: choice(to) }, true)
  markSelectorSeen()
  const saved = readSavedPair()
  return saved?.outbound.id === from.id && saved.inbound.id === to.id
}

/** Re-run from Settings (THE-113): the saved pair, as the tray opens with it (From, with its To chosen). */
export function ferryTrayItems(): TrayItem[] {
  const pair = readSavedPair()
  const from = pair && terminalById(pair.outbound.id)
  if (!pair || !from) return []
  return [
    { mode: 'ferry', id: from.id, name: from.name, detail: from.routes.join(' · '), to: pair.inbound.id },
  ]
}

/**
 * Re-run from Settings: the tray's ferry trip replaces the pair, and taking it out unsaves it. Nothing is written when
 * it didn't change (a pair kept for this session only stays so). False if storage refused.
 */
export function resaveFerry(before: TrayItem[], after: TrayItem[]): boolean {
  if (!modeChanged(before, after, 'ferry')) return true
  if (after.some((i) => i.mode === 'ferry')) return saveFerry(after)
  clearPair()
  return readSavedPair() == null
}
