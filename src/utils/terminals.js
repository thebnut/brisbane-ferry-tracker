// Canonical list of ferry terminals with URL slugs, shared by the React app,
// the static SEO shell in index.html (see vite.config.js) and the post-build
// scripts in scripts/. Plain ESM with no browser APIs so Node can import it.
import { FERRY_STOPS } from './ferryStops.js';

export const SITE_URL = 'https://www.brisbaneferry.com';

export const slugify = (name) =>
  name
    .toLowerCase()
    .replace(/ ferry terminal$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const TERMINALS = Object.entries(FERRY_STOPS)
  .map(([id, stop]) => ({ id, name: stop.name, slug: slugify(stop.name), lat: stop.lat, lng: stop.lng }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const terminalPath = (slug) => `/terminal/${slug}`;

export const getTerminalBySlug = (slug) => TERMINALS.find((t) => t.slug === slug) || null;

// Terminal for a /terminal/<slug> path (trailing slash allowed), else null.
export const getTerminalFromPath = (pathname) => {
  const match = /^\/terminal\/([a-z0-9-]+)\/?$/.exec(pathname || '');
  return match ? getTerminalBySlug(match[1]) : null;
};
