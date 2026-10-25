/**
 * / (My Transit tab, X-Home): the Ask box, then saved stops and trips from every mode as cards (next departure, countdown,
 * "Then …"), soonest highlighted. Saved items live in each app's own storage on this device (saved.ts), so the list
 * renders after hydration; offline, cards show scheduled times from the device's copies ("Offline · scheduled").
 */

import type { DeparturesResponse } from '@bft/core/contract'
import {
  dayMarker,
  EmptyState,
  formatClock,
  Icon,
  liveState,
  minutesUntil,
  OfflineBanner,
  SavedTripCard,
  vesselName,
} from '@bft/ui'
import {
  isNetworkAnswer,
  type OfflineCopy,
  retryWhenBack,
  useDisconnects,
  usePageCheck,
  VIA_NETWORK,
} from '@bft/ui/connectivity'
import { type ComponentType, type ReactNode, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AskBox } from '../components/AskBox.tsx'
import { TransitFooter, TransitHeader, TransitStrip } from '../components/Chrome.tsx'
import { fetchAlerts } from '../lib/api.ts'
import { MODE_BASES } from '../lib/modes.ts'
import { asOffline, useApi, useSavedDepartures } from '../lib/queries.ts'
import { readSavedItems, type SavedItem } from '../lib/saved.ts'
import { applyPrefs, cleanLabel, LABEL_MAX, readPrefs, writePrefs } from '../lib/saved-prefs.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/saved'

export function loader() {
  return { renderedAt: Date.now(), via: VIA_NETWORK }
}

export const meta: Route.MetaFunction = () => [
  { title: 'My Transit | BrisbaneTransit' },
  {
    name: 'description',
    content:
      'Your Brisbane ferry, train and bus stops with live departures, what is leaving around you, and alerts.',
  },
  { name: 'robots', content: 'noindex' },
]

export function headers() {
  return { 'cache-control': 'private, no-store' }
}

/** "Good morning" etc. in Brisbane time. */
export function greeting(nowMs: number): string {
  const h = Number(
    new Intl.DateTimeFormat('en-AU', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Australia/Brisbane',
    }).format(nowMs),
  )
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

const FERRY_EXPRESS = /^F1\d$/

export interface CardModel {
  label: string
  /** The visitor's name for the item if it has one, else what the card would say (`subtitle` then says that). */
  title: string
  subtitle: string | null
  live: boolean
  time: string | null
  detail: string | null
  minutes: number | null
  later: string | null
  /** Seconds of the next departure, for picking the highlighted card. */
  next: number | null
}

/** "6:05 am (19/10)": a clock time with the shared next-day marker (@bft/ui dayMarker, R2-S1). */
const clockDay = (epochS: number, nowMs: number) => {
  const day = dayMarker(epochS, nowMs)
  return day ? `${formatClock(epochS)} ${day}` : formatClock(epochS)
}

/** Only boardable services: a cancelled or skipped (not stopping here) one is never "next". */
const boardable = (res: DeparturesResponse | undefined) =>
  (res?.departures ?? []).filter((d) => d.status !== 'cancelled' && d.status !== 'skipped')

/** The card's LIVE pill: its next departure is live, from a live feed. */
const marksLive = (res: DeparturesResponse | undefined): boolean =>
  res?.rtState === 'live' && boardable(res)[0]?.status === 'live'

/** One saved card from a departures response (pure, tested). */
export function cardModel(item: SavedItem, res: DeparturesResponse | undefined, nowMs: number): CardModel {
  const rows = boardable(res)
  const first = rows[0]
  const dep = first ? (first.estDep ?? first.schedDep) : null
  const arr = first ? (first.estArrTo ?? first.schedArrTo) : null
  const live = marksLive(res)
  let label: string
  let title = item.title
  let detail: string | null = null
  if (item.mode === 'bus') {
    label = `Bus · ${res?.stop.name ?? item.title}`
    if (first) title = `${first.route.short} to ${first.headsign}`
    detail = first?.platform ? `Platform ${first.platform}` : `Stop ${item.key}`
  } else if (item.mode === 'train') {
    label = `Train · ${first?.route.long ?? 'Station'}`
    const name = (n: string | undefined) => n?.replace(/ station$/, '')
    if (res?.stop.name)
      title = res.to?.name ? `${name(res.stop.name)} → ${name(res.to.name)}` : (name(res.stop.name) ?? title)
    detail = first
      ? [
          first.platform ? `Platform ${first.platform}` : null,
          `To ${first.headsign.replace(/ station$/, '')}`,
        ]
          .filter(Boolean)
          .join(' · ')
      : null
  } else {
    const express = first ? FERRY_EXPRESS.test(first.route.short) : false
    label = `Ferry · ${express ? 'Express' : 'All stops'}`
    detail = first ? [first.route.short, vesselName(first.vehicleId)].filter(Boolean).join(' · ') : null
  }
  return {
    label,
    // A custom name (THE-114) heads the card; what it would have said stays under it, so the stop is recognisable.
    title: item.label || title,
    subtitle: item.label ? title : null,
    live,
    time: dep ? `${clockDay(dep, nowMs)}${arr ? ` → ${clockDay(arr, nowMs)}` : ''}` : null,
    detail,
    minutes: dep ? minutesUntil(dep, nowMs) : null,
    later:
      rows
        .slice(1, 3)
        .map((d) => `${clockDay(d.estDep ?? d.schedDep, nowMs)} ${d.route.short}`)
        .join('   ') || null,
    next: dep,
  }
}

