/**
 * The star for a bus stop (THE-118 PR 1): on the stop board header, the trip dock and (icon only) the route page's stop
 * list. It saves the stop only, never the route filter. Saving shows "{Name} saved to My Transit · Undo"; a second
 * tap unsaves.
 */
import { SaveToast, type SaveToastMessage } from '@bft/ui/save-toast'
import { StarButton } from '@bft/ui/star'
import { useCallback, useState } from 'react'
import { isSaved, KEYS, type SavedStop, toggleSaved, useSavedStops } from '../lib/storage.ts'

/** Whether storage itself holds the stop (storage.ts keeps a copy in memory even when a write was refused). */
function stored(id: string): boolean {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEYS.SAVED) ?? '[]')
    return Array.isArray(v) && v.some((s) => (s as { id?: unknown } | null)?.id === id)
  } catch {
    return false
  }
}

/** Save/unsave a stop with the toast; one per page section (`toast` is the element to render once). */
export function useBusSave() {
  const [toast, setToast] = useState<(SaveToastMessage & { stop: SavedStop }) | null>(null)
  const gone = useCallback(() => setToast(null), [])
  const toggle = (stop: SavedStop) => {
    const added = toggleSaved(stop)
    setToast(added ? { name: stop.name, kept: stored(stop.id), stop } : null)
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
