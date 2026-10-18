/**
 * The Ask box (Phase 8 UI): "next train from Bowen Hills to the airport" → POST /v1/ask. Answer rows render with the
 * shared DepartureCard. An invisible Turnstile token goes with every question when Turnstile answers (the LLM
 * fallback needs it; the deterministic parser doesn't), and every `ai.reason` gets a friendly line (ask.ts).
 */
import { Icon, PrimaryButton } from '@bft/ui'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { type AskResult, postAsk } from '../lib/ask.ts'
import { invisibleTurnstile } from '../lib/turnstile.ts'

// Answer rows (shared DepartureCard) load with the first answer, keeping them off the home page's first load.
const AskAnswer = lazy(() => import('./AskAnswer.tsx'))

const EXAMPLES = [
  'next train from Bowen Hills to the airport',
  'next ferry from Bulimba',
  'alerts on the Ferny Grove line',
]

export function AskBox() {
  const root = useRouteLoaderData('root') as
    | { turnstileSitekey?: string | null; fixtures?: boolean }
    | undefined
  const sitekey = root?.turnstileSitekey ?? null
  const fixtures = root?.fixtures ?? false
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)
  const holder = useRef<HTMLDivElement>(null)
  const abort = useRef<AbortController | null>(null)
  const ts = useMemo(
    () => (sitekey && !fixtures ? invisibleTurnstile(sitekey, () => holder.current) : null),
    [sitekey, fixtures],
  )
  useEffect(() => () => ts?.dispose(), [ts])

  async function ask(question: string) {
    const text = question.trim()
    if (!text || busy) return
    setBusy(true)
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    try {
      const token = ts ? await ts.token() : null
      setResult(await postAsk(text, token, { fixtures, signal: ctl.signal }))
    } catch {
      // Aborted by a newer question.
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="ask-heading" className="flex flex-col gap-2.5">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(q)
        }}
        className="flex flex-col gap-1.5"
      >
        <label
          id="ask-heading"
          htmlFor="ask"
          className="text-sm font-semibold text-aqua-text dark:text-ferry-aqua-light"
        >
          Ask
        </label>
        <div className="flex items-center gap-2 rounded-full border-2 border-ferry-orange/40 bg-white py-1 pr-1 pl-3.5 shadow-card focus-within:border-ferry-orange dark:bg-night-card">
          <Icon name="ask" size={20} className="shrink-0 text-ferry-orange-dark" />
          <input
            id="ask"
            name="question"
            type="text"
            maxLength={300}
            autoComplete="off"
            enterKeyHint="send"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => ts?.warm()}
            placeholder="next train from Bowen Hills to the airport"
            className="min-w-0 flex-1 bg-transparent py-2 text-base outline-none placeholder:text-gray-500 dark:placeholder:text-night-text/60"
          />
          <PrimaryButton
            type="submit"
            disabled={busy || !q.trim()}
            className="h-10 rounded-full px-4 text-sm"
          >
            {busy ? 'Asking…' : 'Ask'}
          </PrimaryButton>
        </div>
      </form>
      {/* Turnstile renders here only if it ever needs an interaction (invisible otherwise). */}
      <div ref={holder} data-turnstile />
      {result ? (
        <Suspense fallback={<p className="text-sm text-sched-text">{result.answer}</p>}>
          <AskAnswer result={result} />
        </Suspense>
      ) : (
        <ul className="flex flex-wrap gap-1.5" aria-label="Try asking">
          {EXAMPLES.map((e) => (
            <li key={e}>
              <button
                type="button"
                onClick={() => {
                  setQ(e)
                  ts?.warm()
                  void ask(e)
                }}
                className="rounded-full border border-ferry-orange/25 bg-white/80 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:bg-night-card dark:text-night-text"
              >
                {e}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
