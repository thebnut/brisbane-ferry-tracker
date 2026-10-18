import type { Config } from '@react-router/dev/config'

export default {
  ssr: true,
  // Every page is server-rendered at the edge: mode pages carry live rows in the HTML (their loaders come from the
  // standalone apps), and the transit pages are small enough not to need prerendering.
} satisfies Config
