import { index, layout, prefix, type RouteConfig, route } from '@react-router/dev/routes'

/**
 * Transit pages live here; mode pages are the standalone apps' own route modules (loader, meta and component),
 * mounted under their prefix. Their links carry the same prefix (modes.config.ts) and their section navigation is
 * swapped for the Mode Tabs at build time.
 */
const app = (mode: 'ferry' | 'train' | 'bus', file: string) => `../../${mode}/app/routes/${file}`

export default [
  layout('routes/mode-layout.tsx', [
    index('routes/saved.tsx'),
    route('nearby', 'routes/nearby.tsx'),
    route('alerts', 'routes/alerts.tsx'),
    ...prefix('ferry', [
      index(app('ferry', 'home.tsx'), { id: 'ferry/home' }),
      route('terminal/:slug', app('ferry', 'terminal.tsx'), { id: 'ferry/terminal' }),
      route('privacy', app('ferry', 'privacy.tsx'), { id: 'ferry/privacy' }),
      route('terms', app('ferry', 'terms.tsx'), { id: 'ferry/terms' }),
    ]),
    ...prefix('train', [
      index(app('train', 'home.tsx'), { id: 'train/home' }),
      route('stations', app('train', 'stations.tsx'), { id: 'train/stations' }),
      route('station/:slug', app('train', 'station.tsx'), { id: 'train/station' }),
      route('trip/:tripInstance', app('train', 'trip.tsx'), { id: 'train/trip' }),
      route('map', app('train', 'map.tsx'), { id: 'train/map' }),
      route('alerts', app('train', 'alerts.tsx'), { id: 'train/alerts' }),
    ]),
    ...prefix('bus', [
      index(app('bus', 'home.tsx'), { id: 'bus/home' }),
      route('nearby', app('bus', 'nearby.tsx'), { id: 'bus/nearby' }),
      route('stop/:stopId', app('bus', 'stop.tsx'), { id: 'bus/stop' }),
      route('trip/:tripInstance', app('bus', 'trip.tsx'), { id: 'bus/trip' }),
      route('route/:route', app('bus', 'route.tsx'), { id: 'bus/route' }),
      route('map', app('bus', 'map.tsx'), { id: 'bus/map' }),
      route('alerts', app('bus', 'alerts.tsx'), { id: 'bus/alerts' }),
      route('about', app('bus', 'about.tsx'), { id: 'bus/about' }),
    ]),
  ]),
  route('ask', 'routes/ask.tsx'),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
