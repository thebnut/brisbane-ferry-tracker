import { data } from 'react-router'

/** Any path no mode claims: a real 404 (the root ErrorBoundary renders the page). */
export function loader() {
  throw data(null, { status: 404 })
}

export default function NotFound() {
  return null
}