type CardData = (DeparturesResponse & OfflineCopy) | undefined

/**
 * The home page's own live judgement (R7-T1), reported the way the mode homes report theirs (@bft/ui mode-home
 * pageLive, R36-L1 and R32-RT1):
 *  - `unconfirmed`: the page came from the device's copy (the service worker's, or old by the device clock) and no
 *    card has its own network answer yet, so it shows the offline banner and the OFFLINE pill like a board rendered
 *    from a cached page (R8-T1);
 *  - `live` (the header pill): not live (OFFLINE) offline, unconfirmed, or while a saved card is not live: its answer
 *    is stale, not live, or its request failed with nothing to show (Codex review: a failed one too). LIVE once none
 *    is, and a card shows its LIVE pill: live data whose next departure is timetabled marks nothing live, so it never
 *    puts LIVE over cards without a pill (P-3167c11-H1). Only such cards: no claim (undefined);
 *  - `pending`: a card still waiting for its first answer, and none not live: "Connecting…", not OFFLINE (before
 *    R7-T1 a pending card counted as live, so an offline reload kept LIVE up for as long as the requests took to fail).
 * With no saved cards (the saved items not read yet: the server render and hydration; or nothing saved) the page has
 * no live data of its own, so it claims nothing either way: no OFFLINE flash in the server's HTML (P-3167c11-O1) and
 * no LIVE over an empty list (P-3167c11-H1). `reached` (useReachedNetwork) still confirms a page from the device's copy
 * with nothing saved, and a request that can't reach the network makes useOnline false: the header says OFFLINE then.
 */
export function homeLiveState(
  items: readonly unknown[] | null,
  cards: ReadonlyArray<{ data: CardData; pending: boolean }>,
  {
    online,
    nowMs,
    unconfirmedBefore,
    arrivedAt = null,
    reached = false,
  }: {
    online: boolean
    nowMs: number
    unconfirmedBefore: number | null
    /** PageCheck.arrivedAt (usePageCheck, R15-S1). */
    arrivedAt?: number | null
    reached?: boolean
  },
): { live: boolean | undefined; pending: boolean; unconfirmed: boolean } {
  const answered =
    cards.some(
      ({ data }) =>
        data != null && !data.offline && (unconfirmedBefore == null || data.generatedAt > unconfirmedBefore),
    ) ||
    (items?.length === 0 && reached)
  const unconfirmed = unconfirmedBefore != null && !answered
  // Each saved card (one query per item) as a mode home's row reports (reportValue): one not live, or failed with
  // nothing to show, makes the page not live; one waiting makes it "Connecting…"; otherwise LIVE once a card shows its
  // pill. No cards (items not read yet, or none saved): no claim.
  let down = !online || unconfirmed
  let pending = false
  let pill = false
  for (const c of cards)
    if (c.data == null) c.pending ? (pending = true) : (down = true)
    else if (liveState(c.data, { offline: false, nowMs, unconfirmedBefore, arrivedAt }) != null) down = true
    else pill ||= marksLive(c.data)
  return { live: down || pending ? false : pill || undefined, pending: pending && !down, unconfirmed }
}

/**
 * The home's "Last updated" (R9-T1): the newest `generatedAt` among the cards' own network answers, never the clock.
 * Not an offline copy (built from the service worker's cached answer, the last response or the device's timetable,
 * maybe stamped with the device clock), and not an answer that came with a page from the device's copy
 * (`unconfirmedBefore`). It never goes back (`kept`, the last value shown), so offline it stays at the last real
 * answer's time; nothing until there is one (never a status that contradicts LIVE, R3-X11).
 */
export function lastAnswerAt(
  kept: number | null,
  cards: ReadonlyArray<CardData>,
  unconfirmedBefore: number | null,
): number | null {
  let newest = kept
  for (const data of cards) {
    if (data == null || data.offline || (unconfirmedBefore != null && data.generatedAt <= unconfirmedBefore))
      continue
    if (newest == null || data.generatedAt > newest) newest = data.generatedAt
  }
  return newest
}

