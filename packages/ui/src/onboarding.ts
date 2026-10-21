/**
 * First-visit onboarding (P4), without React (`@bft/ui/onboarding`): when to offer "Set up your favourite stops?",
 * and the multi-select tray the map picker fills. Loaded only with the prompt, after hydration: never on a first load.
 *
 * Saving is the apps' job: each mode writes the tray through its own store and helpers (bus `bft-bus-saved`, train
 * `bft-train-favourites`, the ferry pair), so the formats never change.
 */

export type OnboardMode = 'ferry' | 'train' | 'bus'

/** Set once the prompt has been answered ("Not now" or a save) or found unneeded: it never shows again here. */
export const ONBOARDING_KEY = 'bft-onboarding'
/** transit handoff-import.ts LEDGER_KEY: favourites were handed over from a mode host on this device. */
export const HANDOFF_LEDGER_KEY = 'bft-handoff-imported'

const get = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Whether this device already answered (or never needs) the prompt. Blocked storage counts as answered: no nagging. */
export function onboardingDone(): boolean {
  try {
    return localStorage.getItem(ONBOARDING_KEY) != null
  } catch {
    return true
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1')
  } catch {
    // Storage blocked: onboardingDone() already says "done" for such a device.
  }
}

export interface OfferContext {
  /** Anything saved in this app (in transit: in any mode). */
  anySaved: boolean
  /** Other reasons the app has for not asking (ferry: its stop selector has opened by itself before). */
  seenBefore?: boolean
}

/**
 * Offer the prompt only on a first visit with nothing saved: never after "Not now" or a save, never to a device that
 * had favourites handed over (P6b), and never while the handoff notice is on screen.
 */
export function shouldOffer(ctx: OfferContext): boolean {
  if (onboardingDone()) return false
  // Settled for good: something is saved (or was handed over), or the app has onboarded this device before.
  if (ctx.anySaved || ctx.seenBefore || get(HANDOFF_LEDGER_KEY) != null) {
    markOnboardingDone()
    return false
  }
  // Not now: a handoff is arriving or its notice is on screen.
  if (typeof location !== 'undefined' && location.hash.startsWith('#import=')) return false
  if (typeof document !== 'undefined' && document.querySelector('[data-handoff-notice]')) return false
  return true
}

/**
 * Runs `run` once the visitor has been idle for `quietMs`: no tap, key or input, nothing being typed into, and no
 * modal open (a sheet, the ferry selector). The prompt then never lands under a finger or takes the focus of someone
 * already busy. Returns a cancel function.
 */
export function whenIdle(run: () => void, quietMs = 2000): () => void {
  const events = ['pointerdown', 'keydown', 'input', 'touchstart'] as const
  let last = Date.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  const bump = () => {
    last = Date.now()
  }
  const stop = () => {
    clearTimeout(timer)
    for (const e of events) removeEventListener(e, bump, true)
  }
  const check = () => {
    const busy =
      document.activeElement?.matches('input, textarea, select, [contenteditable="true"]') ||
      document.querySelector('[aria-modal="true"]') != null
    const wait = last + quietMs - Date.now()
    if (busy || wait > 0) {
      timer = setTimeout(check, Math.max(wait, 500))
      return
    }
    stop()
    run()
  }
  for (const e of events) addEventListener(e, bump, { capture: true, passive: true })
  timer = setTimeout(check, quietMs)
  return stop
}

// ---- the tray ----

export interface TrayItem {
  mode: OnboardMode
  id: string
  name: string
  /** Bus stop number or the station's platforms. */
  detail?: string
  /** Ferry only: the destination terminal's id, chosen in the tray (null until then). */
  to?: string | null
}

export const trayKey = (i: { mode: OnboardMode; id: string }) => `${i.mode}:${i.id}`

/** Per mode, how many the store keeps: train MAX_FAVOURITES; one ferry pair, a new From replaces the old. */
export const TRAY_LIMITS: Record<OnboardMode, number> = { ferry: 1, train: 8, bus: 20 }

export interface TrayState {
  items: TrayItem[]
  /** The last change, for the screen reader's live region ("Added Central"). */
  said: string
}

export type TrayAction =
  | { type: 'toggle'; item: TrayItem }
  | { type: 'remove'; key: string }
  | { type: 'move'; key: string; by: -1 | 1 }
  | { type: 'setTo'; key: string; to: string | null; toName?: string }

export const emptyTray = (): TrayState => ({ items: [], said: '' })

