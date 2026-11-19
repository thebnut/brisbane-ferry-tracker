/**
 * The bus stop directory (/stops, /stops/:letter, /stops/:letter/:page): every stop in data/bus/stops.json, A to Z by
 * name, as plain links in the server HTML. The ~12,400 stop pages were otherwise reachable only through the sitemap,
 * search and the client-side map. The index has no suburb field, so stops are grouped by the first letter of their
 * name (a street or a station), DIRECTORY_PAGE_SIZE to a page. Shared by the page's loader and transit's sitemap.
 */
import { stopEntriesFromIndexText } from './seo.ts'

/** Stops per page: at most three pages for the biggest letters (B, S, M, C), each a reasonable number of links. */
export const DIRECTORY_PAGE_SIZE = 500

/** The letter groups, in order: a–z, then everything else (names starting with a digit or a symbol). */
export const DIRECTORY_LETTERS: readonly string[] = [...'abcdefghijklmnopqrstuvwxyz', '0-9']

export interface DirectoryStop {
  id: string
  name: string
}

/** Stops by letter group, each sorted by name (then id); only groups with stops. */
export type Directory = ReadonlyMap<string, readonly DirectoryStop[]>

export function directoryLetter(name: string): string {
  const c = name.trim().charAt(0).toLowerCase()
  return c >= 'a' && c <= 'z' ? c : '0-9'
}

export const directoryLabel = (letter: string) => (letter === '0-9' ? '0–9' : letter.toUpperCase())

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function buildDirectory(entries: readonly { key: string; name: string }[]): Directory {
  const groups = new Map<string, DirectoryStop[]>()
  for (const e of entries) {
    const letter = directoryLetter(e.name)
    let list = groups.get(letter)
    if (!list) {
      list = []
      groups.set(letter, list)
    }
    list.push({ id: e.key, name: e.name })
  }
  for (const list of groups.values())
    list.sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id))
  return new Map(DIRECTORY_LETTERS.filter((l) => groups.has(l)).map((l) => [l, groups.get(l) ?? []]))
}

/** The directory from the raw stops.json text (once per stop, index entries only). */
export const directoryFromIndexText = (text: string): Directory =>
  buildDirectory(stopEntriesFromIndexText(text))

export const pageCount = (stops: number) => Math.max(1, Math.ceil(stops / DIRECTORY_PAGE_SIZE))

/** Canonical (unprefixed) paths, like stopPath: `/stops`, `/stops/b`, `/stops/b/2`. Page 1 has no number. */
export function directoryPath(letter?: string | null, page = 1): string {
  if (!letter) return '/stops'
  return page > 1 ? `/stops/${letter}/${page}` : `/stops/${letter}`
}

/** Every directory page, for the sitemap: the A–Z page, then each letter's pages. Counts per letter are enough. */
export function directoryPaths(counts: ReadonlyMap<string, number>): string[] {
  const out = [directoryPath()]
  for (const letter of DIRECTORY_LETTERS) {
    const n = counts.get(letter) ?? 0
    if (!n) continue
    for (let p = 1; p <= pageCount(n); p++) out.push(directoryPath(letter, p))
  }
  return out
}

/** Stops per letter group, without sorting (the sitemap needs only how many pages each letter has). */
export function directoryCounts(entries: readonly { name: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of entries) {
    const l = directoryLetter(e.name)
    counts.set(l, (counts.get(l) ?? 0) + 1)
  }
  return counts
}

/**
 * The page a request names: a known letter and a page number written canonically (no leading zeros; page 1 only as
 * the bare letter). Null for anything else (a 404). `redirect` when the page is valid but written another way
 * (`/stops/B`, `/stops/b/1`).
 */
export function parseDirectoryParams(
  letterParam: string | undefined,
  pageParam: string | undefined,
): { letter: string | null; page: number; redirect: boolean } | null {
  if (letterParam === undefined)
    return pageParam === undefined ? { letter: null, page: 1, redirect: false } : null
  const letter = letterParam.toLowerCase()
  if (!DIRECTORY_LETTERS.includes(letter)) return null
  if (pageParam === undefined) return { letter, page: 1, redirect: letter !== letterParam }
  if (!/^\d{1,4}$/.test(pageParam)) return null
  const page = Number(pageParam)
  if (page < 1) return null
  return { letter, page, redirect: letter !== letterParam || String(page) !== pageParam || page === 1 }
}