/**
 * lastAnswerAt kept across renders, so it stays at the last answer while the cards turn into offline copies. Per data
 * mode (`scope`): a demo answer's time never carries over to an ordinary visit's cards, or back (Codex review).
 */
export function useLastAnswerAt(
  scope: string,
  cards: ReadonlyArray<CardData>,
  unconfirmedBefore: number | null,
): number | null {
  const [kept, setKept] = useState<{ scope: string; at: number | null }>({ scope, at: null })
  const at = lastAnswerAt(kept.scope === scope ? kept.at : null, cards, unconfirmedBefore)
  if (kept.scope !== scope || kept.at !== at) setKept({ scope, at })
  return at
}

function SavedList({
  items,
  qs,
  nowMs,
  online,
  Row,
}: {
  items: SavedItem[]
  qs: ReturnType<typeof useSavedDepartures>
  nowMs: number
  online: boolean
  /** Wraps each card once the list can be changed (SavedRows.tsx SwipeRow). */
  Row?: ComponentType<{ item: SavedItem; children: ReactNode }>
}) {
  const page = usePageCheck()
  // Not live (offline, a cached copy, or data generated over a minute ago): never show the last live estimates;
  // timetable rows from the device's copies instead.
  const models = items.map((it, i) => {
    const data = qs[i]?.data
    const live = liveState(data, { offline: !online, nowMs, ...page }) == null
    return cardModel(it, live ? data : asOffline(it, data ?? null, data), nowMs)
  })
  const soonest = models.reduce<number | null>(
    (best, m, i) =>
      m.next != null && (best == null || m.next < (models[best]?.next ?? Infinity)) ? i : best,
    null,
  )
  return (
    <div className="flex flex-col gap-3">
      {items.map((it, i) => {
        const m = models[i] as CardModel
        const q = qs[i]
        const empty = q?.isPending
          ? 'Getting live departures…'
          : q?.isError && !q.data
            ? "Live times aren't loading. Open the board for the timetable."
            : m.time
              ? null
              : online
                ? 'No more departures today.'
                : 'Offline: no saved timetable with times to come.'
        const card = (
          <SavedTripCard
            key={it.id}
            mode={it.mode}
            label={m.label}
            title={
              m.subtitle ? (
                <>
                  {m.title}
                  <span className="block truncate text-[13px] font-normal text-gray-600 dark:text-night-text/70">
                    {m.subtitle}
                  </span>
                </>
              ) : (
                m.title
              )
            }
            live={m.live}
            time={m.time}
            detail={m.detail}
            minutes={m.minutes}
            later={m.later}
            highlighted={i === soonest && (m.minutes ?? 99) <= 15}
            empty={empty}
            loading={!!q?.isPending}
            href={it.href}
            renderLink={({ href, className, children }) => (
              <Link to={href} className={className} prefetch="intent">
                {children}
              </Link>
            )}
          />
        )
        return Row ? (
          <Row key={it.id} item={it}>
            {card}
          </Row>
        ) : (
          card
        )
      })}
    </div>
  )
}

/**
 * With nothing saved, the home has no card whose answer can confirm it (R8-T1), whether the page is fresh or the
 * device's copy. It asks the API itself (the alerts, through the same timeout and cache marking as every /v1 call),
 * now and whenever the connection may be back (retryWhenBack), until a network answer arrives, and again after every
 * disconnect or failed call.
 */
