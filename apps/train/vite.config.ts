import { cloudflare } from '@cloudflare/vite-plugin'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { pwa } from './pwa.config.ts'

export default defineConfig({
  plugins: [cloudflare({ viteEnvironment: { name: 'ssr' }, inspectorPort: false }), tailwindcss(), reactRouter(), pwa()],
  build: { assetsInlineLimit: 0 },
  // Don't pick up the legacy root app's postcss.config.js (Tailwind 3); Tailwind 4 runs as a Vite plugin here.
  css: { postcss: { plugins: [] } },
  // Pre-bundle lazily imported deps so the dev server doesn't reload the page when they're first used.
  optimizeDeps: {
    include: ['maplibre-gl', '@leeoniya/ufuzzy'],
  },
})
