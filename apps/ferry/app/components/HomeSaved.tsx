/**
 * Ferry home's saved trips after hydration (THE-118 PR 8), with the favourites' code (favourites.ts), so none of it is
 * on the home's first load: the list as stored, followed when it changes (a star here or in another tab), with
 * `bft_pair` brought in line with it so the next server render heads with the right trip; and the cards of every
 * saved trip after the first (the headline, home.tsx).
 */
import { SavedTripCard } from '@bft/ui'
import { Link } from 'react-router'
import { FAVOURITES_EVENT, FAVOURITES_KEY, readFerryFavourites, writePairCookie } from '../lib/favourites.ts'
import { type Trip, useTripCard } from '../lib/home-card.ts'
import type { DataMode } from '../lib/queries.ts'

/** Calls `onList` with the favourites now and whenever they change; the cookie follows them. Returns the unsubscribe. */
export function watchFavourites(onList: (list: Trip[]) => void): () => void {
  const read = () => {
    const list = readFerryFavourites()
    writePairCookie(list)
    onList(list)
  }
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
}

function Card({ trip, nowMs, mode }: { trip: Trip; nowMs: number; mode: DataMode }) {
  const { card, href, empty, loading } = useTripCard(trip, null, nowMs, mode)
  return (
    <SavedTripCard
      mode="ferry"
      label={card.label}
      title={card.title}
      live={card.live}
      time={card.time}
      detail={card.detail}
      minutes={card.minutes}
      later={card.later}
      empty={empty}
      loading={loading}
      href={href}
      renderLink={({ href, className, children }) => (
        <Link to={href} className={className} prefetch="intent">
          {children}
        </Link>
      )}
    />
  )
}

/** The saved trips after the headline (which is the highlighted one). */
export default function MoreSaved({ trips, nowMs, mode }: { trips: Trip[]; nowMs: number; mode: DataMode }) {
  return trips.map((t) => <Card key={`${t.from}>${t.to ?? ''}`} trip={t} nowMs={nowMs} mode={mode} />)
}
