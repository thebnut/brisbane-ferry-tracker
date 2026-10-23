/**
 * "Find a terminal" at the top of ferry home (THE-118 PR 8): the shared stop search over the terminals bundled with
 * the app; a pick opens that terminal's board. Its own chunk, loaded after hydration (Ark UI), off the first load.
 */
import { type StopOption, StopSearch } from '@bft/ui/stop-search'
import { useNavigate } from 'react-router'
import { cleanStopName } from '../lib/names.ts'
import { TERMINALS, terminalById, terminalHref } from '../lib/terminals.ts'

const OPTIONS: StopOption[] = TERMINALS.map((t) => ({ id: t.id, name: cleanStopName(t.name) })).sort((a, b) =>
  a.name.localeCompare(b.name),
)

export default function TerminalSearch() {
  const navigate = useNavigate()
  return (
    <StopSearch
      label="Find a terminal"
      placeholder="Terminal name"
      options={OPTIONS}
      value={null}
      onChange={(id) => {
        const t = terminalById(id)
        if (t) navigate(terminalHref(t.slug))
      }}
    />
  )
}
