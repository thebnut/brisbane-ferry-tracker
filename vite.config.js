import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
