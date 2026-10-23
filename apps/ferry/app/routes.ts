import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('terminal/:slug', 'routes/terminal.tsx'),
  route('trip/:tripInstance', 'routes/trip.tsx'),
  route('privacy', 'routes/privacy.tsx'),
  route('terms', 'routes/terms.tsx'),
  route('feedback', 'routes/feedback.tsx'),
  route('whats-new', 'routes/whats-new.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
