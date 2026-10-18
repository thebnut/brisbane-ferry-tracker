/**
 * Capacitor iOS shell for BrisbaneTrain (Phase 5 scaffold; no signing, team or App Store setup here).
 *
 * The app is server-rendered on Workers, so the shell loads the deployed site (CAP_SERVER_URL, default the
 * workers.dev staging host) rather than bundling a static build. native-shell/ is the bundled offline fallback page.
 * Build: `pnpm --filter @bft/train ios:sync`, then open ios/App/App.xcodeproj in Xcode and pick a team for a device.
 */
import type { CapacitorConfig } from '@capacitor/cli'

const serverUrl = process.env.CAP_SERVER_URL ?? 'https://bft-train.brisbanetransit.workers.dev'

const config: CapacitorConfig = {
  appId: 'com.brisbanetransport.train',
  appName: 'BrisbaneTrain',
  webDir: 'native-shell',
  server: {
    url: serverUrl,
    errorPath: 'index.html',
    allowNavigation: [new URL(serverUrl).host],
  },
  ios: { contentInset: 'never', limitsNavigationsToAppBoundDomains: false },
  plugins: {
    StatusBar: { style: 'DARK', backgroundColor: '#FFE5D9', overlaysWebView: false },
  },
}

export default config
