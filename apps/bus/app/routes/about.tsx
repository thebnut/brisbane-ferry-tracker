/** /about: data sources, attribution, privacy in brief. Prerendered at build time. */
import { BusNav, Footer, SiteHeader } from '../components/Shell.tsx'
import { ATTRIBUTION, pageMeta, SITE_URL } from '../lib/seo.ts'
import { getEnv } from '../lib/server.server.ts'
import type { Route } from './+types/about'

/** The site's own URL (inside BrisbaneTransit, its page there), for the canonical and OG tags. */
export function loader({ context }: Route.LoaderArgs) {
  return { siteUrl: getEnv(context)?.SITE_URL ?? SITE_URL }
}

export const meta: Route.MetaFunction = ({ loaderData }) =>
  pageMeta({
    title: 'About BrisbaneBus and its data',
    description: 'Where BrisbaneBus gets its timetables and live times, and what it keeps on your device.',
    url: `${loaderData?.siteUrl ?? SITE_URL}/about`,
    siteUrl: loaderData?.siteUrl,
  })

export default function About() {
  return (
    <>
      <SiteHeader />
      <main className="prose-about mx-auto max-w-3xl px-4 py-6">
        <h1 className="text-2xl font-extrabold">About BrisbaneBus</h1>
        <p className="mt-2">
          Live departure boards for every bus stop and busway platform in South East Queensland, including
          Brisbane Metro, CityGlider and BUZ services.
        </p>
        <h2>Where the times come from</h2>
        <ul>
          <li>Timetables: TransLink's published GTFS feed, rebuilt every night.</li>
          <li>
            Live times, cancellations and bus positions: TransLink's GTFS-realtime feeds, checked every 15
            seconds by one shared server for everyone (your browser never polls TransLink directly).
          </li>
          <li>
            "LIVE" means a real-time prediction; "SCHEDULED" means the timetable time. "GPS" means the bus is
            reporting its position.
          </li>
        </ul>
        <h2>On your device</h2>
        <p>
          Saved stops, recent searches, your theme and offline timetables for saved stops are stored in your
          browser only. Nearby uses your location in the browser to pick map tiles; it is never sent to us.
        </p>
        <h2>Licence</h2>
        <p>
          {ATTRIBUTION.text}, licensed under{' '}
          <a href={ATTRIBUTION.licenceUrl} target="_blank" rel="noopener noreferrer">
            {ATTRIBUTION.licenceName}
          </a>
          . BrisbaneBus is not affiliated with TransLink.
        </p>
      </main>
      <Footer />
      <BusNav active="" />
    </>
  )
}
