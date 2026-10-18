import { data } from 'react-router'

/** Unknown paths: 404 with noindex, rendered by the root ErrorBoundary. */
export function loader() {
  throw data(null, { status: 404 })
}

export default function NotFound() {
  return null
}
