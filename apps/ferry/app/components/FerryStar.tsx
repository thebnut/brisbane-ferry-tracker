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
  const [toast, setToast] = useState<SaveToastMessage | null>(null)
  useEffect(() => setList(readFerryFavourites()), [])
  const gone = useCallback(() => setToast(null), [])
  const name = to ? `${short(from)} → ${short(to)}` : short(from)
  const saved = isFerryFavourite(f, list)
  const toggle = () => {
    // Fresh from storage: another tab may have changed the list since this board read it.
    const adding = !isFerryFavourite(f)
    setList(adding ? addFerryFavourite(f) : removeFerryFavourite(f))
    setToast(adding ? { name, kept: stored(f), pickDestination: to ? undefined : onPickDestination } : null)
  }
  const undo = () => {
    if (isFerryFavourite(f)) setList(removeFerryFavourite(f))
    setToast(null)
  }
  return (
    <>
      <StarButton saved={saved} onToggle={toggle} name={name} />
      <SaveToast toast={toast} onGone={gone} onUndo={undo} />
    </>
  )
}
