/**
 * The ferry board's star (THE-118 PR 1): saves the terminal, with its "To" when there is one, as a ferry favourite
 * (favourites.ts), as many as the rider likes. Its own lazy chunk with the list's code and the toast, so none of it is
 * on the boards' first load. Saving shows "{Name} saved to My Transit · Undo" ("Pick a destination" too when there is
 * no "To"); a second tap unsaves.
 */

export { firstFavouritePair } from '../lib/favourites.ts'

import { SaveToast, type SaveToastMessage } from '@bft/ui/save-toast'
import { StarButton } from '@bft/ui/star'
import { useCallback, useEffect, useState } from 'react'
import {
  addFerryFavourite,
  FAVOURITES_EVENT,
  FAVOURITES_KEY,
  type FerryFavourite,
  isFerryFavourite,
  readFerryFavourites,
  removeFerryFavourite,
  sameFerryFavourite,
} from '../lib/favourites.ts'
import { cleanStopName } from '../lib/names.ts'
import { terminalById } from '../lib/terminals.ts'

/** Whether storage itself holds it (a refused write leaves it out). */
function stored(f: FerryFavourite): boolean {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? '[]')
    return Array.isArray(v) && v.some((x) => sameFerryFavourite(x as FerryFavourite, f))
  } catch {
    return false
  }
}

const short = (id: string) => cleanStopName(terminalById(id)?.name ?? '')

export default function FerryStar({
  from,
  to,
  onPickDestination,
}: {
  from: string
  to: string | null
  /** Opens the board's destination picker, offered after saving a trip with no "To". */
  onPickDestination?: () => void
}) {
  const f = { from, to }
  const [list, setList] = useState<FerryFavourite[]>([])
  const [toast, setToast] = useState<(SaveToastMessage & { fav: FerryFavourite }) | null>(null)
  // The list as stored, again whenever it changes: here (the stop selector remembering a pair), or in another tab.
  useEffect(() => {
    const read = () => setList(readFerryFavourites())
    read()
    const onStorage = (e: StorageEvent) => {
      if (e.key === FAVOURITES_KEY || e.key == null) read()
    }
    addEventListener(FAVOURITES_EVENT, read)
    addEventListener('storage', onStorage)
    return () => {
      removeEventListener(FAVOURITES_EVENT, read)
      removeEventListener('storage', onStorage)
    }
  }, [])
  const gone = useCallback(() => setToast(null), [])
  const name = to ? `${short(from)} → ${short(to)}` : short(from)
  const saved = isFerryFavourite(f, list)
  const toggle = () => {
    // What the button showed decides (a "Save" tap never unsaves one saved elsewhere since); the write is checked
    // against storage, so it never adds a trip twice.
    const adding = !saved
    setList(
      adding === isFerryFavourite(f)
        ? readFerryFavourites()
        : adding
          ? addFerryFavourite(f)
          : removeFerryFavourite(f),
    )
    setToast(
      adding ? { name, fav: f, kept: stored(f), pickDestination: to ? undefined : onPickDestination } : null,
    )
  }
  // Undo takes out the trip the toast is about, even if the board has moved to another since.
  const undo = () => {
    if (toast && isFerryFavourite(toast.fav)) setList(removeFerryFavourite(toast.fav))
    setToast(null)
  }
  return (
    <>
      <StarButton saved={saved} onToggle={toggle} name={name} />
      <SaveToast toast={toast} onGone={gone} onUndo={undo} />
    </>
  )
}
