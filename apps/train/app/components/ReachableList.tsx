/**
 * The reachable-only destination picker (T-Search "Reachable from Roma Street, by line"): one card per display line
 * and direction, with the stations you can reach without changing trains, in travel order.
 */
import { cx, LineChip } from '@bft/ui'
import { lineLabel } from '../lib/lineNames.ts'
import { reachableFrom, type Station } from '../lib/network.ts'

export function ReachableList({
  from,
  selected,
  onPick,
  filter,
}: {
  from: Station
  selected?: string | null
  onPick: (key: string) => void
  /** Only show stations whose name matches (the "To" field's text), case-insensitive prefix of a word. */
  filter?: string
}) {
  const q = (filter ?? '').trim().toLowerCase()
  const match = (s: Station) =>
    !q ||
    s.name
      .toLowerCase()
      .split(/[\s-]+/)
      .some((w) => w.startsWith(q)) ||
    s.name.toLowerCase().startsWith(q)
  const groups = reachableFrom(from.key)
    .map((g) => ({ ...g, stations: g.stations.filter(match) }))
    .filter((g) => g.stations.length > 0)
  if (groups.length === 0) {
    return <p className="text-sm text-sched-text">No station with a direct train from {from.name} matches.</p>
  }
  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((g) => (
        <section
          key={`${g.line.name}|${g.towards}`}
          aria-label={`${lineLabel(g.line.name)} towards ${g.towards}`}
          data-line={g.line.name}
          className="flex flex-col gap-2 rounded-card bg-white/90 px-3.5 py-3 shadow-card dark:bg-night-card"
        >
          <div className="flex items-center gap-2">
            <LineChip name={g.line.name} color={g.line.color} solid />
            <span className="ml-auto text-xs text-gray-600 dark:text-night-text/70">to {g.towards}</span>
          </div>
          <ul className="flex flex-wrap gap-1.5">
            {g.stations.map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => onPick(s.key)}
                  aria-pressed={selected === s.key}
                  className={cx(
                    'min-h-8 rounded-full border px-3 py-1.5 text-[13px] font-semibold',
                    selected === s.key
                      ? 'border-ferry-orange-aa bg-ferry-orange-aa text-white'
                      : 'border-[#EADBD2] bg-[#F7F2EF] text-charcoal hover:border-ferry-orange dark:border-night-2 dark:bg-night-2 dark:text-night-text',
                  )}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
