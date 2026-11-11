/**
 * /stops, /stops/:letter, /stops/:letter/:page: the bus stop directory (lib/stop-directory.ts). Every stop's page as a
 * real link in the server HTML, A to Z by name and paged, for people browsing and for crawlers. The A–Z page lists the
 * letters with how many stops each has. Indexable, in the sitemap, each page its own canonical.
 */
import { data, Link, redirect } from 'react-router'
import { BusNav, Footer, SiteHeader } from '../components/Shell.tsx'
import { at } from '../lib/base.ts'
import { pageMeta, SITE_NAME, SITE_URL } from '../lib/seo.ts'
import { fixtureFallbackOn, loaderEnv, settle } from '../lib/server.server.ts'
import { cachedDirectory, loadDirectory } from '../lib/stop-directory.server.ts'
import {
  DIRECTORY_PAGE_SIZE,
  type DirectoryStop,
  directoryLabel,
  directoryPath,
  pageCount,
  parseDirectoryParams,
} from '../lib/stop-directory.ts'
import { stopCode, stopHref } from '../lib/stops.ts'
import type { Route } from './+types/stops'

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const parsed = parseDirectoryParams(params.letter, params.page)
  if (!parsed) throw data(null, { status: 404 })
  const { letter, page } = parsed
  if (parsed.redirect) throw redirect(`${at(directoryPath(letter, page))}${new URL(request.url).search}`, 301)
  const { fetcher, env, fixtures } = loaderEnv(request, context)
  const siteUrl = env?.SITE_URL ?? SITE_URL
  const dir = await settle(
    (signal) =>
      cachedDirectory(() => loadDirectory(fetcher, signal), { cache: !fixtures && !fixtureFallbackOn(env) }),
    5000,
  )
  // The stop index couldn't be read: say so, and a 503 so the page isn't indexed or cached as the directory.
  if (!dir)
    return data(
      { siteUrl, letter, page, pages: 0, letters: [], stops: [], unavailable: true },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    )
  const letters = [...dir].map(([l, list]) => ({ letter: l, count: list.length }))
  if (!letter) return { siteUrl, letter, page, pages: 1, letters, stops: [], unavailable: false }
  const all = dir.get(letter)
  if (!all) throw data(null, { status: 404 })
  const pages = pageCount(all.length)
  if (page > pages) throw data(null, { status: 404 })
  const stops: DirectoryStop[] = all.slice((page - 1) * DIRECTORY_PAGE_SIZE, page * DIRECTORY_PAGE_SIZE)
  return { siteUrl, letter, page, pages, letters, stops, unavailable: false }
}

/**
 * A directory page is the same for everyone and changes with a data publish at most: public for an hour. The 503 (stop
 * index unreadable) keeps its loader's no-store, so no cache holds the outage page after the data is back (Codex r1).
 */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return { 'cache-control': loaderHeaders.get('cache-control') ?? 'public, max-age=3600' }
}

/** Title and description for a directory page (each one unique: letter and page). */
export function directoryMeta(letter: string | null, page: number, pages: number, stops: DirectoryStop[]) {
  if (!letter)
    return {
      title: `Brisbane bus stops A–Z | ${SITE_NAME}`,
      description:
        'Every Brisbane and South East Queensland bus stop by name, A to Z, each with its live departures and the routes that stop there.',
    }
  const label = directoryLabel(letter)
  const range = stops.length > 1 ? ` from ${stops[0]?.name} to ${stops[stops.length - 1]?.name}` : ''
  const of = pages > 1 ? ` (page ${page} of ${pages})` : ''
  return {
    title: `Bus stops: ${label}${of} | ${SITE_NAME}`,
    description: `Brisbane bus stops starting with ${label}${range}${pages > 1 ? `, page ${page} of ${pages}` : ''}. Live departures from each stop.`,
  }
}

export const meta: Route.MetaFunction = ({ loaderData }) => {
  if (!loaderData) return [{ title: `Bus stops | ${SITE_NAME}` }, { name: 'robots', content: 'noindex' }]
  const { siteUrl, letter, page, pages, stops, unavailable } = loaderData
  const m = directoryMeta(letter, page, pages, stops)
  return pageMeta({ ...m, url: `${siteUrl}${directoryPath(letter, page)}`, siteUrl, noindex: unavailable })
}

