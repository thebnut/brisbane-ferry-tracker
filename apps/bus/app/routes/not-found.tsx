import { data } from 'react-router'
import { Footer, SiteHeader } from '../components/Shell.tsx'
import type { Route } from './+types/not-found'

export function loader() {
  throw data(null, { status: 404 })
}

export const meta: Route.MetaFunction = () => [
  { title: 'Page not found | BrisbaneBus' },
  { name: 'robots', content: 'noindex' },
]

export function ErrorBoundary() {
  return (
    <>
      <title>Page not found | BrisbaneBus</title>
      <meta name="robots" content="noindex" />
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-xl font-bold text-aqua-text dark:text-ferry-aqua-light">Page not found</h1>
        <p className="mt-2 text-gray-700 dark:text-night-text/80">
          That page doesn't exist.{' '}
          <a className="underline" href="/">
            Search for a stop by name or number
          </a>
          .
        </p>
      </main>
      <Footer />
    </>
  )
}

export default function NotFound() {
  return null
}
