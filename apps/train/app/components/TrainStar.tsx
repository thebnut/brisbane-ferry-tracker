/**
 * The train star's state (THE-118 PR 1): on the station board header and the trip dock (THE-118 PR 6). Its own module,
 * so the trip page carries it without the board.
 */
import { SaveToast, type SaveToastMessage } from '@bft/ui/save-toast'
import { useCallback, useEffect, useState } from 'react'
import {
  FAVOURITES_KEY,
  type Favourite,
  MAX_FAVOURITES,
  readFavourites,
  sameFavourite,
  toggleFavourite,
  writeFavourites,
} from '../lib/storage.ts'

/**
 * The board's star (THE-118 PR 1): saves the station, with "Going to" when set (`to: null` is a valid favourite).
 * Saving shows the toast, which adds "Pick a destination" (the Going-to sheet, on a board) when there is none; a second
 * tap unsaves.
 */
export function useStar(f: Favourite, name: string, pickDestination?: () => void) {
  const [list, setList] = useState<Favourite[]>([])
  /**
   * `fav`: the favourite the toast is about, which Undo takes out even after the page has moved to another board (the
   * star lives on the station page, THE-118 PR 5). `evicted`: the one a full list let go to make room (MAX_FAVOURITES),
   * and its place, for Undo.
   */
  const [toast, setToast] = useState<
    (SaveToastMessage & { fav: Favourite; evicted: { fav: Favourite; at: number } | null }) | null
  >(null)
  // On another board, "Pick a destination" would pick for that board, not the saved one: only Undo stays.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the board.
  useEffect(
    () =>
      setToast((t) =>
        t?.pickDestination && !sameFavourite(t.fav, f) ? { ...t, pickDestination: undefined } : t,
      ),
    [f.from, f.to],
  )
  // The list as stored, again when another tab changes it.
  useEffect(() => {
    const read = () => setList(readFavourites())
    read()
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAVOURITES_KEY || e.key == null) read()
    }
    addEventListener('storage', onStorage)
    return () => removeEventListener('storage', onStorage)
  }, [])
  const gone = useCallback(() => setToast(null), [])
  const saved = list.some((x) => sameFavourite(x, f))
  const toggle = () => {
    // Fresh from storage: another board or tab may have changed the list since this one read it.
    const before = readFavourites()
    // What the button showed decides: a "Save" tap never unsaves one saved elsewhere since.
    const adding = !saved
    const has = before.some((x) => sameFavourite(x, f))
    if (adding !== has) toggleFavourite(before, f)
    // What storage holds now: the star shows it, and a refused write (R27-S1) saved, removed and let go nothing.
    const after = readFavourites()
    setList(after)
    const kept = after.some((x) => sameFavourite(x, f)) === adding
    const at = before.findIndex((x) => !after.some((y) => sameFavourite(x, y)))
    const evicted = adding && at >= 0 ? { fav: before[at] as Favourite, at } : null
    setToast(
      !kept
        ? { name, fav: f, evicted: null, kept, remove: !adding }
        : adding
          ? { name, fav: f, evicted, pickDestination: f.to ? undefined : pickDestination }
          : null,
    )
  }
  const undo = () => {
    if (!toast) return
    const fav = toast.fav
    let now = readFavourites()
    if (now.some((x) => sameFavourite(x, fav)))
      now = writeFavourites(now.filter((x) => !sameFavourite(x, fav)))
    // The one a full list let go comes back at its place, unless it was saved again since, or the list is full again
    // (saved to elsewhere since): it never pushes another favourite out.
    const ev = toast.evicted
    if (ev && now.length < MAX_FAVOURITES && !now.some((x) => sameFavourite(x, ev.fav)))
      now = writeFavourites([...now.slice(0, ev.at), ev.fav, ...now.slice(ev.at)])
    setList(readFavourites())
    setToast(null)
  }
  return { saved, toggle, toast: <SaveToast toast={toast} onGone={gone} onUndo={undo} /> }
}