/**
 * A tap adds the stop, or removes it when it is already in the tray. A mode at its limit: the ferry's one pair takes
 * the new From (its destination cleared), others refuse with a message.
 */
export function trayReducer(state: TrayState, action: TrayAction): TrayState {
  const { items } = state
  switch (action.type) {
    case 'toggle': {
      const key = trayKey(action.item)
      if (items.some((i) => trayKey(i) === key))
        return { items: items.filter((i) => trayKey(i) !== key), said: `Removed ${action.item.name}` }
      const mode = action.item.mode
      const same = items.filter((i) => i.mode === mode)
      const item = mode === 'ferry' ? { ...action.item, to: null } : action.item
      if (same.length >= TRAY_LIMITS[mode]) {
        if (mode !== 'ferry')
          return { items, said: `You can save up to ${TRAY_LIMITS[mode]} ${mode} favourites` }
        return {
          items: items.map((i) => (i.mode === 'ferry' ? item : i)),
          said: `From ${item.name}. Now choose where you're going.`,
        }
      }
      return {
        items: [...items, item],
        said: mode === 'ferry' ? `From ${item.name}. Now choose where you're going.` : `Added ${item.name}`,
      }
    }
    case 'remove': {
      const gone = items.find((i) => trayKey(i) === action.key)
      return gone ? { items: items.filter((i) => i !== gone), said: `Removed ${gone.name}` } : state
    }
    case 'move': {
      const at = items.findIndex((i) => trayKey(i) === action.key)
      const to = at + action.by
      if (at < 0 || to < 0 || to >= items.length) return state
      const next = [...items]
      const [moved] = next.splice(at, 1) as [TrayItem]
      next.splice(to, 0, moved)
      return { items: next, said: `${moved.name} moved ${action.by < 0 ? 'up' : 'down'}` }
    }
    case 'setTo': {
      const item = items.find((i) => trayKey(i) === action.key)
      if (item?.mode !== 'ferry') return state
      return {
        items: items.map((i) => (i === item ? { ...i, to: action.to } : i)),
        said: action.to && action.toName ? `${item.name} to ${action.toName}` : '',
      }
    }
  }
}

/** Save is possible when there is something to save and the ferry trip, if any, has its destination. */
export const traySavable = (s: TrayState) =>
  s.items.length > 0 && s.items.every((i) => i.mode !== 'ferry' || !!i.to)

/** The tray's items for one mode, in tray order. */
export const itemsFor = (s: TrayState, mode: OnboardMode) => s.items.filter((i) => i.mode === mode)

// ---- re-running onboarding from Settings (THE-113) ----

/**
 * Save is possible when the ferry trip, if any, has its destination, and there is something to save; a re-run that
 * opened with stops (`before`) may also end empty, which unsaves them all.
 */
export const trayRerunSavable = (s: TrayState, before: TrayItem[]) =>
  (s.items.length > 0 || before.length > 0) && s.items.every((i) => i.mode !== 'ferry' || !!i.to)

/** Whether one mode's stops in the tray differ from those it opened with: which, their order, the ferry's To. */
export function modeChanged(before: TrayItem[], after: TrayItem[], mode: OnboardMode): boolean {
  const sig = (items: TrayItem[]) =>
    items
      .filter((i) => i.mode === mode)
      .map((i) => `${i.id}>${i.to ?? ''}`)
      .join(',')
  return sig(before) !== sig(after)
}

/**
 * A mode's stored list after a re-run, so that the stops the tray holds match it: entries the tray doesn't show
 * (`trayId` null: a train favourite with a destination) keep their place; the tray's slots are filled in tray order
 * (an unchanged tray gives the list back as it was), kept entries are reused as they are, new ones go at the end.
 */
export function applyTray<T>(
  existing: T[],
  trayId: (entry: T) => string | null,
  tray: TrayItem[],
  make: (item: TrayItem) => T,
): T[] {
  const kept = new Map<string, T>()
  for (const e of existing) {
    const id = trayId(e)
    if (id != null && !kept.has(id)) kept.set(id, e)
  }
  const queue = [...tray]
  const out: T[] = []
  for (const e of existing) {
    if (trayId(e) == null) out.push(e)
    else {
      const next = queue.shift()
      if (next) out.push(kept.get(next.id) ?? make(next))
    }
  }
  for (const next of queue) out.push(kept.get(next.id) ?? make(next))
  return out
}
