import type { Config } from '@react-router/dev/config'

export default {
  // Every page is server-rendered: station pages carry live departure rows in the HTML, and the rest are cheap.
  ssr: true,
} satisfies Config
