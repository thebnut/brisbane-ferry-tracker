import { createContext } from 'react-router'

/** Cloudflare bindings for the transit pages' loaders (set in workers/app.ts, like each app's own context). */
export const cloudflareContext = createContext<{ env: Env; ctx: ExecutionContext }>()
