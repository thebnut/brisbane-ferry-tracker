/** The "What's new" page body (/whats-new): the last five releases from changelog.ts. Its own route chunk in each app. */
import { CHANGELOG, type ChangelogEntry } from './changelog.ts'

const SHOWN = 5

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

/** "2026-10-21" → "21 October 2026", the same on the server and in the browser. */
export function changelogDate(date: string): string {
  const [y, m, d] = date.split('-')
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`
}

export function WhatsNew({ entries = CHANGELOG }: { entries?: ChangelogEntry[] }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-8 text-charcoal dark:text-night-text">
      <h1 className="text-2xl font-extrabold">What’s new</h1>
      <p className="mt-2 text-sm text-gray-700 dark:text-night-text/80">
        The latest improvements, newest first.
      </p>
      <ol className="mt-6 space-y-6">
        {entries.slice(0, SHOWN).map((e) => (
          <li key={`${e.date}-${e.summary}`} className="border-l-4 border-ferry-orange pl-4">
            <h2 className="text-xs font-bold tracking-[0.06em] text-aqua-text uppercase dark:text-ferry-aqua-light">
              <time dateTime={e.date}>{changelogDate(e.date)}</time>
            </h2>
            <p className="mt-1 font-semibold">{e.summary}</p>
            {e.items?.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-700 dark:text-night-text/80">
                {e.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
    </main>
  )
}
