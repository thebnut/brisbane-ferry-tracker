import { index, layout, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  // The board is a layout over its URL and the trip URL: on desktop the trip opens beside it (THE-118 PR 7).
  layout('routes/terminal.tsx', [
    route('terminal/:slug', 'routes/board.tsx'),
    route('trip/:tripInstance', 'routes/trip.tsx'),
  ]),
  // The live ferry map (THE-118 PR 9), which replaced the board's map sheet.
  route('map', 'routes/map.tsx'),
  route('privacy', 'routes/privacy.tsx'),
  route('terms', 'routes/terms.tsx'),
  route('feedback', 'routes/feedback.tsx'),
  route('whats-new', 'routes/whats-new.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
