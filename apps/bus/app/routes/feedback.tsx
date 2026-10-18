import { redirect } from 'react-router'
import { getEnv } from '../lib/server.server.ts'
import type { Route } from './+types/feedback'

/**
 * /feedback: this app has no feedback form of its own, so this sends people to the transit site's, whose /feedback
 * opens the sheet (R7).
 */
export function loader({ context }: Route.LoaderArgs) {
  const site = getEnv(context)?.TRANSIT_SITE_URL ?? 'https://bft-transit.brisbanetransit.workers.dev'
  throw redirect(`${site}/feedback`)
}

export default function Feedback() {
  return null
}
