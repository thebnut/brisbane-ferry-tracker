import { index, layout, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('nearby', 'routes/nearby.tsx'),
  // The board is a layout over its URL and the trip URL: on desktop the trip opens beside it (THE-118 PR 7).
  layout('routes/stop.tsx', [
    route('stop/:stopId', 'routes/board.tsx'),
    route('trip/:tripInstance', 'routes/trip.tsx'),
  ]),
  route('route/:route', 'routes/route.tsx'),
  route('map', 'routes/map.tsx'),
  route('alerts', 'routes/alerts.tsx'),
  route('about', 'routes/about.tsx'),
  route('feedback', 'routes/feedback.tsx'),
  route('whats-new', 'routes/whats-new.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
