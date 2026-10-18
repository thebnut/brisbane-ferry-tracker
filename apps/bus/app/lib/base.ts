/**
 * URL prefix for this app's pages. Empty in the standalone BrisbaneBus app. BrisbaneTransit mounts the same route modules
 * under "/bus" and sets the prefix at build time (Vite define of `import.meta.env.VITE_BUS_BASE`), so it is fixed per
 * build, never a runtime mode switch. Canonical URLs (seo.ts) keep the unprefixed paths.
 */
// import.meta.env is absent under tsx (data scripts); Vite replaces the member expression statically.
export const BASE: string = import.meta.env ? (import.meta.env.VITE_BUS_BASE ?? '') : ''

/** An in-app link: "/alerts" → "/bus/alerts" inside BrisbaneTransit; "/" is this app's home. */
export const at = (path: string): string => (BASE ? (path === '/' ? BASE : `${BASE}${path}`) : path)
