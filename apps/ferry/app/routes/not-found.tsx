import { data } from 'react-router'
import { Footer, SECTION, SiteHeader, TerminalLinks } from '../components/Chrome.tsx'
import type { Route } from './+types/not-found'

export function loader() {
  throw data(null, { status: 404 })
}

export const meta: Route.MetaFunction = () => [
  { title: 'Page not found | Brisbane Ferry' },
  { name: 'description', content: 'This page does not exist. See live Brisbane ferry departures for every terminal.' },
  { name: 'robots', content: 'noindex' },
]

export function ErrorBoundary() {
  return (
    <>
      <SiteHeader />
      <main className={SECTION.section}>
        <h1 className={SECTION.heading}>Page not found</h1>
        <p className={SECTION.text}>
          That page doesn't exist. The <a className="underline" href="/">live departure boards</a> are on the home page,
          or pick a ferry terminal:
        </p>
        <TerminalLinks />
      </main>
      <Footer />
    </>
  )
}

export default function NotFound() {
  return null
}