const LINK =
  'block py-1.5 text-aqua-text underline-offset-2 hover:text-ferry-orange-deep hover:underline dark:text-ferry-aqua-light'
const PILL =
  'flex min-h-10 min-w-10 items-center justify-center rounded-full border border-ferry-orange/20 bg-white/90 px-3 text-sm font-semibold text-aqua-text dark:bg-night-card dark:text-ferry-aqua-light'

function LetterNav({
  letters,
  current,
}: {
  letters: { letter: string; count: number }[]
  current: string | null
}) {
  return (
    <nav aria-label="Stops by first letter">
      <ul className="flex flex-wrap gap-1.5">
        {letters.map(({ letter }) => (
          <li key={letter}>
            <Link
              to={at(directoryPath(letter))}
              aria-current={letter === current ? 'page' : undefined}
              className={`${PILL} ${letter === current ? 'border-ferry-orange bg-ferry-orange/10' : ''}`}
            >
              {directoryLabel(letter)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Pager({ letter, page, pages }: { letter: string; page: number; pages: number }) {
  if (pages < 2) return null
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-1.5">
      {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
        <Link
          key={p}
          to={at(directoryPath(letter, p))}
          aria-current={p === page ? 'page' : undefined}
          aria-label={`Page ${p} of ${pages}`}
          className={`${PILL} ${p === page ? 'border-ferry-orange bg-ferry-orange/10' : ''}`}
        >
          {p}
        </Link>
      ))}
    </nav>
  )
}

export default function Stops({ loaderData }: Route.ComponentProps) {
  const { letter, page, pages, letters, stops, unavailable } = loaderData
  const label = letter ? directoryLabel(letter) : null
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-4 pb-6">
        <nav aria-label="Breadcrumb" className="text-sm text-gray-700 dark:text-night-text/80">
          <Link className="underline" to={at('/')}>
            Bus
          </Link>
          {' › '}
          {letter ? (
            <>
              <Link className="underline" to={at(directoryPath())}>
                All stops
              </Link>
              {' › '}
              {label}
            </>
          ) : (
            'All stops'
          )}
        </nav>
        <h1 className="text-[22px] leading-tight font-extrabold">
          {letter
            ? `Bus stops: ${label}${pages > 1 ? ` (page ${page} of ${pages})` : ''}`
            : 'Brisbane bus stops A–Z'}
        </h1>
        {unavailable ? (
          <p role="status" className="text-sched-text dark:text-night-text/80">
            The stop list can't be loaded right now. Try again shortly, or{' '}
            <Link className="underline" to={at('/')}>
              search for a stop by name or number
            </Link>
            .
          </p>
        ) : (
          <>
            <p className="text-sm text-gray-700 dark:text-night-text/80">
              {letter
                ? `Stops whose name starts with ${label}, in order. Open one for its live departures.`
                : 'Every bus stop, by the first letter of its name (usually the street). Open a stop for its live departures, or search by name or number on the Bus page.'}
            </p>
            <LetterNav letters={letters} current={letter} />
            {letter ? (
              <>
                <Pager letter={letter} page={page} pages={pages} />
                <ul className="grid gap-x-4 sm:grid-cols-2" data-stop-directory="">
                  {stops.map((s) => {
                    const code = stopCode(s.id)
                    return (
                      <li key={s.id}>
                        <Link className={LINK} to={stopHref(s.id)}>
                          {s.name}
                          {code ? (
                            <span className="text-sched-text dark:text-night-text/70"> · {code}</span>
                          ) : null}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
                <Pager letter={letter} page={page} pages={pages} />
              </>
            ) : (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3" data-stop-directory="">
                {letters.map(({ letter: l, count }) => (
                  <li key={l}>
                    <Link className={LINK} to={at(directoryPath(l))}>
                      {directoryLabel(l)}: {count.toLocaleString('en-AU')} stops
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>
      <Footer />
      <BusNav active="" />
    </>
  )
}