export function useReachedNetwork(needed: boolean): boolean {
  const { fetcher } = useApi()
  // A confirmation lasts only while the connection does: after any disconnect, LIVE needs a new answer (Codex
  // reviews), counted by @bft/ui so a disconnect React never rendered (a failure and a success in one batch) counts.
  const disconnects = useDisconnects()
  const [reachedAt, setReachedAt] = useState<number | null>(null)
  const reached = reachedAt === disconnects
  useEffect(() => {
    if (!needed || reached) return
    const ctrl = new AbortController()
    let busy = false
    const ask = () => {
      if (busy) return
      busy = true
      fetchAlerts(fetcher, { signal: ctrl.signal })
        .then((body) => {
          if (isNetworkAnswer(body)) setReachedAt(disconnects)
        })
        .catch(() => {})
        .finally(() => {
          busy = false
        })
    }
    ask()
    const off = retryWhenBack(ask)
    return () => {
      off()
      ctrl.abort()
    }
  }, [needed, reached, fetcher, disconnects])
  return reached
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const now = useNow(loaderData.renderedAt)
  const online = useOnline()
  // localStorage is client-only: read after hydration (the server renders the Ask box and an empty list), in the
  // visitor's own order and names in the same step, so the list never shows in another order first.
  const [items, setItems] = useState<SavedItem[] | null>(null)
  // Editing and deleting (THE-114, THE-115): their own chunk, loaded after hydration, off the first load.
  const [rows, setRows] = useState<typeof import('../components/SavedRows.tsx') | null>(null)
  // First-visit onboarding (P4), inline at the top of this page only (THE-118 PR 3), off the first load: a device that
  // hasn't answered the prompt loads it now, and it checks the rest (nothing saved, no handoff). The key is
  // @bft/ui/onboarding's ONBOARDING_KEY, spelled here so that module stays off the first load.
  const [Onboarding, setOnboarding] = useState<ComponentType | null>(null)
  useEffect(() => {
    setItems(applyPrefs(readSavedItems(), readPrefs()))
    void import('../components/SavedRows.tsx').then(setRows)
    try {
      if (!localStorage.getItem('bft-onboarding'))
        import('../components/Onboarding.tsx').then(
          (m) => setOnboarding(() => m.default),
          () => {},
        )
    } catch {
      // Storage blocked: never asked.
    }
  }, [])
  const { mode, fetcher } = useApi()
  const qs = useSavedDepartures(fetcher, mode, items ?? [])
  const page = usePageCheck()
  const unconfirmedBefore = page?.unconfirmedBefore ?? null
  const reached = useReachedNetwork(items?.length === 0)
  const { live, pending, unconfirmed } = homeLiveState(
    items,
    qs.map((q) => ({ data: q.data, pending: q.isPending })),
    { online, nowMs: now, unconfirmedBefore, arrivedAt: page?.arrivedAt, reached },
  )
  const updatedAt = useLastAnswerAt(
    `${mode.fixtures}:${mode.rt}`,
    qs.map((q) => q.data),
    unconfirmedBefore,
  )
  const empty = (
    <EmptyState title="Nothing in My Transit yet">
      Save a ferry trip, a train station or a bus stop in its tab and it shows up here, with the next
      departures from every mode in one list.{' '}
      <span className="mt-2 flex flex-wrap justify-center gap-2">
        <Link to={MODE_BASES.ferry} className="font-semibold text-ferry-orange-deep underline">
          Ferry
        </Link>
        <Link to={MODE_BASES.train} className="font-semibold text-ferry-orange-deep underline">
          Train
        </Link>
        <Link to={MODE_BASES.bus} className="font-semibold text-ferry-orange-deep underline">
          Bus
        </Link>
      </span>
    </EmptyState>
  )
  return (
    <>
      <TransitHeader live={live} pending={pending} />
      <TransitStrip updatedAt={updatedAt}>
        {items ? (
          <span className="text-sm font-semibold text-aqua-text dark:text-ferry-aqua-light">
            {items.length} saved · all modes
          </span>
        ) : null}
      </TransitStrip>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3.5 pt-3.5 pb-4 md:px-4">
        <h1 className="text-[22px] font-extrabold" suppressHydrationWarning>
          {greeting(now)}
        </h1>
        {Onboarding ? <Onboarding /> : null}
        <AskBox />
        {/* A card built from offline copies keeps the banner until its own network answer (R6-B1), and so does a page
            served from the device's copy until a card has one (R7-T1). */}
        {!online || unconfirmed || qs.some((q) => q.data?.offline) ? (
          <OfflineBanner
            kind="offline"
            detail={
              items?.length === 0
                ? 'Nothing is in My Transit on this device yet. Live times return once you are back online.'
                : 'Showing saved timetables. No live times.'
            }
          />
        ) : null}
        {items == null ? (
          <p data-loading="" className="text-sm text-sched-text dark:text-night-text/70">
            Loading your stops…
          </p>
        ) : rows ? (
          <rows.SavedArea
            items={items}
            onItems={setItems}
            store={{ read: readPrefs, write: writePrefs, clean: cleanLabel, maxLength: LABEL_MAX }}
            list={<SavedList items={items} qs={qs} nowMs={now} online={online} Row={rows.SwipeRow} />}
            empty={empty}
          />
        ) : items.length ? (
          <SavedList items={items} qs={qs} nowMs={now} online={online} />
        ) : (
          empty
        )}
        <Link
          to="/nearby"
          prefetch="intent"
          className="bg-board-header flex min-h-12 items-center justify-between gap-2.5 rounded-card border border-ferry-orange/15 px-3.5 py-3 text-charcoal no-underline dark:text-night-text"
        >
          <span className="flex items-center gap-2.5 text-sm font-semibold">
            <Icon name="nearby" size={20} className="text-aqua-text dark:text-ferry-aqua-light" />
            What's leaving around you · ferry, train and bus
          </span>
          <span aria-hidden="true" className="text-ferry-orange-dark">
            ›
          </span>
        </Link>
      </main>
      <TransitFooter />
    </>
  )
}
