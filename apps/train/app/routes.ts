import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('stations', 'routes/stations.tsx'),
  route('station/:slug', 'routes/station.tsx'),
  route('trip/:tripInstance', 'routes/trip.tsx'),
  route('map', 'routes/map.tsx'),
  route('alerts', 'routes/alerts.tsx'),
  route('feedback', 'routes/feedback.tsx'),
  route('whats-new', 'routes/whats-new.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
