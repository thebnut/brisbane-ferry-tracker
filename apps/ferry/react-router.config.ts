import type { Config } from '@react-router/dev/config'

export default {
  ssr: true,
  // Static pages are prerendered to HTML in build/client and served by Workers static assets (no Worker
  // invocation). Terminal pages and home are server-rendered so their departure rows are live in the HTML.
  prerender: ['/privacy', '/terms'],
} satisfies Config
