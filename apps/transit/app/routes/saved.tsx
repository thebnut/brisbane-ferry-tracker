/**
 * / (Saved tab, X-Home): the Ask box, then saved stops and trips from every mode as cards (next departure, countdown,
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
import { type OfflineCopy, useUnconfirmedBefore } from '@bft/ui/connectivity'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AskBox } from '../components/AskBox.tsx'
import { TransitFooter, TransitHeader, TransitStrip } from '../components/Chrome.tsx'
import { MODE_BASES } from '../lib/modes.ts'
import { asOffline, useApi, useSavedDepartures } from '../lib/queries.ts'
import { readSavedItems, type SavedItem } from '../lib/saved.ts'
import { useNow, useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/saved'

export function loader() {
  return { renderedAt: Date.now() }
}

export const meta: Route.MetaFunction = () => [
  { title: 'BrisbaneTransit | Live ferry, train and bus departures' },
  {
    name: 'description',
    content:
      'Your saved Brisbane ferry, train and bus stops with live departures, what is leaving around you, and alerts.',
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
  title: string
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

/** One saved card from a departures response (pure, tested). */
export function cardModel(item: SavedItem, res: DeparturesResponse | undefined, nowMs: number): CardModel {
  // Only boardable services: a cancelled or skipped (not stopping here) one is never "next".
  const rows = (res?.departures ?? []).filter((d) => d.status !== 'cancelled' && d.status !== 'skipped')
  const first = rows[0]
  const dep = first ? (first.estDep ?? first.schedDep) : null
  const arr = first ? (first.estArrTo ?? first.schedArrTo) : null
  const live = res?.rtState === 'live' && first?.status === 'live'
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
    title,
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
 * The home page's own live judgement (R7-T1), as each mode board makes it for its one board (#60/#61/#68):
 *  - `unconfirmed`: the page came from the device's copy (the service worker's, or old by the device clock) and no
 *    card has its own network answer yet, so it shows the offline banner like a board rendered from a cached page;
 *  - `live` (the header pill): online, confirmed, and every saved card has an answer that is live and fresh. A card
 *    still waiting for its answer, or whose request failed, is not live: before R7-T1 a pending card counted as live,
 *    so an offline reload kept LIVE up for as long as the requests took to fail (Codex review: a failed one too).
 * With nothing saved there is nothing to judge: LIVE while online on a fresh page.
 */
export function homeLiveState(
  items: readonly unknown[] | null,
  cards: ReadonlyArray<{ data: CardData; pending: boolean }>,
  { online, nowMs, unconfirmedBefore }: { online: boolean; nowMs: number; unconfirmedBefore: number | null },
): { live: boolean; unconfirmed: boolean } {
  const answered = cards.some(
    ({ data }) =>
      data != null && !data.offline && (unconfirmedBefore == null || data.generatedAt > unconfirmedBefore),
  )
  const unconfirmed = unconfirmedBefore != null && !answered && (items == null || items.length > 0)
  if (!online || unconfirmed) return { live: false, unconfirmed }
  if (items == null || items.length === 0) return { live: unconfirmedBefore == null, unconfirmed }
  // Every saved card, each with an answer (one still waiting, or one that failed, has nothing live to show).
  const live =
    cards.length === items.length &&
    cards.every(
      (c) => c.data != null && liveState(c.data, { offline: false, nowMs, unconfirmedBefore }) == null,
    )
  return { live, unconfirmed }
}

function SavedList({
  items,
  qs,
  nowMs,
  online,
}: {
  items: SavedItem[]
  qs: ReturnType<typeof useSavedDepartures>
  nowMs: number
  online: boolean
}) {
  const unconfirmedBefore = useUnconfirmedBefore()
  // Not live (offline, a cached copy, or data generated over a minute ago): never show the last live estimates;
  // timetable rows from the device's copies instead.
  const models = items.map((it, i) => {
    const data = qs[i]?.data
    const live = liveState(data, { offline: !online, nowMs, unconfirmedBefore }) == null
    return cardModel(it, live ? data : asOffline(it, data ?? null), nowMs)
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
        return (
          <SavedTripCard
            key={it.id}
            mode={it.mode}
            label={m.label}
            title={m.title}
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
      })}
    </div>
  )
}

export default function Saved({ loaderData }: Route.ComponentProps) {
  const now = useNow(loaderData.renderedAt)
  const online = useOnline()
  // localStorage is client-only: read after hydration (the server renders the Ask box and an empty list).
  const [items, setItems] = useState<SavedItem[] | null>(null)
  useEffect(() => setItems(readSavedItems()), [])
  const { mode, fetcher } = useApi()
  const qs = useSavedDepartures(fetcher, mode, items ?? [])
  const unconfirmedBefore = useUnconfirmedBefore()
  const { live, unconfirmed } = homeLiveState(
    items,
    qs.map((q) => ({ data: q.data, pending: q.isPending })),
    { online, nowMs: now, unconfirmedBefore },
  )
  return (
    <>
      <TransitHeader live={live} />
      <TransitStrip updatedAt={items ? now : null}>
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
        <AskBox />
        {/* A card built from offline copies keeps the banner until its own network answer (R6-B1), and so does a page
            served from the device's copy until a card has one (R7-T1). */}
        {!online || unconfirmed || qs.some((q) => q.data?.offline) ? (
          <OfflineBanner kind="offline" detail="Showing saved timetables. No live times." />
        ) : null}
        {items == null ? (
          <p data-loading="" className="text-sm text-sched-text dark:text-night-text/70">
            Loading your saved stops…
          </p>
        ) : items.length ? (
          <SavedList items={items} qs={qs} nowMs={now} online={online} />
        ) : (
          <EmptyState title="Nothing saved yet">
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
