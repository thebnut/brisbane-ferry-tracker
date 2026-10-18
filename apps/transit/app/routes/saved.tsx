/**
 * / (Saved tab, X-Home): the Ask box, then saved stops and trips from every mode as cards (next departure, countdown,
 * "Then …"), soonest highlighted. Saved items live in each app's own storage on this device (saved.ts), so the list
 * renders after hydration; offline, cards show scheduled times from the device's copies ("Offline · scheduled").
 */
import type { DeparturesResponse } from '@bft/core/contract'
import {
  EmptyState,
  formatClock,
  Icon,
  liveState,
  minutesUntil,
  OfflineBanner,
  SavedTripCard,
  vesselName,
} from '@bft/ui'
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
    time: dep ? `${formatClock(dep)}${arr ? ` → ${formatClock(arr)}` : ''}` : null,
    detail,
    minutes: dep ? minutesUntil(dep, nowMs) : null,
    later:
      rows
        .slice(1, 3)
        .map((d) => `${formatClock(d.estDep ?? d.schedDep)} ${d.route.short}`)
        .join('   ') || null,
    next: dep,
  }
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
  // Not live (offline, a cached copy, or data generated over a minute ago): never show the last live estimates;
  // timetable rows from the device's copies instead.
  const models = items.map((it, i) => {
    const data = qs[i]?.data
    const live = liveState(data, { offline: !online, nowMs }) == null
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
              : 'No more departures today.'
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
  // LIVE in the header only while every loaded card's data is live and fresh (same rule as the cards).
  const live = online && qs.every((q) => !q.data || liveState(q.data, { offline: false, nowMs: now }) == null)
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
        {!online ? <OfflineBanner kind="offline" detail="Showing saved timetables. No live times." /> : null}
        {items == null ? null : items.length ? (
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
