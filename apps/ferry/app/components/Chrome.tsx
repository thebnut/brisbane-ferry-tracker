/** Site header, footer and the crawlable intro shared by every page. */
import { AppHeader, LivePill, SettingsPill } from '@bft/ui'
import lockup489 from '@bft/ui/assets/ferry-lockup.webp?url'
import lockup236 from '@bft/ui/assets/ferry-lockup-236.webp?url'
import lockup360 from '@bft/ui/assets/ferry-lockup-360.webp?url'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { at } from '../lib/base.ts'
import { ATTRIBUTION, INTRO_HEADING, INTRO_TEXT } from '../lib/seo.ts'
import { TERMINALS, terminalHref } from '../lib/terminals.ts'

export const SECTION = {
  section: 'mx-auto max-w-6xl px-4 pt-4 pb-2 text-charcoal',
  heading: 'text-lg font-bold text-aqua-text md:text-xl',
  text: 'mt-2 max-w-3xl text-sm text-gray-700',
  subheading: 'mt-4 text-sm font-semibold text-gray-700',
  list: 'mt-2 flex flex-wrap gap-2 text-sm',
  link: 'inline-block rounded-full border border-ferry-orange/20 bg-white/80 px-3 py-1 text-aqua-text transition-colors hover:border-ferry-orange/50 hover:text-ferry-orange-deep',
}

export function SiteHeader({ onSettings, live = true }: { onSettings?: () => void; live?: boolean }) {
  return (
    <AppHeader
      mode="ferry"
      logoSrc={lockup360}
      logoSrcSet={`${lockup236} 236w, ${lockup360} 360w, ${lockup489} 489w`}
    >
      {onSettings ? <SettingsPill onClick={onSettings} /> : null}
      <LivePill live={live} />
    </AppHeader>
  )
}

export function TerminalLinks() {
  return (
    <ul className={SECTION.list}>
      {TERMINALS.map((t) => (
        <li key={t.id}>
          <a className={SECTION.link} href={terminalHref(t.slug)}>
            {t.name}
          </a>
        </li>
      ))}
    </ul>
  )
}

export function SiteIntro() {
  return (
    <section className={SECTION.section} aria-labelledby="site-intro-heading">
      <h1 id="site-intro-heading" className={SECTION.heading}>
        {INTRO_HEADING}
      </h1>
      <p className={SECTION.text}>{INTRO_TEXT}</p>
      <h2 className={SECTION.subheading}>Ferry terminals</h2>
      <TerminalLinks />
    </section>
  )
}

const FeedbackSheet = lazy(() => import('./FeedbackSheet.tsx'))

/** The legacy footer's feedback entry point; the form loads on first open. */
export function FeedbackButton() {
  // Ferry's and transit's root loaders both expose the Turnstile sitekey (absent in local dev).
  const root = useRouteLoaderData('root') as { turnstileSitekey?: string | null } | undefined
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  // The sheet unmounts instead of closing, so the browser can't restore focus itself. Refocus after the unmount:
  // while the modal dialog is still up, everything outside it is inert.
  useEffect(() => {
    if (wasOpen.current && !open) button.current?.focus()
    wasOpen.current = open
  }, [open])
  // /feedback redirects to ?feedback=1, which opens the sheet.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('feedback') === '1') setOpen(true)
  }, [])
  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 font-semibold text-ferry-orange-deep transition-colors hover:text-ferry-orange-dark"
      >
        <span aria-hidden="true">💬 </span>Send Feedback & Ideas
      </button>
      {open ? (
        <Suspense fallback={null}>
          <FeedbackSheet onClose={() => setOpen(false)} sitekey={root?.turnstileSitekey ?? null} />
        </Suspense>
      ) : null}
    </>
  )
}

export function Footer() {
  return (
    <footer className="mt-12 border-t border-gray-200 py-8 pb-24 md:pb-8">
      <div className="mx-auto max-w-6xl px-4 text-center text-sm text-gray-700">
        <p>
          {ATTRIBUTION.text}{' '}
          <span className="whitespace-nowrap">
            — licensed under{' '}
            <a href={ATTRIBUTION.licenceUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {ATTRIBUTION.licenceName}
            </a>
          </span>
        </p>
        <p className="mt-2">Live times refresh every 15 seconds • All times in Brisbane time</p>
        <p className="mt-3">
          <FeedbackButton />
        </p>
        <p className="mt-3 text-xs text-gray-600">
          <a href={at('/privacy')} className="hover:text-ferry-orange-deep">
            Privacy
          </a>
          <span className="mx-1.5" aria-hidden="true">
            ·
          </span>
          <a href={at('/terms')} className="hover:text-ferry-orange-deep">
            Terms
          </a>
        </p>
      </div>
    </footer>
  )
}
