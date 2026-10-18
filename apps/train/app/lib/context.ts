import { createContext } from 'react-router'

/** Cloudflare bindings for loaders (set in workers/app.ts). */
export const cloudflareContext = createContext<{ env: Env; ctx: ExecutionContext; nonce: string }>()
