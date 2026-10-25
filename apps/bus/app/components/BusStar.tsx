/**
 * The star for a bus stop (THE-118 PR 1): on the stop board header, the trip dock and (icon only) the route page's stop
 * list. It saves the stop only, never the route filter. Saving shows "{Name} saved to My Transit · Undo"; a second
 * tap unsaves. A change this device's storage refuses leaves the star as it was, and the toast says so.
 */
import { SaveToast, type SaveToastMessage } from '@bft/ui/save-toast'
import { StarButton } from '@bft/ui/star'
import { useCallback, useState } from 'react'
import { isSaved, type SavedStop, toggleSaved, useSavedStops } from '../lib/storage.ts'

/** Save/unsave a stop with the toast; one per page section (`toast` is the element to render once). */
export function useBusSave() {
  const [toast, setToast] = useState<(SaveToastMessage & { stop: SavedStop }) | null>(null)
  const gone = useCallback(() => setToast(null), [])
  const toggle = (stop: SavedStop) => {
    const adding = !isSaved(stop.id)
    toggleSaved(stop)
    // isSaved reads storage again after a refused write (R27-S1): the star stays as it was, and the toast says so.
    const kept = isSaved(stop.id) === adding
    if (adding && kept) window.__bftGa?.saveStop('bus', stop.id)
    setToast(
      !kept ? { name: stop.name, kept, remove: !adding, stop } : adding ? { name: stop.name, stop } : null,
    )
  }
  const element = (
    <SaveToast
      toast={toast}
      onGone={gone}
      onUndo={() => {
        if (toast && isSaved(toast.stop.id)) toggleSaved(toast.stop)
        setToast(null)
      }}
    />
  )
  return { toggle, toast: element }
}

export function BusStar({ id, name, className }: { id: string; name: string; className?: string }) {
  const saved = useSavedStops().some((s) => s.id === id)
  const { toggle, toast } = useBusSave()
  return (
    <>
      <StarButton saved={saved} onToggle={() => toggle({ id, name })} name={name} className={className} />
      {toast}
    </>
  )
}
