import type { Config } from '@react-router/dev/config'

export default {
  ssr: true,
  // Every HTML page is server-rendered by the Worker so it carries the per-request CSP nonce (workers/security.ts);
  // /privacy and /terms used to be prerendered static HTML, which can't carry one.
} satisfies Config
