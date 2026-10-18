/**
 * Headless stop search combobox (Ark UI combobox, list in a portal). Styling is the ferry look; the filter is
 * pluggable so bus can pass uFuzzy later. Exported from `@bft/ui/stop-search` so apps load it only where used.
 */
import { createListCollection } from '@ark-ui/react/collection'
import { Combobox } from '@ark-ui/react/combobox'
import { Portal } from '@ark-ui/react/portal'
import { useMemo, useState } from 'react'
import { Icon } from './icons.tsx'

export interface StopOption {
  id: string
  name: string
  /** Secondary line, e.g. "Stop 317584" or "2.1 km". */
  detail?: string
  disabled?: boolean
}

export interface StopSearchProps {
  label: string
  options: StopOption[]
  value: string | null
  onChange: (id: string) => void
  placeholder?: string
  /** Custom matcher; default matches every word of the query against the start of words in the name. */
  filter?: (query: string, options: StopOption[]) => StopOption[]
  /** Render the list inline instead of in a portal (inside dialogs that are in the top layer). */
  inline?: boolean
}

/** Default matcher: each query word must prefix some word of the name (case/diacritic-insensitive). */
export function matchStops(query: string, options: StopOption[]): StopOption[] {
  const norm = (s: string) =>
    s
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
  const q = norm(query).trim().split(/\s+/).filter(Boolean)
  if (q.length === 0) return options
  return options.filter((o) => {
    const words = norm(`${o.name} ${o.detail ?? ''}`).split(/[^a-z0-9]+/)
    return q.every((part) => words.some((w) => w.startsWith(part)))
  })
}

export function StopSearch({
  label,
  options,
  value,
  onChange,
  placeholder = 'Stop name',
  filter = matchStops,
  inline = false,
}: StopSearchProps) {
  const selectedName = options.find((o) => o.id === value)?.name ?? ''
  const [query, setQuery] = useState<string | null>(null)
  const visible = useMemo(() => filter(query ?? '', options), [filter, query, options])
  const collection = useMemo(
    () =>
      createListCollection({
        items: visible,
        itemToValue: (o) => o.id,
        itemToString: (o) => o.name,
        isItemDisabled: (o) => !!o.disabled,
      }),
    [visible],
  )

  const content = (
    <Combobox.Positioner className="z-[60] w-[var(--reference-width)]">
      <Combobox.Content className="max-h-72 overflow-y-auto rounded-card border border-ferry-orange/20 bg-white p-1 shadow-xl dark:bg-night-card">
        {visible.length === 0 ? <p className="px-3 py-2 text-sm text-sched-text">No matching stops</p> : null}
        {visible.map((o) => (
          <Combobox.Item
            key={o.id}
            item={o}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-button px-3 py-2.5 text-sm data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-ferry-orange-light data-[state=checked]:font-bold dark:data-highlighted:bg-night-2"
          >
            <Combobox.ItemText>{o.name}</Combobox.ItemText>
            {o.detail ? <span className="text-xs text-sched-text">{o.detail}</span> : null}
          </Combobox.Item>
        ))}
      </Combobox.Content>
    </Combobox.Positioner>
  )

  return (
    <Combobox.Root
      collection={collection}
      value={value ? [value] : []}
      inputValue={query ?? selectedName}
      onInputValueChange={(d) => setQuery(d.inputValue)}
      onValueChange={(d) => {
        const id = d.value[0]
        setQuery(null)
        if (id) onChange(id)
      }}
      onOpenChange={(d) => {
        if (!d.open) setQuery(null)
      }}
      openOnClick
      selectionBehavior="replace"
      className="flex flex-col gap-1"
    >
      <Combobox.Label className="text-sm font-semibold text-gray-700 dark:text-night-text/80">
        {label}
      </Combobox.Label>
      <Combobox.Control className="relative">
        <Icon
          name="search"
          size={18}
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ferry-orange"
        />
        <Combobox.Input
          placeholder={placeholder}
          className="h-12 w-full rounded-card border-2 border-ferry-orange/30 bg-white pr-10 pl-10 text-base font-semibold text-aqua-text placeholder:font-normal placeholder:text-gray-500 focus:border-ferry-orange dark:bg-night-2 dark:text-ferry-aqua-light"
        />
        <Combobox.Trigger
          aria-label={`Show all ${label.toLowerCase()} options`}
          className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center text-ferry-orange"
        >
          <Icon name="chevronDown" size={18} />
        </Combobox.Trigger>
      </Combobox.Control>
      {inline ? content : <Portal>{content}</Portal>}
    </Combobox.Root>
  )
}
