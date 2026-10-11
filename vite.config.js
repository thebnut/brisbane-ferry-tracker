import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createReadStream, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const rootDir = path.dirname(fileURLToPath(import.meta.url))
const LOCAL_SCHEDULE_PATH = '/schedule-data/latest.json'

// Dev-only: serve the repo's daily-updated schedule-data/latest.json at the
// same URL the app requests on localhost. Previously a stale copy lived in
// public/, which drifted from the real data and was shipped in every deploy.
function serveLocalSchedule() {
  return {
    name: 'serve-local-schedule',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== LOCAL_SCHEDULE_PATH) return next()
        const file = path.join(rootDir, 'schedule-data', 'latest.json')
        if (!existsSync(file)) {
          res.statusCode = 404
          res.end('schedule-data/latest.json not found — run `git pull` or the schedule processor')
          return
        }
        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')
        createReadStream(file).pipe(res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), serveLocalSchedule()],
  server: {
    proxy: {
      '/api/gtfs-proxy': {
        target: 'https://gtfsrt.api.translink.com.au',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Extract endpoint from query parameter
            const url = new URL(req.url, 'http://localhost');
            const endpoint = url.searchParams.get('endpoint');
            if (endpoint) {
              // Rewrite the path to the actual API endpoint
              proxyReq.path = `/api/realtime/SEQ/${endpoint}`;
            }
          });
        }
      },
      '/api/gtfs-static': {
        target: 'https://gtfsrt.api.translink.com.au',
        changeOrigin: true,
        rewrite: () => '/GTFS/SEQ_GTFS.zip'
      }
    }
  }
})
