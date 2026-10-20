import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('nearby', 'routes/nearby.tsx'),
  route('stop/:stopId', 'routes/stop.tsx'),
  route('trip/:tripInstance', 'routes/trip.tsx'),
  route('route/:route', 'routes/route.tsx'),
  route('map', 'routes/map.tsx'),
  route('alerts', 'routes/alerts.tsx'),
  route('about', 'routes/about.tsx'),
  route('feedback', 'routes/feedback.tsx'),
  route('whats-new', 'routes/whats-new.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
