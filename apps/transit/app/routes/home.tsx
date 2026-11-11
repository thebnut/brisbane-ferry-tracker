/**
 * / (release 24): BrisbaneTransit's landing page, the one page of this site's own in search. What the site does and a
 * way into each tab; My Transit (the visitor's saved stops) moved to /saved, and a visitor with saved stops gets a
 * clear way back to it at the top once the page has read this device's storage (after hydration, lib/has-saved.ts).
 */
import { Icon, type IconName, OfflineBanner } from '@bft/ui'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { TransitFooter, TransitHeader } from '../components/Chrome.tsx'
import { hasSavedStops } from '../lib/has-saved.ts'
import { MODE_BASES } from '../lib/modes.ts'
import { POPULAR, type PopularPlace } from '../lib/popular.ts'
import { getEnv } from '../lib/server.server.ts'
import { useOnline } from '../lib/useNow.ts'
import type { Route } from './+types/home'

/** The site's name in og:site_name and JSON-LD (the mode pages use the same, @bft/core/seo TRANSIT_SITE_NAME). */
export const SITE_NAME = 'Brisbane Transit'
export const HOME_TITLE = 'BrisbaneTransit: live Brisbane ferry, train and bus departures'
export const HOME_DESCRIPTION =
  'Live departure boards for every Brisbane ferry terminal, train station and bus stop, with real-time times, ' +
  'service alerts and what is leaving near you.'

export function loader({ context }: Route.LoaderArgs) {
  return { siteUrl: getEnv(context)?.SITE_URL ?? 'https://brisbanetransit.com' }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  const siteUrl = loaderData?.siteUrl ?? 'https://brisbanetransit.com'
  const url = `${siteUrl}/`
  // The 1200×630 share card (public/og-image.jpg), as every mode page here uses.
  const image = `${siteUrl}/og-image.jpg`
  return [
    { title: HOME_TITLE },
    { name: 'description', content: HOME_DESCRIPTION },
    { tagName: 'link', rel: 'canonical', href: url },
    { property: 'og:type', content: 'website' },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:locale', content: 'en_AU' },
    { property: 'og:url', content: url },
    { property: 'og:title', content: HOME_TITLE },
    { property: 'og:description', content: HOME_DESCRIPTION },
    { property: 'og:image', content: image },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: 'Brisbane Transit: live ferry, train and bus departures' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: HOME_TITLE },
    { name: 'twitter:description', content: HOME_DESCRIPTION },
    { name: 'twitter:image', content: image },
    {
      'script:ld+json': {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        // The mode pages' JSON-LD names this node as the site they are part of.
        '@id': `${siteUrl}/#website`,
        name: SITE_NAME,
        alternateName: ['BrisbaneTransit'],
        url,
        description: HOME_DESCRIPTION,
        inLanguage: 'en-AU',
      },
    },
  ]
}

/** The ways in, in the Mode Tabs' order after My Transit. */
export const SECTIONS: { href: string; icon: IconName; title: string; text: string }[] = [
  {
    href: MODE_BASES.ferry,
    icon: 'ferry',
    title: 'Ferry',
    text: 'CityCat and ferry departures from every terminal on the Brisbane River, live where the boat reports it.',
  },
  {
    href: MODE_BASES.train,
    icon: 'train',
    title: 'Train',
    text: 'Departure boards for every Queensland Rail station in South East Queensland, by line and platform.',
  },
  {
    href: MODE_BASES.bus,
    icon: 'bus',
    title: 'Bus',
    text: 'The next buses at any stop in Brisbane, with route pages and live times.',
  },
  {
    href: '/nearby',
    icon: 'nearby',
    title: 'Nearby',
    text: "What's leaving around you right now: ferry, train and bus together.",
  },
  {
    href: '/saved',
    icon: 'saved',
    title: 'My Transit',
    text: 'Save the stops you use and see their next departures from every mode in one list.',
  },
]

/** Whether this device has saved stops, read after hydration (false before). */
function useHasSaved(): boolean {
  const [saved, setSaved] = useState(false)
  useEffect(() => setSaved(hasSavedStops()), [])
  return saved
}

const card =
  'bg-board-header flex items-center gap-3 rounded-card border border-ferry-orange/15 px-3.5 py-3 text-charcoal no-underline dark:text-night-text'

const chip =
  'flex min-h-10 items-center rounded-full border border-ferry-orange/20 bg-white/90 px-3.5 text-[13px] font-semibold text-aqua-text no-underline dark:bg-night-card dark:text-ferry-aqua-light'

/** The busiest places in each mode as plain links (lib/popular.ts): in the server HTML, for people and crawlers. */
const POPULAR_GROUPS: {
  id: string
  title: string
  places: PopularPlace[]
  all: { href: string; text: string }
}[] = [
  {
    id: 'popular-ferry',
    title: 'Ferry terminals',
    places: POPULAR.ferry,
    all: { href: `${MODE_BASES.ferry}/`, text: 'All terminals' },
  },
  {
    id: 'popular-train',
    title: 'Train stations',
    places: POPULAR.train,
    all: { href: `${MODE_BASES.train}/stations`, text: 'All stations' },
  },
  {
    id: 'popular-bus',
    title: 'Bus stops',
    places: POPULAR.bus,
    all: { href: `${MODE_BASES.bus}/stops`, text: 'All stops A–Z' },
  },
]

export default function Home() {
  const saved = useHasSaved()
  const online = useOnline()
  return (
    <>
      <TransitHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-3.5 pt-3.5 pb-4 md:px-4">
        {saved ? (
          <Link
            to="/saved"
            prefetch="intent"
            data-saved-entry=""
            className={`${card} min-h-12 justify-between`}
          >
            <span className="flex items-center gap-2.5 font-semibold">
              <Icon name="saved" size={20} className="text-aqua-text dark:text-ferry-aqua-light" />
              My Transit: your saved stops
            </span>
            <span aria-hidden="true" className="text-ferry-orange-dark">
              ›
            </span>
          </Link>
        ) : null}
        {online ? null : (
          <OfflineBanner
            kind="offline"
            detail="Your saved stops and the timetables on this device still open."
          />
        )}
        <h1 className="text-[22px] font-extrabold">Live Brisbane ferry, train and bus departures</h1>
        <p className="text-sched-text dark:text-night-text/80">
          BrisbaneTransit shows when the next ferry, train or bus leaves, from Translink's live data: every
          ferry terminal, train station and bus stop in Brisbane, in one place.
        </p>
        <nav aria-label="BrisbaneTransit sections">
          <ul className="grid gap-3 md:grid-cols-2">
            {SECTIONS.map((s) => (
              <li key={s.href}>
                <Link to={s.href} prefetch="intent" className={`${card} h-full`}>
                  <Icon
                    name={s.icon}
                    size={24}
                    className="shrink-0 text-aqua-text dark:text-ferry-aqua-light"
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="font-bold">{s.title}</span>
                    <span className="text-sm text-sched-text dark:text-night-text/80">{s.text}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-labelledby="popular" className="flex flex-col gap-3">
          <h2 id="popular" className="text-lg font-extrabold">
            Popular departures
          </h2>
          {POPULAR_GROUPS.map((g) => (
            <div key={g.id} className="flex flex-col gap-2">
              <h3
                id={g.id}
                className="text-[13px] font-bold tracking-[0.06em] text-aqua-text uppercase dark:text-ferry-aqua-light"
              >
                {g.title}
              </h3>
              <ul aria-labelledby={g.id} className="flex flex-wrap gap-2">
                {g.places.map((p) => (
                  <li key={p.href}>
                    <Link to={p.href} className={chip}>
                      {p.name}
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to={g.all.href} className={`${chip} text-ferry-orange-deep dark:text-ferry-sunset`}>
                    {g.all.text}
                  </Link>
                </li>
              </ul>
            </div>
          ))}
        </section>
      </main>
      <TransitFooter />
    </>
  )
}
